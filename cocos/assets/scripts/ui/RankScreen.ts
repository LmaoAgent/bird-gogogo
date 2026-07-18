// 好友排行榜面板 —— 榜单本体是子域画的,这一层只管面板框、切榜、关闭。
// 点好友发起挑战这类交互留给主域是红线要求,但 P1 的榜只读不点,所以这里没有列表触摸。

import { Label, Node } from 'cc';
import { RankCanvas } from './RankCanvas';
import { UI_C, UiButton, uiLabel, uiModal } from './UiKit';
import { isWx } from '../game/WxApi';
import type { Board } from '../game/RankService';

/** 榜单区在面板里的位置与高度,宽度由 RankCanvas 按画布比例反推。 */
const BOARD_Y = -40;
const BOARD_H = 940;

const NEXT_BOARD: Record<Board, Board> = {
  max_level: 'max_troop',
  max_troop: 'max_level',
};

const BOARD_LABEL: Record<Board, string> = {
  max_level: '最高关卡',
  max_troop: '单局兵力',
};

export interface RankButtons {
  /** 换榜 / 打开 → 让主控给子域下 render 指令(ui 层不碰 wx)。 */
  onBoard(board: Board): void;
  onClose(): void;
}

export class RankScreen {
  readonly node: Node;
  private readonly panel: Node;
  private readonly canvas: RankCanvas;
  private readonly btnSwitch: UiButton;
  private readonly lbTip: Label;
  private readonly cb: RankButtons;
  private board: Board = 'max_level';

  constructor(parent: Node, canvas: RankCanvas, cb: RankButtons) {
    const modal = uiModal(parent, 'Rank', 900, 1440);
    this.node = modal.root;
    this.panel = modal.panel;
    this.canvas = canvas;
    this.cb = cb;

    uiLabel(this.panel, 'Title', '好友排行榜', { size: 72, color: UI_C.textDark, y: 640 });

    this.btnSwitch = new UiButton(this.panel, 'Switch', {
      text: '', w: 420, h: 110, color: UI_C.secondary, textColor: UI_C.textLight, fontSize: 42, y: 530,
    }, () => this.select(NEXT_BOARD[this.board]));

    // 非微信环境(web 预览)没有开放数据域,榜单区就是这一行字
    this.lbTip = uiLabel(this.panel, 'Tip', '排行榜需要在微信里打开', {
      size: 40, color: UI_C.textDark, y: BOARD_Y,
    });
    this.lbTip.node.active = false;

    new UiButton(this.panel, 'Close', {
      text: '返回', w: 400, h: 130, fontSize: 48, y: -640,
    }, () => { this.hide(); cb.onClose(); });

    this.node.active = false;
  }

  show(): void {
    this.node.active = true;
    this.lbTip.node.active = !isWx;
    if (isWx) this.canvas.showBoard(this.panel, BOARD_Y, BOARD_H);
    this.select(this.board);
  }

  hide(): void {
    this.canvas.hide();
    this.node.active = false;
  }

  /** 切榜:按钮上写的永远是"另一个榜",省掉一套选中态样式。 */
  private select(board: Board): void {
    this.board = board;
    this.btnSwitch.setText(`看 ${BOARD_LABEL[NEXT_BOARD[board]]}榜`);
    this.cb.onBoard(board);
  }
}
