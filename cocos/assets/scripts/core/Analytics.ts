// 埋点桩 —— 引擎无关,先落 console + 内存缓冲,上报通道(微信数据助手 / 第三方)后面再接。
// ⚠️ 本该是 T8 的交付物(《任务提示词》T8-5),仓库里还没有,T9 按《广告接入spec.md》§6
// 先补一份最小实现:字段口径先定死,以后换真通道只改本文件,调用点不动。

export type AnalyticsParams = Record<string, string | number | boolean>;

/** 缓冲上限:够在开发者工具里回看一局,又不至于长跑吃内存。 */
const BUFFER_MAX = 200;

export interface AnalyticsRecord {
  evt: string;
  params: AnalyticsParams;
  t: number;
}

export const buffer: AnalyticsRecord[] = [];

export function track(evt: string, params: AnalyticsParams = {}): void {
  buffer.push({ evt, params, t: Date.now() });
  if (buffer.length > BUFFER_MAX) buffer.shift();
  console.log('[track]', evt, JSON.stringify(params));
}
