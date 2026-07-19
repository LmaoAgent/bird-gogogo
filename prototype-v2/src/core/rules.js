// 《蒜鸟冲冲冲》v2 射击规则引擎 —— 纯逻辑,不依赖渲染,可整体迁入 Cocos。
// 对应《玩法数值与关卡设计v2》：§2 火力模型 / §3 怪流 / §4 门 / §8 星级。

export function clamp(v, lo, hi) { return v < lo ? lo : v > hi ? hi : v; }

// —— §2 火力模型 ——

/** 总火力：清怪潮看这个。L 条弹道各打一个目标。 */
export function firepower(s) { return s.L * s.N * s.D * s.R; }

/** 单目标 DPS：BOSS 战只看这个,弹道数在单体面前不起作用。 */
export function singleTargetDps(s) { return s.N * s.D * s.R; }

// —— §4 门效果 ——

/** 施加单个门效果到属性上,返回新属性对象。各维下限见 clampStats。 */
export function applyGate(stats, effect) {
  const next = { ...stats };
  const dim = effect.dim;
  next[dim] = effect.op === 'mul' ? next[dim] * effect.value : next[dim] + effect.value;
  return clampStats(next);
}

/** 维度下限：兵力可归零(判负),其余最低保 1 档,免得除零或彻底打不动。 */
export function clampStats(s) {
  return {
    N: Math.max(0, Math.floor(s.N)),
    L: Math.max(1, Math.round(s.L)),
    R: Math.max(0.5, +s.R.toFixed(2)),
    D: Math.max(1, +s.D.toFixed(2)),
  };
}

/** 门是不是增益(给渲染分配色用)。 */
export function isBuff(effect) {
  return effect.op === 'mul' ? effect.value > 1 : effect.value > 0;
}

/** 展开 repeat 连排门,按 posZ 升序(沿用 v1 的做法)。 */
export function expandGates(gates) {
  const out = [];
  for (const g of gates) {
    if (!g.repeat) { out.push(g); continue; }
    for (let i = 0; i < g.repeat.count; i++) {
      const { repeat, ...rest } = g;
      out.push({ ...rest, id: `${g.id}_${i}`, posZ: g.posZ + i * repeat.stepZ });
    }
  }
  return out.sort((a, b) => a.posZ - b.posZ);
}

/** pick 门(§4 双选)：按走位选中的 option;都没走进则不触发。 */
export function resolvePick(gate, centerX, track) {
  for (const opt of gate.options) if (inLane(centerX, opt.side, track)) return opt;
  return null;
}

export function inLane(centerX, side, track) {
  return Math.abs(centerX - track.laneX[side]) <= track.gateHalfWidth;
}

// —— §3 怪流 ——

/**
 * 该段所需火力(§3.1)：F ≥ λ×rowSize×h 才不漏怪。关卡设计的核心校验量。
 * rowSize = 每排几只(参考素材:敌军是铺满赛道的一排排,不是零散个体)。
 */
export function fMin(wave) { return wave.lambda * (wave.rowSize || 1) * wave.hp; }

/** 漏网速率(只/秒)：火力不足时每秒漏多少只。 */
export function leakRate(wave, F) {
  return Math.max(0, wave.lambda * (wave.rowSize || 1) - F / wave.hp);
}

/** 闸门(射击门)打穿耗时(秒)：总火力全打在这个单一大目标上。 */
export function barrierTime(hp, F) { return hp / Math.max(F, 1); }

// —— 障碍(§V4 不可摧毁) ——

/**
 * 障碍此刻的中心 x。spike 恒在 o.x；roller 绕 o.x 正弦往复。
 * 用正弦而不是匀速三角波：两端速度自然归零，玩家能"等它荡到那头再钻过去"；
 * 三角波在端点是无预兆的急停折返,判不出下一刻往哪走。相位只跟 time 走 —— 同一秒轨迹永远一样。
 */
export function obstacleX(o, time, tuning) {
  if (o.type !== 'roller') return o.x;
  return o.x + (o.amp ?? tuning.rollerAmp) * Math.sin(time / (o.period ?? tuning.rollerPeriod) * Math.PI * 2);
}

/** 大军中心撞上障碍没有。与门的 inLane 同构：只看中心点,半宽固定(理由见 game.js #checkObstacles)。 */
export function obstacleHit(centerX, cx, width, halfW) {
  return Math.abs(centerX - cx) < width / 2 + halfW;
}

/**
 * lane 安全余量的下限(世界单位)。**不进 tuning**：它不是手感旋钮而是配置纪律,
 * 调低它等于把「必中」重新放回来。
 *
 * 为什么不能取 0：`centerX` 是 lerp 指数逼近 targetX 的,浮点下**永远差最后一点** ——
 * 实测 targetX=5 时收敛到 4.999999999999997 后就不再变化(第 216 帧起是不动点)。
 * 于是「余量恰好 0」的 lane 上 `|centerX - cx| < 判定半宽` 恒成立：算出来安全,玩起来必中。
 * 关 7 的 232 尖刺(width 6 → 判定半宽 5 = right lane 坐标)就是这么翻车的。
 */
