// 签到 / 每日任务 / 分享的总装(《签到任务分享系统设计》§4 系统联动)。
// 三个子系统都是纯规则,本文件负责:存档读写、跨日刷新、发奖、埋点分发、给 UI 一份现成视图。
// 同样零 cc 依赖 —— 平台相关的东西(存储、广告、分享、埋点上报)一律按端口注入。
//
// ⚠️ 依赖按端口注入,systems 不直接 import core/AdManager 与 core/Analytics —— 那两个文件属
// T9 边界,接线在 GameController.boot 一处完成,这里只认接口(也才好在 node 里裸跑验证)。
//   · analytics 缺省 → 落 console;
//   · ad 缺省 / 该位没配 adUnitId → 补签不可用(UI 是禁用态,不会静默发奖)。
// ⚠️ 补签的广告位:《广告接入spec.md》§2 的 scene 表里**没有补签这一位**,AdScene 也就没有它。
// 加广告位要动 spec + T9 的文件,不是本任务的边界,故这里照常传 'sign_makeup' —— adManager 查
// 不到 unitMap 就 canShow=false,按钮置灰。主控在 spec §2 补一行、ad.json 配上 ID 即可点亮。
// ad_reward 埋点:AdManager 只发 ad_request/ad_show/ad_close/ad_error,按广告spec §6 由发奖方
// 补 ad_reward,故本文件发这一条不会与 AdManager 重复。

import type { Reward } from '../defs/types';
import { EventBus } from './EventBus';
import type { TrackParams } from './EventBus';
import { Sign, createSignData } from './Sign';
import type { SignConfig, SignData, SignReward, SignState } from './Sign';
import { DailyTask } from './DailyTask';
import type { TaskConfig, TaskData, TaskView } from './DailyTask';
import { Share, createShareData } from './Share';
import type { ShareConfig, ShareData, ShareParams, ShareScene } from './Share';

export interface DailyConfig {
  sign: SignConfig;
  task: TaskConfig;
  share: ShareConfig;
}

/** 存档读写口(平台实现见 game/StorageAdapter.ts)。 */
export interface KvStore {
  load(): unknown;
  save(data: unknown): void;
}

/** 发奖口 —— 就是 core/progress.ts 的 Progress。金币一律经它,systems 不碰存档(红线)。 */
export interface RewardSink {
  grant(reward: Reward): void;
}

/** 激励视频口 —— core/AdManager 的最小转接面(接线在 GameController)。 */
export interface AdPort {
  /** 该位现在能不能播(没配 adUnitId / 无填充 / 配额用尽都是 false)。 */
  canShow(scene: string): boolean;
  showRewarded(scene: string, done: (ok: boolean) => void): void;
}

/** 补签的广告位名。广告spec §2 的 scene 表里还没有它,故 canShow 恒 false → 按钮置灰。 */
export const MAKEUP_SCENE = 'sign_makeup';

/** 埋点口 —— T8 的 Analytics 到位后由它实现。 */
export interface AnalyticsPort {
  track(evt: string, params: TrackParams): void;
}

/** 分享口 —— 微信侧 wx.shareAppMessage,见 game/SharePort.ts。 */
export interface SharePort {
  share(content: { title: string; query: string }): void;
}

export interface SystemsPorts {
  ad?: AdPort;
  analytics?: AnalyticsPort;
  share?: SharePort;
  /** 本地日期取自它(spec §5:跨日判定用本地日期);测试注入固定时钟。 */
  now?: () => Date;
}

interface SystemsData {
  sign: SignData;
  task: TaskData;
  share: ShareData;
}

export class Systems {
  readonly bus = new EventBus();
  readonly sign: Sign;
  readonly task: DailyTask;
  readonly share: Share;

  private readonly store: KvStore;
  private readonly rewards: RewardSink;
  private readonly ports: SystemsPorts;
  private data: SystemsData;

