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

export interface WxApi {
  getOpenDataContext(): WxOpenDataContext;
  setUserCloudStorage(opt: { KVDataList: WxKvData[]; success?: () => void; fail?: (err: unknown) => void }): void;
  getLaunchOptionsSync(): WxLaunchOptions;
  onShow(cb: (res: WxLaunchOptions) => void): void;
}

declare const wx: WxApi | undefined;

export const wxApi: WxApi | null = typeof wx !== 'undefined' ? wx : null;

/** 真机 / 微信开发者工具里才为 true。web 预览下排行榜走占位,挑战分享静默跳过。 */
export const isWx: boolean = !!(wxApi && wxApi.getOpenDataContext);
