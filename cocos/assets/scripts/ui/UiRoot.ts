// UI 总装 —— 四块界面的显隐编排,GameController 的唯一 UI 入口。
// 本层只读 game 字段与 core 结算返回值做呈现,不含任何玩法规则(星级、金币都由 core 给)。

import { Node } from 'cc';
import { HomeScreen } from './HomeScreen';
import { HudScreen } from './HudScreen';
import { PauseScreen } from './PauseScreen';
import { RankCanvas } from './RankCanvas';
import { RankScreen } from './RankScreen';
import { ResultScreen } from './ResultScreen';
import { SignScreen } from './SignScreen';
import { TaskScreen } from './TaskScreen';
import { Toast, rewardText, uiNode } from './UiKit';
import { trackSend } from '../game/Challenge';
import type { AdBtnState } from './ResultScreen';
import type { HomeData } from './HomeScreen';
import type { ChallengeInvite } from '../game/Challenge';
import type { Board } from '../game/RankService';
import type { Game } from '../core/game';
import type { Systems } from '../systems/Systems';

export interface UiCallbacks {
  /** 主界面开始 → 开打当前关。 */
  onStart(): void;
  /** 结算页下一关。 */
  onNext(): void;
  /** 失败页 / 暂停页重开本关。 */
  onRetry(): void;
  /** 结算页广告位(通关＝金币翻倍 / 失败＝复活续冲),见 GameController.onAd。 */
  onAd(): void;
  onPause(): void;
  onResume(): void;
  onHome(): void;
  /** 主界面当前该显示什么 —— 领完奖要就地把金币与红点刷新掉。 */
  homeData(): HomeData;
  /** 打开榜单 / 换榜 → 让 GameController 给子域下 render 指令(排行榜spec §3)。 */
  onRankBoard(board: Board): void;
}

/** 失败原因文案:只把 core 记下的 failWave 与对撞快照翻成人话。 */
function failReason(game: Game): string {
  const r = game.result;
  if (!r || r.failWave < 0) return '兵力被陷阱耗尽';

  const wave = game.smash ? game.smash.wave : null;
  const who = wave && wave.isBoss
    ? (wave.phaseCount > 1 ? `烂蒜魔王第 ${wave.phase}/${wave.phaseCount} 段` : '烂蒜魔王')
    : `第 ${r.failWave + 1} 波`;
  const detail = game.smash ? `(撞击时 ${game.smash.nBefore} 兵)` : '';
  return `撞不动${who}${detail}`;
}

export class UiRoot {
  readonly node: Node;
  private readonly home: HomeScreen;
  private readonly hud: HudScreen;
  private readonly result: ResultScreen;
  private readonly pause: PauseScreen;
  private readonly sign: SignScreen;
  private readonly task: TaskScreen;
  private readonly rankCanvas: RankCanvas;
  private readonly rank: RankScreen;
  private readonly toast: Toast;
  private readonly systems: Systems;
  private readonly cb: UiCallbacks;
  /** 结算页分享要带的关卡与战绩(§3.1 的 lv / score),showResult 时记下。 */
  private shareLv = 0;
  private shareScore = 0;