  constructor(config: DailyConfig, store: KvStore, rewards: RewardSink, ports: SystemsPorts = {}) {
    this.sign = new Sign(config.sign);
    this.task = new DailyTask(config.task);
    this.share = new Share(config.share);
    this.store = store;
    this.rewards = rewards;
    this.ports = ports;

    this.data = this.migrate(store.load());
    this.rollover();

    // 任务进度靠订阅埋点事件推进(§2),玩法侧只管 track —— 加减任务只动配置表,玩法代码不用改
    const events = new Set(config.task.pool.map((t) => t.ev));
    events.forEach((ev) => this.bus.on(ev, (params) => this.onTaskEvent(ev, params)));
  }

  // —— 埋点(§4)——

  /** 本系统自己的埋点(sign_claim / task_claim / share_click / ad_reward):上报 + 进总线。 */
  track(evt: string, params: TrackParams = {}): void {
    if (this.ports.analytics) this.ports.analytics.track(evt, params);
    else console.log('[track]', evt, params);
    this.bus.emit(evt, params);
  }

  /**
   * 玩法事件入口(level_win / gate_pick):**只进总线推任务进度,不上报埋点**。
   * 玩法埋点是《P0工程骨架》T12 的活,这里替它上报会和它撞成两条。T12 落地后把
   * GameController 里的 feed 换成"Analytics.track + systems.feed"即可,任务侧不用改。
   */
  feed(evt: string, params: TrackParams = {}): void {
    this.bus.emit(evt, params);
  }

  // —— 跨日 ——

  /** 跨日刷新:任务重抽、分享次数清零、签到 claimedToday 归位。进游戏与切回前台各调一次。 */
  rollover(): void {
    const today = this.todayKey();
    const sign = this.sign.rollover(this.data.sign, today);
    const task = this.data.task.date === today ? this.data.task : this.task.roll(today);
    const share = this.data.share.date === today ? this.data.share : createShareData(today);
    if (sign === this.data.sign && task === this.data.task && share === this.data.share) return;
    this.data = { sign, task, share };
    this.save();
  }

  // —— 签到(§1)——

  signState(): SignState {
    return this.sign.state(this.data.sign, this.todayKey(), this.yesterdayKey());
  }

  /** 领今日签到;已领过返回 null。 */
  claimSign(): SignReward | null {
    const res = this.sign.claim(this.data.sign, this.todayKey(), this.yesterdayKey());
    if (!res) return null;
    this.data = { ...this.data, sign: res.data };
    this.save();
    this.rewards.grant(res.reward);
    this.track('sign_claim', { day: res.reward.day, streak: res.data.streak });
    return res.reward;
  }

  /** 补签:看完激励视频才补(§1);没接广告或看失败一律不补。 */
  makeupSign(done: (ok: boolean) => void): void {
    if (!this.signState().canMakeup || !this.adReady) { done(false); return; }
    this.ports.ad.showRewarded(MAKEUP_SCENE, (ok) => {
      const next = ok ? this.sign.makeup(this.data.sign, this.todayKey(), this.yesterdayKey()) : null;
      if (!next) { done(false); return; }
      this.data = { ...this.data, sign: next };
      this.save();
      // 字段口径照广告spec §6:scene / rewardType / rewardValue
      this.track('ad_reward', { scene: 'sign_makeup', rewardType: 'sign_makeup', rewardValue: 1 });
      done(true);
    });
  }

  /** 补签广告位现在能不能播 —— UI 拿它决定补签按钮是不是禁用态。 */
  get adReady(): boolean { return !!this.ports.ad && this.ports.ad.canShow(MAKEUP_SCENE); }

  // —— 每日任务(§2)——

  taskViews(): TaskView[] { return this.task.views(this.data.task); }

  taskAllDone(): boolean { return this.task.allDone(this.data.task); }

  taskAllClaimed(): boolean { return this.data.task.allClaimed; }

  claimTask(id: string): Reward | null {
    const res = this.task.claim(this.data.task, id);
    if (!res) return null;
    this.data = { ...this.data, task: res.data };
    this.save();
    this.rewards.grant(res.reward);
    this.track('task_claim', { id });
    return res.reward;
  }

  /** 全清宝箱。 */
  claimAllTasks(): Reward | null {
    const res = this.task.claimAll(this.data.task);
    if (!res) return null;
    this.data = { ...this.data, task: res.data };
    this.save();
    this.rewards.grant(res.reward);
    this.track('task_claim', { id: 'all_clear' });
    return res.reward;
  }

