// 《蒜鸟的战斗》规则引擎 —— 纯逻辑,不依赖任何渲染引擎。
// 由 prototype/src/core/rules.js 原样迁入(只补 TS 类型,规则一行未改;数值真源仍以 prototype 为准)。
// 对应《玩法数值与关卡设计》：§2 队形 / §3.2 门效果 / §4 对撞模型 / §6 胜负与星级。
// 所有数值来自配置表,此处只实现规则。

import type {
  CombatTuning, GateConfig, GateEffect, LevelConfig,
  PickGate, StarThresholds, TrackTuning, Wave,
} from '../defs/types';

export function clamp(v: number, lo: number, hi: number): number {
  return v < lo ? lo : v > hi ? hi : v;
}

// —— §3.2 门效果 ——

/** 施加单个门效果,返回作用后的兵力。下限 0。 */
export function applyGateEffect(n: number, effect: GateEffect): number {
  switch (effect.type) {
    case 'add': return n + effect.value;
    case 'mul': return Math.floor(n * effect.value);
    case 'sub': return Math.max(0, n - effect.value);
    case 'div': return Math.floor(n / effect.value);
    default: return n;
  }
}

/** 队形中心 X 是否落在某条 lane 的门框内。 */
export function inLane(centerX: number, side: GateEffect['side'], track: TrackTuning): boolean {
  return Math.abs(centerX - track.laneX[side]) <= track.gateHalfWidth;
}

/** pick 门(§3.2 双选/分叉):按走位选中的 option;都没走进则不触发。 */
export function resolvePick(gate: PickGate, centerX: number, track: TrackTuning): GateEffect | null {
  for (const opt of gate.options) {
    if (inLane(centerX, opt.side, track)) return opt;
  }
  return null;
}

/** 展开 repeat 连排门(§3.2 蓝 +1 连排以数组批量生成),按 posZ 升序。 */
export function expandGates(gates: GateConfig[]): GateConfig[] {
  const out: GateConfig[] = [];
  for (const g of gates) {
    if (!g.repeat) { out.push(g); continue; }
    for (let i = 0; i < g.repeat.count; i++) {
      const { repeat, ...rest } = g;
      out.push({ ...rest, id: `${g.id}_${i}`, posZ: g.posZ + i * repeat.stepZ } as GateConfig);
    }
  }
  return out.sort((a, b) => a.posZ - b.posZ);
}

// —— §4 对撞模型 ——

/**
 * 对撞结算(§4.2)：结果只由兑换比 k 决定,与单兵 DPS 无关。
 * N ≥ H/k → 突破,穿透后剩余 N - H/k;否则兵力被吃光 FAIL。
 */
export function resolveSmash(n: number, H: number, k: number): { breakthrough: boolean; nAfter: number; nMin: number } {
  const nMin = H / k;
  return n >= nMin
    ? { breakthrough: true, nAfter: Math.floor(n - nMin), nMin }
    : { breakthrough: false, nAfter: 0, nMin };
}

/** 对撞演出时长(§4.2)：只影响观感,不改结果。 */
export function smashDuration(H: number, n: number, combat: CombatTuning): number {
  return clamp(H / Math.max(n, 1) / combat.dps, combat.tMin, combat.tMax);
}

/** 敌方波次(§5.1)：enemies 与 boss 多阶段统一展开为串联的 H 段(§4.2)。 */
export function buildWaves(level: LevelConfig): Wave[] {
  const waves: Wave[] = (level.enemies || []).map(e => ({
    type: e.type, H: e.H, posZ: e.posZ, isBoss: false,
  }));
  if (level.boss) {
    const phases = level.boss.phases;
    phases.forEach((H, i) => waves.push({
      type: level.boss.type, H, posZ: level.boss.posZ, isBoss: true,
      phase: i + 1, phaseCount: phases.length,
    }));
  }
  return waves.sort((a, b) => a.posZ - b.posZ);
}

// —— §6 星级 ——

/**
 * 星级：按"离本关最优解有多近"评定,ratio = N_peak / targetN。
 * 通关保底 1★;判负(0★)由 game.ts 定,本函数只管通关后的评级。
 */
export function starRating(nPeak: number, targetN: number, thresholds: StarThresholds): number {
  const ratio = nPeak / Math.max(targetN, 1);
  if (ratio >= thresholds['3']) return 3;
  if (ratio >= thresholds['2']) return 2;
  return 1;
}

// —— §7 复活 ——

/**
 * 复活兵力:max(当前波 N_min, N_peak×0.5)。
 * N_min 取"突破线再加 1 兵":穿透后剩 N-H/k,恰好卡在突破线会被 game.ts 的
 * "N≤0 判负"再杀一次,就不成其为复活了(§7 要保证复活后有机会过当前波)。
 * wave 为 null(波次已清完、纯陷阱扣光)时只吃 N_peak×0.5。
 */
export function reviveArmy(nPeak: number, wave: Wave | null, k: number): number {
  const nMin = wave ? Math.ceil(wave.H / k) + 1 : 0;
  return Math.max(nMin, Math.floor(nPeak * 0.5));
}

// —— §2 队形 ——

const GOLDEN_ANGLE = Math.PI * (3 - Math.sqrt(5));

/**
 * 单位队形槽位(半径 1 的圆盘内均布),乘以阵型半径 R 即得相对中心的偏移。
 * R = formationRadiusK · √N 由调用方按 §2 计算。
 */
export function unitFormationSlot(i: number, count: number): { x: number; z: number } {
  const r = Math.sqrt((i + 0.5) / count);
  const a = i * GOLDEN_ANGLE;
  return { x: r * Math.cos(a), z: r * Math.sin(a) };
}