export const OBSTACLE_MIN_CLEARANCE = 0.5;

/**
 * 障碍配置校验(供 V6 铺关卡 / V7 配平调用)：逐个障碍算「站在各 lane 上离判定区还有多远」,
 * 取最宽松的那条 lane 当作这个障碍的活路。roller 的判定区在动,所以要遍历一个周期内的所有相位,
 * 记最糟的那一相位 —— 只看某一瞬间会漏掉它荡过去以后才封死的情形。
 *
 * 返回每个障碍一条记录,`ok:false` 即为不合法配置(msg 里带各 lane 的余量,可直接打印)。
 */
export function obstacleClearance(level, tuning) {
  const laneNames = Object.keys(tuning.track.laneX);
  return (level.obstacles || []).map(o => {
    const danger = o.width / 2 + tuning.obstacleHitHalfW;
    // 相位步进 0.5°：amp ≤ 6 的滚轮相邻两次采样 cx 移动 < 0.06,比 0.5 的阈值细一个量级
    const steps = o.type === 'roller' ? 720 : 1;
    const period = o.period ?? tuning.rollerPeriod;
    let worst = null;
    for (let i = 0; i < steps; i++) {
      const cx = obstacleX(o, (i / steps) * period, tuning);
      const lanes = {};
      let best = -Infinity, bestLane = null;
      for (const n of laneNames) {
        lanes[n] = Math.abs(tuning.track.laneX[n] - cx) - danger;
        if (lanes[n] > best) { best = lanes[n]; bestLane = n; }
      }
      if (!worst || best < worst.best) worst = { cx, lanes, best, bestLane };
    }
    return {
      id: o.id, type: o.type, danger, ...worst,
      ok: worst.best >= OBSTACLE_MIN_CLEARANCE,
      msg: `${o.id}(${o.type} x=${o.x} w=${o.width} 判定半宽 ${danger}) 最糟相位 cx=${worst.cx.toFixed(2)}：`
        + laneNames.map(n => `${n} ${worst.lanes[n].toFixed(2)}`).join(' / ')
        + ` → 最宽松 ${worst.bestLane} ${worst.best.toFixed(2)}`,
    };
  });
}

// —— 油桶(§V5 可摧毁) ——

const BUFF_LABEL = { pierce: '穿透', crit: '暴击' };

/** 桶给的是什么,一句话。渲染的标签、埋点的 rewardDim 都取它,免得两处各写一套对不上。 */
export function rewardLabel(r) {
  return r.buff ? BUFF_LABEL[r.buff] : `${r.dim}${r.op === 'mul' ? '×' : '+'}${r.value}`;
}

/** 埋点用的维度名。限时 buff 没有维度,报 buff 名 —— 字段恒有值,漏斗才对得上。 */
export function rewardDim(r) { return r.buff || r.dim; }

/**
 * 这个奖励能把总火力抬多少(比例)。红线「单桶收益 ≤ 15%」量的就是它。
 *
 * 限时 buff 恒返回 0:它不进 stats 也就不进 fPeak,星级与关卡校验都看不见它 ——
 * 这正是 buff 敢给得比属性奖励猛一点的原因(代价是它只在那几秒里有效)。
 *
 * 走 applyGate 而不是自己乘一遍,是为了吃到 clampStats 的取整:`L ×1.1` 在 L=4 上会被
 * Math.round 抹平成 0 收益 —— 这类"配了等于没配"的奖励要在这里就现形,别到实测才发现。
 */
export function rewardGain(stats, r) {
  if (r.buff) return 0;
  return firepower(applyGate(stats, r)) / Math.max(firepower(stats), 1) - 1;
}

/** 单桶收益上限(占拾取瞬间的总火力)。与 OBSTACLE_MIN_CLEARANCE 同性质:配置纪律,不是手感旋钮。 */
export const BARREL_REWARD_CAP = 0.15;

/**
 * 单桶收益下限。分走 45% 火力、还要横向离开本来的道,换来的东西必须看得见 ——
 * 低于这条线的桶不是"取舍"而是"陷阱",玩家学到的是「别理桶」。
 * V6 关 8 的 z=72 桶按起手 N=15 配成 N+2,实跑拾取时 N 已经 77,收益 2.6%,就是踩了这条线。
 */
export const BARREL_REWARD_FLOOR = 0.08;

/**
 * 怪潮压上脸的位置比 `wave.from` 晚多少(以大军推进的纵深计)。
 *
 * 怪在 spawnAhead 之外生成,双方相向而行,要 (spawnAhead - contactZ) / (前进 + 怪速) 秒才咬上,
 * 这段时间大军又推进了 forwardSpeed × 该秒数 —— 当前参数下是 **23 个纵深单位**。
 *
 * 为什么必须显式算出来:`[from, from+23]` 这一段是**看得见怪、却还没有人撞上来**的空窗,
 * 火力在这里分走多少都不疼。桶摆在这一段就是白送 —— 配置上看它明明在怪潮里,实测漏怪却纹丝不动
 * (V5 第一版四个桶全踩在这上面,窗口内漏怪 0.0 只)。
 */
