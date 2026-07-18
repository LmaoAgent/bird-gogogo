// 局外成长与存档 —— 引擎无关,零 DOM / 零平台 API。存储走注入的 adapter(load/save)。
// 对应 PRD §5 轻养成(首发单货币＝金币,无钻石)与《玩法数值与关卡设计》§2 起始兵力 / §4.2 单兵 DPS / §6 星级。
// 数值全部来自 config/upgrade.json,此处只实现规则。
// 纯函数吃的 save 均为 migrate() 的产物;config 为 upgrade.json 解析后的对象(core 不会自己去读文件)。

export const SAVE_VERSION = 1;

const MAX_STAR = 3;   // §6 三星制

/** 全新存档。maxLevel＝已通关的最高关(0＝一关没过),下一关＝maxLevel+1。 */
export function createSave() {
  return {
    version: SAVE_VERSION,
    maxLevel: 0,
    coins: 0,
    upgrades: { startArmy: 1, unitPower: 1 },
    stars: {},
  };
}

// —— 存档迁移 ——

/**
 * 兜底迁移：缺字段/脏字段一律补默认值,后续加字段不炸档。
 * 目前只有 v1;将来若有语义变更(改单位、改含义)再按 version 加分支,单纯加字段本函数已覆盖。
 */
export function migrate(raw) {
  if (!raw || typeof raw !== 'object') return createSave();
  const upgrades = raw.upgrades && typeof raw.upgrades === 'object' ? raw.upgrades : {};
  return {
    version: SAVE_VERSION,
    maxLevel: intAtLeast(raw.maxLevel, 0),
    coins: intAtLeast(raw.coins, 0),
    upgrades: {
      startArmy: intAtLeast(upgrades.startArmy, 1),
      unitPower: intAtLeast(upgrades.unitPower, 1),
    },
    stars: migrateStars(raw.stars),
  };
}

/** 脏值兜底：能取到不小于 min 的整数就用,否则回落 min。 */
function intAtLeast(v, min) {
  const n = Math.floor(Number(v));
  return Number.isFinite(n) && n >= min ? n : min;
}

function migrateStars(raw) {
  const stars = {};
  if (!raw || typeof raw !== 'object') return stars;
  for (const key of Object.keys(raw)) {
    const level = Number(key);
    const star = Math.min(intAtLeast(raw[key], 0), MAX_STAR);
    if (Number.isInteger(level) && level > 0 && star > 0) stars[level] = star;
  }
  return stars;
}

// —— 关卡结算 ——

/** 通关金币：coinBase × 关卡 + 星级奖励,参数全在 upgrade.json.rewards。 */
export function levelCoins(level, star, config) {
  const { coinBase, starBonus } = config.rewards;
  return Math.floor(coinBase * level + (starBonus[star] || 0));
}

/**
 * 通关写档：最高关卡、该关星级(取更高)、结算金币。未通关原样返回(不写档、不给币)。
 * result 直接吃 game.js 的 this.result:{ win, star, ... }。
 */
export function applyLevelResult(save, level, result, config) {
  if (!result || !result.win) return save;
  const star = Math.min(intAtLeast(result.star, 0), MAX_STAR);
  return {
    ...save,
    maxLevel: Math.max(save.maxLevel, level),
    coins: save.coins + levelCoins(level, star, config),
    stars: { ...save.stars, [level]: Math.max(save.stars[level] || 0, star) },
  };
}

// —— 升级曲线(§2 起始兵力 / §4.2 单兵 DPS) ——

function curveOf(config, kind) {
  const levels = config.curves[kind] && config.curves[kind].levels;
  if (!levels) throw new Error(`upgrade.json 缺少升级曲线: ${kind}`);
  return levels;
}

/** 曲线档位(下标＝level-1);等级越界(脏档/曲线被改短)夹取在曲线内。 */
function entryAt(levels, level) {
  return levels[Math.min(Math.max(level, 1), levels.length) - 1];
}

/**
 * 曲线增益叠加在 tuning 基线上：曲线 level 1 即基线,故未升级时与 tuning 完全一致;
 * 基线日后被调参改动时整条曲线跟随平移,不产生第二处数值真源。
 */
function curveValue(save, kind, config, base) {
  const levels = curveOf(config, kind);
  return base + entryAt(levels, save.upgrades[kind]).value - levels[0].value;
}

/** 下一档 {level,value,cost};已满级返回 null。升级面板拿它显示"→13 / 100 金币"。 */
export function nextUpgrade(save, kind, config) {
  const levels = curveOf(config, kind);
  return levels[save.upgrades[kind]] || null;   // 下标＝当前等级 → 下一档
}

/** 未满级且金币够。 */
export function canUpgrade(save, kind, config) {
  const next = nextUpgrade(save, kind, config);
  return !!next && save.coins >= next.cost;
}

/** 扣币升一级;不满足(已满级/币不够)时原样返回入参存档。 */
export function applyUpgrade(save, kind, config) {
  if (!canUpgrade(save, kind, config)) return save;
  const next = nextUpgrade(save, kind, config);
  return {
    ...save,
    coins: save.coins - next.cost,
    upgrades: { ...save.upgrades, [kind]: next.level },
  };
}

/** 起始兵力 N0(§2)：Game 构造时替代 tuning.startArmy。 */
export function getStartArmy(save, tuning, config) {
  return curveValue(save, 'startArmy', config, tuning.startArmy);
}

/** 单兵 DPS d(§4.2)：只影响对撞演出时长,不改胜负结果。 */
export function getUnitPower(save, tuning, config) {
  return curveValue(save, 'unitPower', config, tuning.combat.dps);
}

// —— 存档门面 ——

/**
 * 持有存储适配器与升级表,写操作即时落盘。
 * storage 只需两个方法：load(): object|null / save(obj): void。
 * 浏览器(见 src/storage.js)、微信 wx 存储、云存档各自实现一份,core 不认平台。
 */
export class Progress {
  constructor(storage, config) {
    this.storage = storage;
    this.config = config;
    this.data = migrate(storage.load());
  }

  get coins() { return this.data.coins; }
  get maxLevel() { return this.data.maxLevel; }

  /** 该关历史最佳星级(未通关 0)。 */
  starOf(level) { return this.data.stars[level] || 0; }

  /** 结算一局并落盘;返回本局收益 { coins, unlocked } 供结算页展示。 */
  applyLevelResult(level, result) {
    const before = this.data;
    this.data = applyLevelResult(before, level, result, this.config);
    if (this.data === before) return { coins: 0, unlocked: false };
    this.storage.save(this.data);
    return {
      coins: this.data.coins - before.coins,
      unlocked: this.data.maxLevel > before.maxLevel,
    };
  }

  canUpgrade(kind) { return canUpgrade(this.data, kind, this.config); }
  nextUpgrade(kind) { return nextUpgrade(this.data, kind, this.config); }

  /** 升一级并落盘;买不起或已满级返回 false。 */
  applyUpgrade(kind) {
    const before = this.data;
    this.data = applyUpgrade(before, kind, this.config);
    if (this.data === before) return false;
    this.storage.save(this.data);
    return true;
  }

  getStartArmy(tuning) { return getStartArmy(this.data, tuning, this.config); }
  getUnitPower(tuning) { return getUnitPower(this.data, tuning, this.config); }
}
