// 表现层存储适配 —— 把平台 API 塞成 core/progress.ts 要的 { load, save } 形状。
// 形状照 prototype/src/storage.js;core 不认平台,所以本文件不进 core/。
//
// T8:微信下直连 wx.setStorageSync/getStorageSync,不再借道 sys.localStorage。
// 两条路在小游戏里最终落到同一处(引擎的 minigame adapter 就是拿 wx 存储垫的
// localStorage),但直连一来行为写死在本文件里、不随引擎适配层版本漂,
// 二来微信的同步存储会抛异常(单键 1MB / 单用户 10MB 上限),得由我们自己接住 ——
// 存档写不进去只该丢这一次进度,不该把结算流程整条炸掉。

import { sys } from 'cc';
import type { SaveData, StorageAdapter } from '../defs/types';
import type { KvStore } from '../systems/Systems';
import { wxApi } from './WxApi';

const KEY = 'garlicbird.save';
const SYSTEMS_KEY = 'garlicbird.systems';

/** 微信小游戏才有;编辑器预览与 web-mobile 构建下为 null,退回 localStorage。 */
const wxStorage = wxApi && typeof wxApi.setStorageSync === 'function' ? wxApi : null;

function readRaw(key: string): string | null {
  try {
    if (wxStorage) return wxStorage.getStorageSync(key) || null;   // 没有该键时给的是空串
    return sys.localStorage.getItem(key);
  } catch (e) {
    console.error('[Storage] 读存档失败,按新档处理', key, e);
    return null;
  }
}

function writeRaw(key: string, raw: string): void {
  try {
    if (wxStorage) wxStorage.setStorageSync(key, raw);
    else sys.localStorage.setItem(key, raw);
  } catch (e) {
    console.error('[Storage] 写存档失败', key, e);
  }
}

/**
 * 云备份预留位(T8-3)。整份存档上云要走微信云开发 wx.cloud,得先开通环境 + 建集合,
 * 属于人肉待办,故这里只留口子:接上时 setCloudBackup(实现) 即可,存档读写口一行不用改。
 * ⚠️ 别拿 wx.setUserCloudStorage 顶替 —— 那是排行榜的托管数据(RankService 在用),
 * 单键 1KB 上限且会被开放数据域读到,不是存档该待的地方。
 */
export interface CloudBackup {
  /** 每次落盘后调用。实现方自己做节流与失败重试,不许抛 —— 云备份不能拖累本地存档。 */
  push(data: SaveData): void;
  /** 换机/重装后拉云档。要不要覆盖本地由调用方决定,故这里只负责取回来。 */
  pull(): Promise<SaveData | null>;
}

let cloud: CloudBackup | null = null;

export function setCloudBackup(impl: CloudBackup | null): void {
  cloud = impl;
}

export const cocosStorageAdapter: StorageAdapter = {
  load(): unknown {
    const raw = readRaw(KEY);
    return raw ? JSON.parse(raw) : null;
  },
  save(data: SaveData): void {
    writeRaw(KEY, JSON.stringify(data));
    if (cloud) cloud.push(data);
  },
};

/**
 * 签到 / 任务 / 分享的状态另存一个键:它们是 P1 的留存系统,与 core 的养成存档生命周期不同
 * (跨日会整块重置),混进 SaveData 只会让 migrate 变复杂。金币仍旧只有 SaveData 一处真源。
 */
export const cocosSystemsStore: KvStore = {
  load(): unknown {
    const raw = readRaw(SYSTEMS_KEY);
    return raw ? JSON.parse(raw) : null;
  },
  save(data: unknown): void {
    writeRaw(SYSTEMS_KEY, JSON.stringify(data));
  },
};
