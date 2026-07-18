// 每日任务(《签到任务分享系统设计》§2)—— 纯规则,零 cc 依赖。
// 进度全部由埋点事件驱动(level_win / gate_pick / ad_reward / share_click),玩法侧只管 track,
// 这里订阅同一批事件推进度,所以加减任务只动 config/daily.json,玩法代码一行不用改。
//
// ⚠️ 存档里**不存 target**(spec 的 DailyTask 结构里有):target 的真源是配置表,存下来会在
// 调表后被旧值冻住。存的只有 { id, progress, claimed },展示时再和配置合成视图。

import type { Reward } from '../defs/types';
import type { TrackParams } from './EventBus';

export interface TaskDef {
  id: string;
  desc: string;
  /** 监听的埋点事件名。 */
  ev: string;
  target: number;
  /** 有 field 则按单局最好成绩记(取 max),没有则按次数累加。 */
  field?: string;
  /** 必出的核心任务。 */
  fixed?: boolean;
  reward: Reward;
}

export interface TaskConfig {
  dailyCount: number;
  allClearReward: Reward;
  pool: TaskDef[];
}

export interface TaskState {
  id: string;
  progress: number;
  claimed: boolean;
}

export interface TaskData {
  date: string;
  tasks: TaskState[];
  allClaimed: boolean;
}

/** 配置 + 存档合成的展示用视图。 */
export interface TaskView {
  def: TaskDef;
  progress: number;
  claimed: boolean;
  done: boolean;
  claimable: boolean;
}

export class DailyTask {
  private readonly config: TaskConfig;

  constructor(config: TaskConfig) {
    this.config = config;
  }

  get allClearReward(): Reward { return this.config.allClearReward; }

  /** 抽当天的任务:fixed 必出,其余按日期确定性洗牌补满 —— 同一天重进游戏抽到的是同一批。 */
  roll(date: string): TaskData {
    const fixed = this.config.pool.filter((t) => t.fixed);
    const rest = shuffleBySeed(this.config.pool.filter((t) => !t.fixed), hash(date));
    const picked = fixed.concat(rest).slice(0, Math.min(this.config.dailyCount, this.config.pool.length));
    return {
      date,
      tasks: picked.map((t) => ({ id: t.id, progress: 0, claimed: false })),
      allClaimed: false,
    };
  }

  /** 埋点事件 → 进度。返回 null 表示这条事件与今天的任务无关,调用方就不落盘不埋点。 */
  apply(data: TaskData, evt: string, params: TrackParams): { data: TaskData; changed: string[] } | null {
    const changed: string[] = [];
    const tasks = data.tasks.map((t) => {
      const def = this.defOf(t.id);
      if (!def || def.ev !== evt || t.claimed) return t;
      const raw = def.field ? Math.max(t.progress, Number(params[def.field]) || 0) : t.progress + 1;
      const progress = Math.min(raw, def.target);
      if (progress === t.progress) return t;
      changed.push(t.id);
      return { ...t, progress };
    });
    return changed.length ? { data: { ...data, tasks }, changed } : null;
  }

  /** 领单个任务;没做完 / 已领过返回 null。 */
  claim(data: TaskData, id: string): { data: TaskData; reward: Reward } | null {
    const def = this.defOf(id);
    const task = data.tasks.find((t) => t.id === id);
    if (!def || !task || task.claimed || task.progress < def.target) return null;
    return {
      data: { ...data, tasks: data.tasks.map((t) => (t.id === id ? { ...t, claimed: true } : t)) },
      reward: def.reward,
    };
  }

  /** 全清宝箱:今天的任务全部领完才给,每日一次。 */
  claimAll(data: TaskData): { data: TaskData; reward: Reward } | null {
    if (data.allClaimed || !this.allDone(data)) return null;
    return { data: { ...data, allClaimed: true }, reward: this.config.allClearReward };
  }

  allDone(data: TaskData): boolean {
    return data.tasks.length > 0 && data.tasks.every((t) => t.claimed);
  }

  /** 有任何能领的东西(单个任务或全清宝箱)——主界面红点就看它。 */
  hasClaimable(data: TaskData): boolean {
    return this.views(data).some((v) => v.claimable) || (this.allDone(data) && !data.allClaimed);
  }

  views(data: TaskData): TaskView[] {
    const out: TaskView[] = [];
    for (const t of data.tasks) {
      const def = this.defOf(t.id);
      if (!def) continue;   // 配置里删掉的任务:当天存档里的残留直接不展示
      const done = t.progress >= def.target;
      out.push({ def, progress: t.progress, claimed: t.claimed, done, claimable: done && !t.claimed });
    }
    return out;
  }

  private defOf(id: string): TaskDef | undefined {
    return this.config.pool.find((t) => t.id === id);
  }
}

/** FNV-1a:拿日期当种子,同一天任何时候抽到的任务都一样,重进游戏不换题。 */
function hash(s: string): number {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) h = Math.imul(h ^ s.charCodeAt(i), 16777619);
  return h >>> 0;
}

/** 种子洗牌(LCG,只为把池子打乱,不作加密用途)。 */
function shuffleBySeed<T>(list: T[], seed: number): T[] {
  const out = list.slice();
  let s = seed || 1;
  for (let i = out.length - 1; i > 0; i--) {
    s = (Math.imul(s, 1103515245) + 12345) >>> 0;
    const j = s % (i + 1);
    const tmp = out[i];
    out[i] = out[j];
    out[j] = tmp;
  }
  return out;
}
