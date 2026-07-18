// 定向挑战 PK(spec §4.2)—— 分享参数传递 + 本地对比,不碰服务器。
// A 通关 → 分享带 query → B 从卡片进来解析出关卡与目标分 → B 打完本地判胜负 → B 可回敬。

import { track } from '../core/Analytics';
import { isWx, wxApi } from './WxApi';

export interface ChallengeInvite {
  level: number;
  /** 好友这一关的成绩(峰值兵力),就是要超过的目标分。 */
  score: number;
  from: string;
}

/**
 * 解析挑战卡参数。关卡号越界(好友版本比我新)或分数不合法一律返回 null 当普通启动 ——
 * 分享参数可篡改是 spec §7 认下的风险,但不能让它把游戏带进不存在的关卡。
 */
export function parseInvite(query: Record<string, string> | undefined, levelCount: number): ChallengeInvite | null {
  if (!query || query.act !== 'challenge') return null;
  const level = Math.floor(Number(query.lv));
  const score = Math.floor(Number(query.score));
  if (!(level >= 1 && level <= levelCount)) return null;
  if (!(score > 0)) return null;
  // from 只解析不发送:主域拿不到真实昵称(微信 2021 年后 getUserInfo 只回匿名数据,
  // 要昵称得走用户点击授权按钮)。留着解析,日后谁补上昵称来源就能直接显示。
  return { level, score, from: query.from || '好友' };
}

/** 冷启动:从挑战卡直接点进来的那一次。 */
export function readLaunchInvite(levelCount: number): ChallengeInvite | null {
  if (!isWx) return null;
  return parseInvite(wxApi.getLaunchOptionsSync().query, levelCount);
}

/** 热启动:游戏在后台时点挑战卡,只会走 onShow,不会重跑 getLaunchOptionsSync。 */
export function watchInvite(levelCount: number, onInvite: (invite: ChallengeInvite) => void): void {
  if (!isWx) return;
  wxApi.onShow((res) => {
    const invite = parseInvite(res && res.query, levelCount);
    if (invite) onInvite(invite);
  });
}

/**
 * 发起挑战 / 回敬挑战的埋点。分享动作本身走 T11 的 Systems.doShare('challenge'),
 * 它拼出来的 query 就是 act=challenge&lv=..&score=..(见 config/daily.json 的 challenge 场景,
 * T11 标了"T10 排行榜复用"),正好是下面 parseInvite 认的格式 —— 不另起一条 shareAppMessage。
 * 微信早就取消了分享成功回调,所以埋点只能打在点击这一刻。
 */
export function trackSend(level: number, score: number): void {
  track('challenge_send', { level, score });
}

export function trackAccept(invite: ChallengeInvite): void {
  track('challenge_accept', { level: invite.level, friendScore: invite.score });
}

/** 本局峰值对好友目标分,平手算没超过(要"超过"才算赢)。 */
export function judge(invite: ChallengeInvite, myScore: number): boolean {
  const win = myScore > invite.score;
  track('challenge_result', { level: invite.level, myScore, friendScore: invite.score, win });
  return win;
}
