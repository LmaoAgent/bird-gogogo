// 配置表与局内状态的 TS 类型(v2 射击模型)。
// 字段一律对齐 prototype-v2/config 的现有 JSON 与 core/*.js 的运行时结构,不新增语义;
// 纯类型,编译后不留运行时代码。core/ 逻辑真源仍以 prototype-v2 为准。

export type LaneSide = 'left' | 'center' | 'right';
/** 四个火力维度(《v2》§2.1)。 */
export type Dim = 'N' | 'L' | 'R' | 'D';
export type GateOp = 'add' | 'mul';

// —— 火力属性(§2） ——

/** 局内实时属性:兵力 / 弹道 / 射速 / 单发伤害。 */
export interface Stats {
  N: number;
  L: number;
  R: number;
  D: number;
}

// —— 门(§4） ——

/** 一个门效果:把某维按 op 施加 value。pick 门把它拆进 options。 */
export interface GateEffect {
  dim: Dim;
  op: GateOp;
  value: number;
  side: LaneSide;
}

export interface GateRepeat {
  count: number;
  stepZ: number;
}

/** 普通门(自身即效果)。展开 repeat 后 id 带 `_i` 后缀、posZ 递增。 */
export interface EffectGate extends GateEffect {
  id: string;
  posZ: number;
  repeat?: GateRepeat;
  type?: undefined;
}

/** 双选门(§4）：两侧都是增益但维度不同,走到哪条 lane 吃哪个。 */
export interface PickGate {
  id: string;
  type: 'pick';
  posZ: number;
  options: GateEffect[];
  repeat?: GateRepeat;
}

export type GateConfig = EffectGate | PickGate;

// —— 怪流(§3） ——

export type EnemyType = 'moldling' | 'thick' | 'rotgarlic_elite' | 'rotgarlic_king' | string;

/** 一段怪流:λ 排/秒,每排 rowSize 只,单怪 hp 血。 */
export interface Wave {
  from: number;
  to: number;
  lambda: number;
  rowSize?: number;
  hp: number;
  type: EnemyType;
  speedMul?: number;
}

// —— 闸门(射击门,§4.5） ——

export interface BarrierConfig {
  id: string;
  posZ: number;
  hp: number;
}

// —— 障碍(§V4 不可摧毁） ——

export type ObstacleType = 'spike' | 'roller';

export interface ObstacleConfig {
  id: string;
  type: ObstacleType;
  posZ: number;
  x: number;
  width: number;
  /** roller 往复振幅 / 周期(缺省走 tuning.rollerAmp / rollerPeriod）。 */
  amp?: number;
  period?: number;
}

// —— 油桶(§V5 可摧毁） ——

/** 桶奖励:属性奖励(dim/op/value)或限时 buff(pierce/crit）。 */
export interface BarrelReward {
  dim?: Dim;
  op?: GateOp;
  value?: number;
  buff?: 'pierce' | 'crit';
}

export interface BarrelConfig {
  id: string;
  posZ: number;
  x: number;
  hp: number;
  reward: BarrelReward;
  /** 参考最优路线实跑到该桶时的属性快照,由 tools/rebalance.mjs 写回(§8.1 收益率口径）。 */
  pickStats?: Stats;
}

// —— BOSS(§3.2 单体） ——

export interface BossConfig {
  type: string;
  hp: number;
  posZ: number;
  dps: number;
}

// —— 关卡 ——

/** 星级阈值,键为星数字符串:{ "3": 0.95, "2": 0.75 }。 */
export type StarThresholds = Record<string, number>;

export interface LevelConfig {
  level: number;
  note?: string;
  trackLength: number;
  /** 参考最优路线实跑的 fPeak(§8.1,由 rebalance.mjs 回填,星级分母）。 */
  targetF: number;
  gates: GateConfig[];
  waves?: Wave[];
  barriers?: BarrierConfig[];
  obstacles?: ObstacleConfig[];
  barrels?: BarrelConfig[];
  boss?: BossConfig | null;
  /** 关卡级起始属性覆写(叠在 tuning.start 上)。 */
  start?: Partial<Stats>;
  star?: StarThresholds;
  measured?: string;
}

// —— 手感参数表(tuning.json） ——

export interface TrackTuning {
  width: number;
  laneX: Record<LaneSide, number>;
  gateHalfWidth: number;
}

