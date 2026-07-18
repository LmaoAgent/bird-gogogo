// 每日签到(《签到任务分享系统设计》§1)—— 纯规则,零 cc 依赖,日期与存档都由外部喂进来。
//
// ⚠️ 真源只有 lastSignDate + streak 两个字段:今天领没领、断没断签、今天该领第几天全部现算,
// **读取时不改档**。否则跨日一进游戏就把 streak 清零,补签就再也补不回来了(补签正是靠把
// lastSignDate 挪回昨天来续上连签的)。

import type { Reward } from '../defs/types';

export interface SignReward extends Reward {
  day: number;
}

export interface SignConfig {
  makeupPerDay: number;
  rewards: SignReward[];
}

export interface SignData {
  lastSignDate: string;
  streak: number;
  /** spec §1 列的字段;真值等价于 lastSignDate === 今天,存一份只为存档自解释。 */
  claimedToday: boolean;
  /** 补签用在哪天 + 那天已补几次,凑成"每日限次"。 */
  makeupDate: string;
  makeupCount: number;
}

/** 今日签到的现算状态,UI 与发奖都只看它。 */
export interface SignState {
  /** 今天该领第几天(1~7);已领则是刚领到的那天。 */
  day: number;
  /** 领完今天之后的连签天数。 */
  streak: number;
  claimedToday: boolean;
  /** 断签了:昨天没签,且不是头一回玩。 */
  broken: boolean;
  canMakeup: boolean;
}

export function createSignData(): SignData {
  return { lastSignDate: '', streak: 0, claimedToday: false, makeupDate: '', makeupCount: 0 };
}

export class Sign {
  private readonly config: SignConfig;

  constructor(config: SignConfig) {
    this.config = config;
  }

  /** 7 天一轮的第几格。 */
  get cycle(): number { return this.config.rewards.length; }

  get rewards(): SignReward[] { return this.config.rewards; }

  state(data: SignData, today: string, yesterday: string): SignState {
    const claimedToday = data.lastSignDate === today;
    const continued = data.lastSignDate === yesterday;
    // 没领时算的是"领了之后会变成几天":接得上就 +1,接不上从头来(断签重置到第 1 天)
    const streak = claimedToday ? data.streak : (continued ? data.streak + 1 : 1);
    const broken = !claimedToday && !continued && data.lastSignDate !== '';
    return {
      day: ((streak - 1) % this.cycle) + 1,
      streak,
      claimedToday,
      broken,
      canMakeup: broken && this.makeupLeft(data, today) > 0,
    };
  }

  /** 领今日签到;已领过返回 null,调用方据此不发奖不埋点。 */
  claim(data: SignData, today: string, yesterday: string): { data: SignData; reward: SignReward } | null {
    const st = this.state(data, today, yesterday);
    if (st.claimedToday) return null;
    const reward = this.config.rewards[st.day - 1];
    if (!reward) return null;
    return {
      data: { ...data, lastSignDate: today, streak: st.streak, claimedToday: true },
      reward,
    };
  }

  /**
   * 补签:把 lastSignDate 挪回昨天,连签不断,再领今日就续上了。
   * 只有看完激励视频才调(§1 补签＝看广告),且每日限 makeupPerDay 次。
   */
  makeup(data: SignData, today: string, yesterday: string): SignData | null {
    if (!this.state(data, today, yesterday).canMakeup) return null;
    return {
      ...data,
      lastSignDate: yesterday,
      makeupDate: today,
      makeupCount: this.usedToday(data, today) + 1,
    };
  }

  /** 跨日:claimedToday 归位(spec §1「跨日重置 claimedToday」)。streak 不动,断签在现算里体现。 */
  rollover(data: SignData, today: string): SignData {
    const claimedToday = data.lastSignDate === today;
    return claimedToday === data.claimedToday ? data : { ...data, claimedToday };
  }

  private usedToday(data: SignData, today: string): number {
    return data.makeupDate === today ? data.makeupCount : 0;
  }

  private makeupLeft(data: SignData, today: string): number {
    return Math.max(0, this.config.makeupPerDay - this.usedToday(data, today));
  }
}
