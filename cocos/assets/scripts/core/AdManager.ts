// 广告封装(《广告接入spec.md》§3)—— 上层只认 scene,微信 API 细节全收在这一层。
// core 层规矩照旧:不引 cc,只按需摸 globalThis.wx;非微信环境(浏览器预览、低版本基础库)
// 一律 canShow=false,由调用方置灰/隐藏按钮,不让玩家点了没反应(spec §3.1)。
// P0 只开 revive / double 两个位;boost / freebox / inter_level 见 spec §2,P1 再补。
//
// 红线(spec §3.1):只有 onClose 的 res.isEnded === true 才算看完,未看完一分钱奖励都不发。

import type { AdConfig, AdResult, AdScene } from '../defs/types';
import { track } from './Analytics';

const AD_TYPE = 'rewarded';

/** 本地拦截(没配 ID / 配额用尽 / 有一条在播)的 errCode,与微信自己的错误码区分开。 */
const ERR_LOCAL = 0;

/** 微信激励视频实例的最小签名。工程没装 @types/wechat-minigame,按官方文档列用到的这几个。 */
interface RewardedVideoAd {
  load(): Promise<void>;
  show(): Promise<void>;
  onLoad(cb: () => void): void;
  onError(cb: (err: { errCode?: number; errMsg?: string }) => void): void;
  onClose(cb: (res?: { isEnded?: boolean }) => void): void;
}

interface WxAdApi {
  createRewardedVideoAd(opts: { adUnitId: string }): RewardedVideoAd;
}

/** 一个 adUnitId 一份实例(spec §3.1 实例全局复用);回调只在建实例时注册一次。 */
interface AdEntry {
  ad: RewardedVideoAd;
  unitId: string;
  /** 建实例时的 scene。onLoad/onError 可能在没有 show 的时候来,拿它兜底埋点。 */
  scene: AdScene;
  loaded: boolean;
  /** 本次 show 的 onClose 回调出口;没在播时为 null。 */
  settle: ((res: AdResult) => void) | null;
}

function wxAdApi(): WxAdApi | null {
  const g = globalThis as any;
  return g.wx && typeof g.wx.createRewardedVideoAd === 'function' ? g.wx : null;
}

export class AdManager {
  private config: AdConfig = { unitMap: {}, quota: {} };
  private entries = new Map<string, AdEntry>();
  /** scene → 本局已发奖次数,频控只数"真发出去的奖"(见 showRewarded 注释)。 */
  private used: Partial<Record<AdScene, number>> = {};
  /** 正在播的广告位;非 null 即"有一条在播",用来挡并发 show 并给埋点标 scene。 */
  private current: AdScene | null = null;

  /**
   * 注入配置。spec §3 的签名是 init(unitMap),这里把频控上限一起吃进来 ——
   * §4 要求频控参数同样进配置,两样都在 config/ad.json 里,合成一个对象少一条传参链。
   */
  init(config: AdConfig): void {
    this.config = {
      unitMap: (config && config.unitMap) || {},
      quota: (config && config.quota) || {},
    };
    this.entries.clear();
    this.used = {};
    this.current = null;
  }

  /** 进游戏即预加载(spec §3.1);每次 show 完还会自动补一次 load,备下一次。 */
  preloadRewarded(): void {
    for (const scene of Object.keys(this.config.unitMap) as AdScene[]) {
      const entry = this.entryOf(scene);
      if (entry) this.load(entry);
    }
  }

  /** 开新一局:清掉每局频控计数(revive ≤2 / double 1,spec §4)。 */
  resetRun(): void {
    this.used = {};
  }

  /** 本局该位还能发几次奖。0 ＝ 配额用尽,调用方直接把按钮收起来。 */
  remaining(scene: AdScene): number {
    const quota = this.config.quota[scene] || 0;
    return Math.max(0, quota - (this.used[scene] || 0));
  }

  /** 频控 + 填充双闸门。false ＝ 按钮不许可点(置灰或隐藏,别让玩家点了没反应)。 */
  canShow(scene: AdScene): boolean {
    const entry = this.entryOf(scene);
    return !!entry && entry.loaded && !this.current && this.remaining(scene) > 0;
  }

