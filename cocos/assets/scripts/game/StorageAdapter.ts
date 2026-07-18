// 表现层存储适配 —— 把平台 API 塞成 core/progress.ts 要的 { load, save } 形状。
// 形状照 prototype/src/storage.js;core 不认平台,所以本文件不进 core/。
// sys.localStorage 在微信小游戏下由引擎转接 wx.setStorageSync,故 web 预览与真机共用这一份(T8 若要云存档再加)。

import { sys } from 'cc';
import type { SaveData, StorageAdapter } from '../defs/types';

const KEY = 'garlicbird.save';

export const cocosStorageAdapter: StorageAdapter = {
  load(): unknown {
    const raw = sys.localStorage.getItem(KEY);
    return raw ? JSON.parse(raw) : null;
  },
  save(data: SaveData): void {
    sys.localStorage.setItem(KEY, JSON.stringify(data));
  },
};
