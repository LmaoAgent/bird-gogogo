// 排行榜数据面 —— 写自己的托管数据(R01)+ 给子域下指令(spec §3)。
// 好友数据一个字都不在这里读:主域读不到,那是子域的活(spec §1 红线)。

import { sys } from 'cc';
import { isWx, wxApi } from './WxApi';
import type { WxKvData } from './WxApi';

export type Board = 'max_level' | 'max_troop';

const KEY = 'garlicbird.rank';

/** 已经写进托管数据的最好成绩。留一份本地的,才知道这次要不要发网络请求。 */
interface RankRecord {
  level: number;
  troop: number;
}

/** wxgame 托管格式(spec §2),微信按 score 排序也认这个结构。 */
function wxgameValue(score: number): string {
  return JSON.stringify({ wxgame: { score, update_time: Math.floor(Date.now() / 1000) } });
}

function load(): RankRecord {
  const raw = sys.localStorage.getItem(KEY);
  const o = raw ? JSON.parse(raw) : null;
  return {
    level: o && o.level > 0 ? Math.floor(o.level) : 0,
    troop: o && o.troop > 0 ? Math.floor(o.troop) : 0,
  };
}

export class RankService {
  private best: RankRecord = load();

  /** 单局最大兵力的历史最好成绩。最高关卡在 Progress 存档里,不在这儿存第二份真源。 */
  get maxTroop(): number { return this.best.troop; }

  /**
   * 刷新纪录就写托管数据(R01)。两个 key 各自只在变大时写,没破纪录一次网络都不发。
   * 开局也调一次(nPeak 传 0):老玩家装了新版本时把已有关卡进度补写上去。
   */
  submit(maxLevel: number, nPeak: number): void {
    const kv: WxKvData[] = [];
    if (maxLevel > this.best.level) {
      this.best.level = maxLevel;
      kv.push({ key: 'max_level', value: wxgameValue(maxLevel) });
    }
    if (nPeak > this.best.troop) {
      this.best.troop = nPeak;
      kv.push({ key: 'max_troop', value: wxgameValue(nPeak) });
    }
    if (!kv.length) return;

    sys.localStorage.setItem(KEY, JSON.stringify(this.best));
    // web 预览下本地纪录照记,云端跳过 —— 这样榜单以外的逻辑在浏览器里也能自测
    if (!isWx) return;
    wxApi.setUserCloudStorage({
      KVDataList: kv,
      fail: (err) => console.warn('[rank] 托管数据写入失败', err),
    });
  }

  /** 我在某个榜上的分数,发给子域用来算"超过 N 位好友"并高亮我那一行。 */
  scoreOf(board: Board): number {
    return board === 'max_troop' ? this.best.troop : this.best.level;
  }

  /** 拉好友榜并整页绘制(spec §3 的 render)。 */
  render(board: Board): void {
    this.post({ type: 'render', board, myScore: this.scoreOf(board) });
  }

  /**
   * 结算横幅"本局击败了 X 位好友"(R04)。比的是本局峰值而不是历史最好,
   * 所以分数单独传,不走 scoreOf。
   */
  beat(nPeak: number): void {
    this.post({ type: 'beat', board: 'max_troop', myScore: nPeak });
  }

  private post(msg: Record<string, unknown>): void {
    if (!isWx) return;
    wxApi.getOpenDataContext().postMessage(msg);
  }
}
