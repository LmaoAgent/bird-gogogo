// 表现层存储适配 —— 把平台 API 塞成 core/progress.js 要的 { load, save } 形状。
// core 不认平台:Cocos / 微信(wx.getStorageSync)各自照这两个方法实现一份即可。

const KEY = 'garlicbird.save';

export const localStorageAdapter = {
  load() {
    const raw = localStorage.getItem(KEY);
    return raw ? JSON.parse(raw) : null;
  },
  save(data) {
    localStorage.setItem(KEY, JSON.stringify(data));
  },
};

/** 冒烟/单测用:不落盘的内存档。 */
export function memoryAdapter(initial = null) {
  let data = initial;
  return {
    load: () => data,
    save: (next) => { data = next; },
  };
}