export function arrivalLag(tuning) {
  return tuning.forwardSpeed * (tuning.spawnAhead - tuning.contactZ) / (tuning.forwardSpeed + tuning.enemySpeed);
}

/**
 * 油桶配置校验(供 V6 铺关卡 / V7 配平调用)。三条纪律:
 *
 * 1. **不能白送**:桶的**交火窗口**(posZ 前 barrelRangeZ 这一段)必须真的在挨怪 ——
 *    看的是 `[from+lag, to+lag]` 而不是 `[from, to]`,理由见 arrivalLag。空场上的桶不花任何代价,
 *    火力分走了也没人漏,那不是取舍是路边捡钱(V5 任务书 §3 点名要的就是这条)。
 * 2. **不能够不着**:落在闸门停机区(posZ 前 barrierStopZ 之内)的桶永远打不到,
 *    那几秒火力全钉在门上。配了等于摆个假选项。
 * 3. **收益落在 [FLOOR, CAP] 之间**:量的是**拾取那一刻**的收益率,基准取 `b.pickStats` ——
 *    参考最优路线实跑到这个桶时的属性快照,由 `tools/rebalance.mjs` 写回配置。
 *
 * 为什么非得是实跑快照(V7 修):`add` 类奖励的收益率是 value/dim,与拾取时该维多大**成反比**。
 * 早先只对 `mul` 判 over(`add` 的 mulGain 恒 null → over 恒 false),`add` 类根本没进 ok,
 * 只在 msg 里写一句"该维 ≥ N 才不过线" —— 于是拿起手 N=15 当基准,N+6 被读成 40% 砍到 N+2;
 * 而实跑到那个桶时 N 已经 77,N+2 只值 2.6%,白配。同一个奖励差 5 倍,静态估不出来,只能实测。
 *
 * 打不打得穿不在这里判:它要的是拾取时的 F,静态算不出来,交给仿真。这里只给「窗口内打穿所需火力」。
 */
export function barrelCost(level, tuning) {
  const windowS = tuning.barrelRangeZ / tuning.forwardSpeed;
  const lag = arrivalLag(tuning);
  return (level.barrels || []).map(b => {
    const z0 = b.posZ - tuning.barrelRangeZ;
    const pressure = (level.waves || [])
      .filter(w => b.posZ >= w.from + lag && z0 <= w.to + lag)
      .reduce((s, w) => s + fMin(w), 0);
    const blocked = (level.barriers || []).some(x => b.posZ > x.posZ - tuning.barrierStopZ && b.posZ <= x.posZ);
    const fNeed = b.hp / (tuning.barrelShare * windowS);
    const r = b.reward;
    // 限时 buff 不进 stats 也就不进 fPeak,收益率恒 0,两条线都不适用(理由见 rewardGain)。
    const gain = r.buff ? null : b.pickStats ? rewardGain(b.pickStats, r) : NaN;
    const over = gain > BARREL_REWARD_CAP, weak = gain !== null && gain < BARREL_REWARD_FLOOR;
    return {
      id: b.id, pressure, blocked, fNeed, gain,
      ok: pressure > 0 && !blocked && !over && !weak && !Number.isNaN(gain),
      msg: `${b.id}(z=${b.posZ} x=${b.x} hp=${b.hp} → ${rewardLabel(r)}) `
        + `窗口 z${Math.round(z0)}~${b.posZ} `
        + (pressure > 0 ? `挨怪压力 ${Math.round(pressure)}` : '**空窗,白送**')
        + (blocked ? ' **在闸门停机区,够不着**' : '')
        + ` / 窗口 ${windowS.toFixed(1)}s 内打穿需火力 ${Math.round(fNeed)}`
        + (gain === null ? ' / 限时 buff,不进 fPeak'
          : Number.isNaN(gain) ? ' / **缺 pickStats,未配平**'
            : ` / 拾取时 ${JSON.stringify(b.pickStats)} → 收益 ${(gain * 100).toFixed(1)}%`
              + (over ? ` **超 ${BARREL_REWARD_CAP * 100}% 线**` : weak ? ` **低于 ${BARREL_REWARD_FLOOR * 100}% 线,没有拾取价值**` : '')),
    };
  });
}

// —— §8 星级 ——

/** 星级：峰值总火力 / 该关设计的最优火力。与 v1 同构,只换了分母的量。 */
export function starRating(fPeak, targetF, thresholds) {
  const ratio = fPeak / Math.max(targetF, 1);
  if (ratio >= thresholds['3']) return 3;
  if (ratio >= thresholds['2']) return 2;
  return 1;
}

// —— 队形(沿用 v1 的黄金角圆盘布点) ——

const GOLDEN_ANGLE = Math.PI * (3 - Math.sqrt(5));

export function unitFormationSlot(i, count) {
  const r = Math.sqrt((i + 0.5) / count);
  const a = i * GOLDEN_ANGLE;
  return { x: r * Math.cos(a), z: r * Math.sin(a) };
}