  private onTaskEvent(evt: string, params: TrackParams): void {
    const res = this.task.apply(this.data.task, evt, params);
    if (!res) return;
    this.data = { ...this.data, task: res.data };
    this.save();
    for (const id of res.changed) {
      const view = this.taskViews().find((v) => v.def.id === id);
      if (view) this.reportProgress(id, view.progress, view.def.target);
    }
  }

  /** task_progress 只上报,不再进总线 —— 免得任务系统自己喂自己。 */
  private reportProgress(id: string, progress: number, target: number): void {
    const params: TrackParams = { id, progress, target };
    if (this.ports.analytics) this.ports.analytics.track('task_progress', params);
    else console.log('[track]', 'task_progress', params);
  }

  // —— 分享(§3)——

  /**
   * 点击即分享并结算奖励。§3.2:微信判断不了分享成没成,所以这里不等回调,
   * 点了就发 —— 但每天只发第一次,连点第二次 reward 为 null。
   */
  doShare(scene: ShareScene, params: ShareParams = {}): Reward | null {
    const content = this.share.build(scene, params);
    if (!content) return null;
    if (this.ports.share) this.ports.share.share(content);

    const res = this.share.onShared(this.data.share);
    this.data = { ...this.data, share: res.data };
    this.save();
    if (res.reward) this.rewards.grant(res.reward);
    this.track('share_click', { scene, rewarded: !!res.reward });
    return res.reward;
  }

  shareRewardTaken(): boolean { return this.data.share.dailyRewardClaimed; }

  // —— 红点(§4 UI)——

  /** 今日还没签 → 亮。 */
  get signRedDot(): boolean { return !this.signState().claimedToday; }

  /** 有任务能领 or 全清宝箱能开 → 亮。 */
  get taskRedDot(): boolean { return this.task.hasClaimable(this.data.task); }

  // —— 存档 ——

  private save(): void { this.store.save(this.data); }

  /** 脏档兜底:缺字段 / 类型不对一律回默认值,跨日的部分交给 rollover。 */
  private migrate(raw: unknown): SystemsData {
    const src = (raw && typeof raw === 'object' ? raw : {}) as Partial<SystemsData>;
    const today = this.todayKey();
    const sign = src.sign && typeof src.sign === 'object' ? src.sign : createSignData();
    return {
      sign: {
        lastSignDate: str(sign.lastSignDate),
        streak: int(sign.streak),
        claimedToday: !!sign.claimedToday,
        makeupDate: str(sign.makeupDate),
        makeupCount: int(sign.makeupCount),
      },
      task: src.task && Array.isArray(src.task.tasks)
        ? {
          date: str(src.task.date),
          // 逐条洗一遍:脏 progress 会一路 NaN 传染到进度条与领取判定
          tasks: src.task.tasks.map((t) => ({
            id: str(t && t.id), progress: int(t && t.progress), claimed: !!(t && t.claimed),
          })).filter((t) => t.id !== ''),
          allClaimed: !!src.task.allClaimed,
        }
        : this.task.roll(today),
      share: src.share && typeof src.share === 'object'
        ? {
          date: str(src.share.date),
          sharedCountToday: int(src.share.sharedCountToday),
          dailyRewardClaimed: !!src.share.dailyRewardClaimed,
        }
        : createShareData(today),
    };
  }

  // —— 本地日期(spec §5:接受改设备时间刷奖的风险)——

  private now(): Date { return this.ports.now ? this.ports.now() : new Date(); }

  private todayKey(): string { return dateKey(this.now()); }

  private yesterdayKey(): string {
    const d = this.now();
    d.setDate(d.getDate() - 1);
    return dateKey(d);
  }
}

function dateKey(d: Date): string {
  const m = d.getMonth() + 1;
  const day = d.getDate();
  return `${d.getFullYear()}-${m < 10 ? '0' : ''}${m}-${day < 10 ? '0' : ''}${day}`;
}

function str(v: unknown): string { return typeof v === 'string' ? v : ''; }

function int(v: unknown): number {
  const n = Math.floor(Number(v));
  return Number.isFinite(n) && n >= 0 ? n : 0;
}
