// 分享平台适配 —— wx.shareAppMessage(《签到任务分享系统设计》§3)。平台 API 收在表现层,
// systems/ 只认端口(同 StorageAdapter 的分工)。
//
// ⚠️ §3.2:微信**已取消分享成功回调**,shareAppMessage 既没有返回值也没有可等的回调,
// 判断不了分享成没成、有没有人点开。所以这里只管发起,发不发奖由 systems 按
// 「点击即发 + 每日限次」自己结算 —— 不要在这儿加任何"分享是否成功"的判断。

import type { SharePort } from '../systems/Systems';

/** 微信分享 API 的最小签名。工程没装 @types/wechat-minigame,按官方文档列用到的字段。 */
interface WxShareApi {
  shareAppMessage(opts: { title: string; query: string }): void;
}

function wxShareApi(): WxShareApi | null {
  const g = globalThis as any;
  return g.wx && typeof g.wx.shareAppMessage === 'function' ? g.wx : null;
}

export const cocosSharePort: SharePort = {
  share(content: { title: string; query: string }): void {
    const api = wxShareApi();
    // 浏览器预览没有 wx:照常走完发奖与埋点,只是弹不出微信的分享面板
    if (!api) { console.log('[share] 非微信环境,跳过面板', content); return; }
    api.shareAppMessage({ title: content.title, query: content.query });
  },
};