  /**
   * 播一条激励视频,resolve 后由调用方按 ended 决定发不发奖。
   * 频控只在 ended 时记账:中途退出既不发奖也不占配额(误触不该烧掉一次复活机会)。
   */
  async showRewarded(scene: AdScene): Promise<AdResult> {
    const entry = this.entryOf(scene);
    track('ad_request', { scene, adType: AD_TYPE, adUnitId: entry ? entry.unitId : '' });

    if (!entry) return this.refuse(scene, 'no_adunit');
    if (this.current) return this.refuse(scene, 'busy');
    if (this.remaining(scene) <= 0) return this.refuse(scene, 'quota_exhausted');

    this.current = scene;
    // 出口先挂上再 show:onClose 可能在 show 的 Promise 之前就回来
    const closed = new Promise<AdResult>((resolve) => { entry.settle = resolve; });

    try {
      await this.showOnce(entry);
    } catch (err) {
      entry.settle = null;
      this.current = null;
      this.load(entry);
      return this.refuse(scene, errText(err));
    }
    track('ad_show', { scene, adType: AD_TYPE });

    const res = await closed;
    this.current = null;
    track('ad_close', { scene, ended: res.ended });
    if (res.ended) this.used[scene] = (this.used[scene] || 0) + 1;
    this.load(entry);   // 播完就补下一条(spec §3.1)
    return res;
  }

  /** spec §3.1:show 失败(没 ready / 上一条播完还没补上)先 load 再 show,只重试这一次。 */
  private async showOnce(entry: AdEntry): Promise<void> {
    try {
      await entry.ad.show();
    } catch {
      await entry.ad.load();
      await entry.ad.show();
    }
  }

  private load(entry: AdEntry): void {
    // 失败不用在这兜:onError 已经把 loaded 置回 false 并打了埋点
    entry.ad.load().catch(() => { /* noop */ });
  }

  /** 没播成:统一打 ad_error 并回一个不发奖的结果。 */
  private refuse(scene: AdScene, error: string): AdResult {
    track('ad_error', { scene, errCode: ERR_LOCAL, errMsg: error });
    return { ended: false, error };
  }

  private settleEntry(entry: AdEntry, res: AdResult): void {
    const settle = entry.settle;
    entry.settle = null;
    if (settle) settle(res);
  }

  /** scene → 实例。同一个 adUnitId 只 new 一次(spec §3.1),未配 ID / 非微信环境返回 null。 */
  private entryOf(scene: AdScene): AdEntry | null {
    const unitId = this.config.unitMap[scene];
    if (!unitId) return null;

    const cached = this.entries.get(unitId);
    if (cached) return cached;

    const api = wxAdApi();
    if (!api) return null;

    const entry: AdEntry = {
      ad: api.createRewardedVideoAd({ adUnitId: unitId }),
      unitId, scene, loaded: false, settle: null,
    };
    // 回调注册一次就够:实例是复用的,重复注册会让一次 close 触发多次回调
    entry.ad.onLoad(() => { entry.loaded = true; });
    entry.ad.onError((err) => {
      entry.loaded = false;   // 无填充 / 拉取失败 → canShow 转 false,按钮置灰
      track('ad_error', {
        scene: this.current || entry.scene,
        errCode: (err && err.errCode) || ERR_LOCAL,
        errMsg: (err && err.errMsg) || '',
      });
      // 播放中出的错不会再来 onClose,挂着的 Promise 得就地结掉,否则界面一直等
      this.settleEntry(entry, { ended: false, error: 'ad_error' });
    });
    entry.ad.onClose((res) => {
      entry.loaded = false;   // 这条已消费,等 load 回来才重新可点
      // 红线:只认 isEnded === true;中途退出、res 缺失一律按没看完处理
      this.settleEntry(entry, { ended: !!res && res.isEnded === true });
    });

    this.entries.set(unitId, entry);
    return entry;
  }
}

function errText(err: unknown): string {
  if (!err) return 'show_failed';
  const e = err as { errMsg?: string; message?: string };
  return e.errMsg || e.message || 'show_failed';
}

/** 全局单例(spec §3.1:实例全局复用,别每次 new)。 */
export const adManager = new AdManager();
