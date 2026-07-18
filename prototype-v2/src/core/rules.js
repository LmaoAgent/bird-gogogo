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
