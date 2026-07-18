// 分享(《签到任务分享系统设计》§3)—— 纯规则,零 cc 依赖;真正调 wx.shareAppMessage 的平台
// 实现由外部端口注入(见 game/SharePort.ts)。
//
// ⚠️ §3.2 的坑:**微信已取消分享成功回调**,`wx.shareAppMessage` 判断不了分享成没成、有没有人点。
// 所以这里不做任何"分享是否成功"的判断,奖励按「点击分享即发」,并且**每日只发第一次**,
// 靠每日限次防刷(spec 明确接受这点薅羊毛)。深度裂变(好友助力)要服务器,spec 已标后置。

import type { Reward } from '../defs/types';

/** §3.1 四个场景:晒战绩 / 挑战好友(T10 排行榜复用)/ 求复活 / 每日分享任务。 */
export type ShareScene = 'result' | 'challenge' | 'revive_help' | 'daily';

export interface ShareConfig {
  reward: Reward;
  scenes: Record<string, { title: string }>;
}

export interface ShareData {
  date: string;
  sharedCountToday: number;
  dailyRewardClaimed: boolean;
}

/** 拼进 query 的业务参数(§3.1)。 */
export interface ShareParams {
  lv?: number;
  score?: number;
  from?: string;
}

export interface ShareContent {
  title: string;
  query: string;
}

export function createShareData(date: string): ShareData {
  return { date, sharedCountToday: 0, dailyRewardClaimed: false };
}

export class Share {
  private readonly config: ShareConfig;

  constructor(config: ShareConfig) {
    this.config = config;
  }

  /** 组一条分享内容;场景没配返回 null。 */
  build(scene: ShareScene, params: ShareParams): ShareContent | null {
    const conf = this.config.scenes[scene];
    if (!conf) return null;
    const parts = [`act=${scene}`];
    if (params.lv !== undefined) parts.push(`lv=${params.lv}`);
    if (params.score !== undefined) parts.push(`score=${params.score}`);
    if (params.from !== undefined) parts.push(`from=${encodeURIComponent(params.from)}`);
    return {
      title: conf.title
        .replace('{lv}', String(params.lv ?? ''))
        .replace('{score}', String(params.score ?? '')),
      query: parts.join('&'),
    };
  }

  /**
   * 点了分享之后记一笔。reward 只有当天第一次分享才非空 —— 连点第二次拿不到东西(验收 ③)。
   * 注意入参 data 必须是当天的(跨日由 Systems.rollover 先重置)。
   */
  onShared(data: ShareData): { data: ShareData; reward: Reward | null } {
    const first = !data.dailyRewardClaimed;
    return {
      data: {
        ...data,
        sharedCountToday: data.sharedCountToday + 1,
        dailyRewardClaimed: true,
      },
      reward: first ? this.config.reward : null,
    };
  }
}
