// 微信小游戏全局 wx 的唯一取用口 —— 只声明本任务用到的那几个接口,其余不管。
// 非微信环境(编辑器预览 / web-mobile 构建)下 wx 取不到,isWx 为 false,调用方各自走占位分支。
// 刻意不做 polyfill:开放数据域在别的平台没有等价物,假装有只会把问题藏到真机上才炸。

export interface WxKvData {
  key: string;
  value: string;
}

/** 启动参数。挑战卡带的 act/lv/score/from 就在 query 里(spec §4.2)。 */
export interface WxLaunchOptions {
  query?: Record<string, string>;
}

export interface WxOpenDataContext {
  postMessage(msg: Record<string, unknown>): void;
}

/** wx.onError 的回参。老基础库给的是字符串,新的是对象,故两种都收。 */
export interface WxErrorInfo {
  message?: string;
  stack?: string;
}

export interface WxApi {
  getOpenDataContext(): WxOpenDataContext;
  setUserCloudStorage(opt: { KVDataList: WxKvData[]; success?: () => void; fail?: (err: unknown) => void }): void;
  getLaunchOptionsSync(): WxLaunchOptions;
  onShow(cb: (res: WxLaunchOptions) => void): void;
  /** 键不存在时返回空串(不是 null),读的一方要自己当没有处理。 */
  getStorageSync(key: string): string;
  setStorageSync(key: string, data: string): void;
  onHide(cb: () => void): void;
  onError(cb: (err: WxErrorInfo | string) => void): void;
  loadSubpackage(opt: { name: string; success?: () => void; fail?: (err: unknown) => void }): unknown;
}

declare const wx: WxApi | undefined;

export const wxApi: WxApi | null = typeof wx !== 'undefined' ? wx : null;

/** 真机 / 微信开发者工具里才为 true。web 预览下排行榜走占位,挑战分享静默跳过。 */
export const isWx: boolean = !!(wxApi && wxApi.getOpenDataContext);

/**
 * 微信分包按需下载(T8:美术整体是一个分包,见 build-templates/wechatgame/game.json)。
 * 分包里的文件在下载完成前 require 不到,所以 loadBundle 必须排在它后面。
 *
 * 非微信环境、以及该名字压根没被声明成分包时,直接回调放行 —— 分包只是包体布局,
 * 不该在编辑器预览 / web 构建里凭空多出一个故障点。下载失败也照样放行:
 * 让后面的 loadBundle 自己报它那句错,比在这里静默断链好查。
 */
export function loadSubpackage(name: string, done: () => void): void {
  if (!wxApi || typeof wxApi.loadSubpackage !== 'function') { done(); return; }
  wxApi.loadSubpackage({
    name,
    success: done,
    fail: (err) => { console.error('[wx] 分包下载失败', name, err); done(); },
  });
}
