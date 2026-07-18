// 配置表与局内状态的 TS 类型(《P0工程骨架》§1 defs)。
// 字段一律对齐 prototype/config 的现有 JSON,不新增语义;纯类型,编译后不留运行时代码。

export type LaneSide = 'left' | 'center' | 'right';
export type EffectType = 'add' | 'mul' | 'sub' | 'div';

// —— 门(玩法文档 §3.2) ——

/** 门效果。非 pick 门自身就带这三个字段,pick 门把它们放在 options 里。 */
export interface GateEffect {
  type: EffectType;
  value: number;
  side: LaneSide;
}

export interface GateRepeat {
  count: number;
  stepZ: number;
}

export interface EffectGate extends GateEffect {
  id: string;
  posZ: number;
  repeat?: GateRepeat;
}

export interface PickGate {
  id: string;
  type: 'pick';
  posZ: number;
  options: GateEffect[];
  repeat?: GateRepeat;
}

export type GateConfig = EffectGate | PickGate;

// —— 关卡(§5.1) ——

export interface EnemyConfig {
  type: string;
  H: number;
  posZ: number;
}

export interface BossConfig {
  type: string;
  phases: number[];
  posZ: number;
}

/** 星级阈值,键为星数字符串:{ "3": 0.95, "2": 0.75 }。 */
export type StarThresholds = Record<string, number>;

export interface LevelConfig {
  level: number;
  note?: string;
  trackLength: number;
  k: number;
  targetN: number;
  gates: GateConfig[];
  enemies?: EnemyConfig[];
  boss?: BossConfig | null;
  star?: StarThresholds;
}

/** enemies 与 boss 多阶段统一展开后的 H 段(§4.2)。 */
export interface Wave {
  type: string;
  H: number;
  posZ: number;
  isBoss: boolean;
  phase?: number;
  phaseCount?: number;
}

// —— 手感参数表(§8) ——

export interface CombatTuning {
  dps: number;
  tMin: number;
  tMax: number;
}

export interface TrackTuning {
  width: number;
  laneX: Record<LaneSide, number>;
  gateHalfWidth: number;
}

export interface FxTuning {
  smashShakeAmp: number;
  smashShakeDuration: number;
  bossHitStop: number;
}

export interface Tuning {
  startArmy: number;
  forwardSpeed: number;
  dragSensitivity: number;
  followSmooth: number;
  formationRadiusK: number;
  nRender: number;
  combat: CombatTuning;
  fx: FxTuning;
  track: TrackTuning;
  star: StarThresholds;
}

// —— 局内状态 ——

export interface SmashState {
  wave: Wave;
  duration: number;
  breakthrough: boolean;
  nBefore: number;
  nAfter: number;
  hBefore: number;
  hAfter: number;
  progress: number;
}

/** 每帧事件,表现层消费。 */
export type GameEvent =
  | { kind: 'gate'; gate: GateConfig; effect: GateEffect; before: number; after: number }
  | { kind: 'smashStart'; smash: SmashState }
  | { kind: 'smashEnd'; smash: SmashState };

export interface LevelResult {
  win: boolean;
  nEnd: number;
  nPeak: number;
  star: number;
  /** 最优度 nPeak/targetN,仅通关时有(结算页展示用)。 */
  ratio?: number;
  /** 失败时的波次下标,陷阱扣光为 -1。 */
  failWave?: number;
}

// —— 养成与存档(PRD §5) ——

export type UpgradeKind = 'startArmy' | 'unitPower';

export interface UpgradeEntry {
  level: number;
  value: number;
  cost: number;
}

export interface UpgradeCurve {
  note?: string;
  levels: UpgradeEntry[];
}

export interface UpgradeConfig {
  note?: string;
  rewards: {
    note?: string;
    coinBase: number;
    starBonus: Record<string, number>;
  };
  curves: Record<UpgradeKind, UpgradeCurve>;
}

/** 一份奖励。签到 / 每日任务 / 分享共用,发放走 Progress.grant(见 systems/)。 */
export interface Reward {
  coin?: number;
  skinFrag?: number;
}

export interface SaveData {
  version: number;
  maxLevel: number;
  coins: number;
  /** 皮肤碎片:签到第 7 天与部分每日任务的奖励(设计文档 §1/§2);皮肤本体是后续需求。 */
  skinFrag: number;
  upgrades: Record<UpgradeKind, number>;
  stars: Record<string, number>;
}

/** 存储适配器。平台实现放表现层,core 不认平台。 */
export interface StorageAdapter {
  load(): unknown;
  save(data: SaveData): void;
}

// —— 广告(《广告接入spec.md》§2/§3) ——

export type AdScene = 'revive' | 'double' | 'boost' | 'freebox' | 'inter_level';

export interface AdResult {
  ended: boolean;
  /** 没播成的原因,只进埋点与排查,不参与发奖判定。 */
  error?: string;
}

/** config/ad.json:广告位 ID 与频控上限,代码里一个都不写死(spec §0/§4)。 */
export interface AdConfig {
  note?: string;
  /** scene → adUnitId;留空＝该位未配置,canShow 恒 false(按钮置灰)。 */
  unitMap: Partial<Record<AdScene, string>>;
  /** scene → 每局发奖上限。P0:revive 2 次 / double 1 次;缺省＝0＝该位不开。 */
  quota: Partial<Record<AdScene, number>>;
}
