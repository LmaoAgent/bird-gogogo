// 结算页 —— 通关(星级/峰值/金币/下一关)与失败(原因/峰值/重开)共用一块面板。
// ⚠️ 星级取 result.star、金币取 Progress 的结算返回值,本层一个数都不算(见 T6 红线)。

import { Label, Node } from 'cc';
import { UI_C, UiButton, uiIcon, uiLabel, uiNode, uiModal } from './UiKit';

const STAR_COUNT = 3;

export interface ResultButtons {
  /** 通关 → 下一关。 */
  onNext(): void;
  /** 失败 → 重开本关。 */
  onRetry(): void;
  /** 广告位:通关页＝金币翻倍,失败页＝复活续冲。是哪一位由 GameController 按局面判。 */
  onAd(): void;
  /**
   * 分享(《签到任务分享系统设计》§3.1):通关＝晒战绩 result,失败＝求复活 revive_help,
   * 挑战按钮＝challenge(排行榜spec §4.2 的定向挑战,发起与回敬同一条)。
   */
  onShare(scene: 'result' | 'revive_help' | 'challenge'): void;
  /** 挑战局打完回主界面 —— 挑战局是表演赛,不接着推自己的进度。 */
  onHome(): void;
}

/**
 * 广告按钮三态(《广告接入spec.md》§3.1 / T9-4):
 * hidden ＝ 本局配额用尽(复活 2 次上限),按钮直接不出;
 * disabled ＝ 没配 adUnitId / 无填充 / 还没加载好,置灰,别让玩家点了没反应;
 * ready ＝ 可点。状态由 GameController 算,本层只呈现。
 */
export type AdBtnState = 'ready' | 'disabled' | 'hidden';

export class ResultScreen {
  readonly node: Node;
  private readonly lbTitle: Label;
  private readonly lbLines: Label;
  private readonly stars: Label[] = [];
  private readonly starRow: Node;
  private readonly coinRow: Node;
  private readonly lbCoins: Label;
  private readonly btnAd: UiButton;
  private readonly btnGo: UiButton;
  private readonly btnChallenge: UiButton;
  /** win＝通关,fail＝失败,pk＝挑战局结算(排行榜spec §4.2)。决定底部两颗按钮干什么。 */
  private mode: 'win' | 'fail' | 'pk' = 'win';

  constructor(parent: Node, cb: ResultButtons) {
    const modal = uiModal(parent, 'Result', 820, 1080);
    this.node = modal.root;
    const panel = modal.panel;

    this.lbTitle = uiLabel(panel, 'Title', '', { size: 84, color: UI_C.textDark, y: 400 });

    // 星级:只把 result.star 画出来,亮几颗由 core 决定
    this.starRow = uiNode(panel, 'Stars');
    this.starRow.setPosition(0, 250, 0);
    for (let i = 0; i < STAR_COUNT; i++) {
      this.stars.push(uiLabel(this.starRow, `Star${i}`, '★', {
        size: 116, color: UI_C.starOff, x: (i - 1) * 150,
      }));
    }

    this.lbLines = uiLabel(panel, 'Lines', '', { size: 46, color: UI_C.textDark, y: 60 });

    this.coinRow = uiNode(panel, 'Coin');
    this.coinRow.setPosition(0, -110, 0);
    uiIcon(this.coinRow, 'Icon', '金', UI_C.primary, 72).setPosition(-150, 0, 0);
    this.lbCoins = uiLabel(this.coinRow, 'Value', '', { size: 52, color: UI_C.textDark, x: 30 });

    // 广告位:接 core/AdManager,每次 show* 按三态刷新
    this.btnAd = new UiButton(panel, 'Ad', {
      text: '', w: 640, h: 132, color: UI_C.secondary, textColor: UI_C.textLight, fontSize: 40, y: -270,
    }, cb.onAd);
    uiIcon(this.btnAd.node, 'Icon', 'AD', UI_C.mask, 72).setPosition(-250, 0, 0);
    this.btnAd.setEnabled(false);

    // 底部两颗:挑战(通关发起 / PK 后回敬)在左,推进按钮在右;失败页只有推进那颗,居中
    this.btnChallenge = new UiButton(panel, 'Challenge', {
      text: '', w: 340, h: 152, color: UI_C.secondary, textColor: UI_C.textLight,
      fontSize: 48, x: -190, y: -440,
    }, () => cb.onShare('challenge'));

    this.btnGo = new UiButton(panel, 'Go', {
      text: '', w: 340, h: 152, fontSize: 48, y: -440,
    }, () => {
      if (this.mode === 'win') cb.onNext();
      else if (this.mode === 'fail') cb.onRetry();
      else cb.onHome();
    });

    // 分享:场景跟着局面走(通关晒战绩 / 失败求复活;挑战局按通关处理)
    new UiButton(panel, 'Share', {
      text: '分享', w: 160, h: 100, color: UI_C.secondary, textColor: UI_C.textLight,
      fontSize: 38, x: 300, y: 430,
    }, () => cb.onShare(this.mode === 'fail' ? 'revive_help' : 'result'));

    this.node.active = false;
  }