/** v2 全量手感参数,逐字段对齐 config/tuning.json。 */
export interface Tuning {
  note?: string;
  start: Stats;
  forwardSpeed: number;
  dragSensitivity: number;
  followSmooth: number;
  formationRadiusK: number;
  formationRadiusMax: number;
  formationDepthK: number;
  unitSize: number;
  nRender: number;
  bulletSpeed: number;
  maxBullets: number;
  maxBulletLanes: number;
  focusLanesMin: number;
  bulletFanW: number;
  focusFanMul: number;
  bulletTargetDepth: number;
  bulletSize: number;
  bulletTrailK: number;
  enemySpeed: number;
  spawnAhead: number;
  maxEnemies: number;
  enemyRadius: number;
  separationForce: number;
  gridCell: number;
  contactZ: number;
  bossStandZ: number;
  track: TrackTuning;
  star: StarThresholds;
  enemiesPerLoss: number;
  hitFlashS: number;
  bulletRateMul: number;
  barrierStopZ: number;
  breakWaveRange: number;
  breakWaveDamage: number;
  releaseBatchInterval: number;
  releaseBatchSize: number;
  breakBoostS: number;
  breakBoostSpeedMul: number;
  obstacleLossPct: number;
  obstacleHitHalfW: number;
  rollerAmp: number;
  rollerPeriod: number;
  barrelShare: number;
  barrelRangeZ: number;
  barrelAimHalfW: number;
  buffCritS: number;
  buffCritMul: number;
  buffPierceS: number;
  buffPierceFalloff: number;
  maxWaveFx: number;
  maxHitFx: number;
}

// —— 局内运行时对象(core/game.js 造出来的） ——

export interface Enemy {
  id: number;
  x: number;
  z: number;
  hp: number;
  maxHp: number;
  type: EnemyType;
  speed: number;
  holdT?: number;
  dead?: boolean;
}

export interface Bullet {
  x: number;
  z: number;
  tx: number;
  tz: number;
  done?: boolean;
}

/** 运行时障碍:配置 + 此刻中心 x(roller 每帧刷新）。 */
export interface Obstacle extends ObstacleConfig {
  cx: number;
}

export interface Barrier extends BarrierConfig {
  maxHp: number;
}

export interface Barrel extends BarrelConfig {
  maxHp: number;
  dead?: boolean;
  engaged?: boolean;
}

export interface Boss extends BossConfig {
  maxHp: number;
  phase: number;
}

// —— 每帧事件,表现层消费 ——

export type GameEvent =
  | { kind: 'gate'; gate: GateConfig; effect: GateEffect; before: Stats; after: Stats }
  | { kind: 'obstacleHit'; obstacle: Obstacle; x: number; loss: number }
  | { kind: 'barrierIn'; barrier: Barrier }
  | { kind: 'barrierDown'; barrier: Barrier }
  | { kind: 'breakWave'; z: number; range: number; killed: number; held: number }
  | { kind: 'kill'; x: number; z: number; type: EnemyType; by?: string }
  | { kind: 'leak'; count: number; loss: number; xs: number[] }
  | { kind: 'trample'; count: number; xs: number[] }
  | { kind: 'barrelHit'; barrel: Barrel }
  | { kind: 'barrelBreak'; barrel: Barrel; reward: BarrelReward; before: Stats; after: Stats; gain: number; sec?: number }
  | { kind: 'bossIn'; boss: Boss }
  | { kind: 'bossDown'; boss: Boss }
  | { kind: 'bossHit' };

/**
 * 通关 / 失败结算(core/game.js #win / #fail 的产物）。
 * 星级不由 core 算(core 保持真源、不进 starRating):接线层用 starRating(fPeak,targetF) 算出后
 * 回填到 `star`,供 Progress.applyLevelResult 结算金币/星级(§8 换了分母,公式框架照旧复用)。
 */
export interface LevelResult {
  win: boolean;
  /** 失败原因:trap / obstacle / overrun / boss。 */
  reason?: string;
  fPeak: number;
  targetF: number;
  /** 最优度 fPeak/targetF,仅通关时有。 */
  ratio?: number;
  stats?: Stats;
  kills: number;
  leaks: number;
  time: number;
  /** 接线层回填(core 不设):starRating(fPeak, targetF, thresholds)。 */
  star?: number;
}

// —— 养成与存档(§9,四条曲线) ——

/** 养成升级项:起始的四维各一条曲线。 */
export type UpgradeKind = 'N0' | 'L0' | 'R0' | 'D0';

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
  /** 皮肤碎片:签到第 7 天与部分每日任务的奖励;皮肤本体是后续需求。 */
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
