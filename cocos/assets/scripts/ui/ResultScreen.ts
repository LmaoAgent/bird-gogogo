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
  /** 广告位占位,T9 接 AdManager 前不可点;万一被打开也只弹提示。 */
  onAdPlaceholder(): void;
}

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
  private goNext = true;

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

    // 广告位:T9 接 AdManager,P0 先做出来并置灰
    this.btnAd = new UiButton(panel, 'Ad', {
      text: '', w: 640, h: 132, color: UI_C.secondary, textColor: UI_C.textLight, fontSize: 40, y: -270,
    }, cb.onAdPlaceholder);
    uiIcon(this.btnAd.node, 'Icon', 'AD', UI_C.mask, 72).setPosition(-250, 0, 0);
    this.btnAd.setEnabled(false);

    this.btnGo = new UiButton(panel, 'Go', {
      text: '', w: 520, h: 152, fontSize: 56, y: -440,
    }, () => (this.goNext ? cb.onNext() : cb.onRetry()));

    this.node.active = false;
  }

  showWin(star: number, nPeak: number, gainCoins: number, totalCoins: number): void {
    this.lbTitle.string = '通关!';
    this.lbTitle.node.setPosition(0, 400, 0);
    this.lbLines.node.setPosition(0, 60, 0);
    this.starRow.active = true;
    for (let i = 0; i < STAR_COUNT; i++) this.stars[i].color = i < star ? UI_C.starOn : UI_C.starOff;
    this.lbLines.string = `本局峰值兵力  ${nPeak}`;
    this.coinRow.active = true;
    this.lbCoins.string = `+${gainCoins}   (共 ${totalCoins})`;
    this.btnAd.setText('广告翻倍 · 敬请期待');
    this.btnGo.setText('下一关');
    this.goNext = true;
    this.node.active = true;
  }

  showFail(reason: string, nPeak: number): void {
    this.lbTitle.string = '失败';
    // 没有星星那一行,标题与正文一起下移收掉空档
    this.lbTitle.node.setPosition(0, 320, 0);
    this.lbLines.node.setPosition(0, 110, 0);
    this.starRow.active = false;
    this.lbLines.string = `${reason}\n本局峰值兵力  ${nPeak}`;
    this.coinRow.active = false;
    this.btnAd.setText('广告复活 · 敬请期待');
    this.btnGo.setText('重开本关');
    this.goNext = false;
    this.node.active = true;
  }

  hide(): void { this.node.active = false; }
}