  showWin(star: number, fPeak: number, gainCoins: number, totalCoins: number, ad: AdBtnState): void {
    this.lbTitle.string = '通关!';
    this.lbTitle.node.setPosition(0, 400, 0);
    this.lbLines.node.setPosition(0, 60, 0);
    this.starRow.active = true;
    for (let i = 0; i < STAR_COUNT; i++) this.stars[i].color = i < star ? UI_C.starOn : UI_C.starOff;
    this.lbLines.string = `本局峰值火力  ${fPeak}`;
    this.coinRow.active = true;
    this.lbCoins.string = `+${gainCoins}   (共 ${totalCoins})`;
    this.setAd(ad, `看广告 金币翻倍 +${gainCoins}`);
    this.btnGo.setText('下一关');
    this.setMode('win', '挑战好友');
    this.node.active = true;
  }

  showFail(reason: string, fPeak: number, ad: AdBtnState): void {
    this.lbTitle.string = '失败';
    // 没有星星那一行,标题与正文一起下移收掉空档
    this.lbTitle.node.setPosition(0, 320, 0);
    this.lbLines.node.setPosition(0, 110, 0);
    this.starRow.active = false;
    this.lbLines.string = `${reason}\n本局峰值火力  ${fPeak}`;
    this.coinRow.active = false;
    this.setAd(ad, '看广告复活 · 原地续冲');
    this.btnGo.setText('重开本关');
    this.setMode('fail', '');
    this.node.active = true;
  }

  /**
   * 挑战局结算(排行榜spec §4.2 第 3 步)。胜负是本地比出来的:本局峰值 vs 分享参数里的好友分。
   * 挑战局是表演赛 —— 不结星、不发币、不给广告位,所以那几块整排收掉。
   */
  showPk(win: boolean, myScore: number, friendScore: number, from: string): void {
    this.lbTitle.string = win ? 'PK 胜利!' : 'PK 失败';
    this.lbTitle.node.setPosition(0, 320, 0);
    this.lbLines.node.setPosition(0, 110, 0);
    this.starRow.active = false;
    this.lbLines.string = `你 ${myScore}    ${from} ${friendScore}`;
    this.coinRow.active = false;
    this.setAd('hidden', '');
    this.btnGo.setText('返回');
    this.setMode('pk', '回敬挑战');
    this.node.active = true;
  }

  hide(): void { this.node.active = false; }

  /** 有挑战按钮时推进键让到右边,没有就居中 —— 免得两颗按钮一宽一窄看着歪。 */
  private setMode(mode: 'win' | 'fail' | 'pk', challengeText: string): void {
    this.mode = mode;
    const withChallenge = mode !== 'fail';
    this.btnChallenge.node.active = withChallenge;
    if (withChallenge) this.btnChallenge.setText(challengeText);
    this.btnGo.node.setPosition(withChallenge ? 190 : 0, -440, 0);
  }

  private setAd(state: AdBtnState, text: string): void {
    this.btnAd.node.active = state !== 'hidden';
    this.btnAd.setEnabled(state === 'ready');
    this.btnAd.setText(state === 'ready' ? text : `${text}(暂不可用)`);
  }
}