  constructor(parent: Node, systems: Systems, cb: UiCallbacks) {
    // 建在 ArenaView 之后 → 兄弟序更靠后 → 盖在赛道上层;界面之间也按建的先后叠。
    this.node = uiNode(parent, 'Ui');
    this.systems = systems;
    this.cb = cb;

    this.home = new HomeScreen(this.node, {
      onStart: () => cb.onStart(),
      onLocked: (name) => this.toast.show(`${name}敬请期待`),
      onSign: () => this.sign.show(),
      onTask: () => this.task.show(),
      onRank: () => this.rank.show(),
    });
    this.hud = new HudScreen(this.node, () => { this.pause.show(); cb.onPause(); });
    this.result = new ResultScreen(this.node, {
      onNext: () => { this.hideResult(); cb.onNext(); },
      onRetry: () => { this.hideResult(); cb.onRetry(); },
      onAd: () => cb.onAd(),
      onShare: (scene) => this.onShare(scene),
      onHome: () => { this.hideResult(); cb.onHome(); },
    });
    this.pause = new PauseScreen(this.node, {
      onResume: () => { this.pause.hide(); cb.onResume(); },
      onRetry: () => { this.pause.hide(); cb.onRetry(); },
      onHome: () => { this.pause.hide(); cb.onHome(); },
    });
    // 留存面板盖在主界面之上,但仍在 Toast 之下
    this.sign = new SignScreen(this.node, systems, { onChanged: (t) => this.afterReward(t) }, () => this.sign.hide());
    this.task = new TaskScreen(this.node, systems, { onChanged: (t) => this.afterReward(t) }, () => this.task.hide());
    // 开放数据域画面只有一张 sharedCanvas,所以宿主节点也只有一个,榜单页与结算横幅轮流用它
    this.rankCanvas = new RankCanvas(this.node);
    this.rank = new RankScreen(this.node, this.rankCanvas, {
      onBoard: (board) => cb.onRankBoard(board),
      onClose: () => { /* 面板自己关掉即可,主界面本来就在底下 */ },
    });
    this.toast = new Toast(this.node);   // 最后建,盖在所有面板之上
  }

  /** 收结算页时把开放数据域那块也收掉 —— 它是挂在结算页上的,别留到下一屏。 */
  private hideResult(): void {
    this.rankCanvas.hide();
    this.result.hide();
  }

  /** 领奖 / 分享之后:主界面在的话就地刷新金币与红点,再弹提示。 */
  private afterReward(text: string): void {
    if (this.home.node.active) this.home.show(this.cb.homeData());
    this.toast.show(text);
  }

  /**
   * 结算页分享(§3.1 晒战绩 / 求复活 / 定向挑战)。奖励每日限次,连点第二次 reward 为 null。
   * challenge 场景拼出来的 query 就是排行榜spec §4.2 要的 act=challenge&lv=..&score=..。
   */
  private onShare(scene: 'result' | 'revive_help' | 'challenge'): void {
    if (scene === 'challenge') trackSend(this.shareLv, this.shareScore);
    const reward = this.systems.doShare(scene, { lv: this.shareLv, score: this.shareScore });
    this.afterReward(reward ? `分享成功  +${rewardText(reward)}` : '今日分享奖励已领过');
  }

  showHome(data: HomeData): void {
    this.hud.hide();
    this.hideResult();
    this.pause.hide();
    this.sign.hide();
    this.task.hide();
    this.rank.hide();
    this.home.show(data);
  }

  showHud(): void {
    this.home.hide();
    this.hideResult();
    this.pause.hide();
    this.sign.hide();
    this.task.hide();
    this.rank.hide();
    this.hud.show();
  }

  /** 挑战局的目标分挂在 HUD 上(排行榜spec §4.2);传 null 恢复普通闯关。 */
  setChallenge(invite: ChallengeInvite | null): void {
    this.hud.setChallenge(invite);
  }

  /** gain / coins 直接取 Progress.applyLevelResult 的返回值与存档余额;ad 三态由 GameController 算。 */
  showResult(game: Game, gain: { coins: number; unlocked: boolean }, coins: number, ad: AdBtnState): void {
    const r = game.result;
    this.shareLv = game.level.level;
    this.shareScore = r.nPeak;
    if (r.win) {
      this.result.showWin(r.star, r.nPeak, gain.coins, coins, ad);
      // "本局击败了 X 位好友"——那个数只有子域算得出来(主域读不到好友数据),所以整条横幅都是它画的
      this.rankCanvas.showBeat(this.result.node);
    } else {
      this.result.showFail(failReason(game), r.nPeak, ad);
    }
  }

  /** 挑战局结算(排行榜spec §4.2):胜负本地比,不走榜单。 */
  showPkResult(win: boolean, myScore: number, invite: ChallengeInvite): void {
    this.shareLv = invite.level;
    this.shareScore = myScore;
    this.result.showPk(win, myScore, invite.score, invite.from);
  }

  showToast(text: string): void { this.toast.show(text); }

  tick(game: Game | null, dt: number): void {
    this.toast.tick(dt);
    if (game && this.hud.node.active) this.hud.tick(game, dt);
  }
}
