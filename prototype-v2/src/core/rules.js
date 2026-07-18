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

/** 该段所需火力(§3.1)：F ≥ λ×h 才不漏怪。关卡设计的核心校验量。 */
export function fMin(wave) { return wave.lambda * wave.hp; }

/** 漏网速率(只/秒)：火力不足时每秒漏多少只。 */
export function leakRate(wave, F) {
  return Math.max(0, wave.lambda - F / wave.hp);
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
