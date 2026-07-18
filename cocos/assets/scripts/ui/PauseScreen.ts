// 暂停面板 —— 继续 / 重开本关 / 返回主界面。遮罩挡住赛道拖动,实际停帧由 GameController 控。

import { Node } from 'cc';
import { UI_C, UiButton, uiLabel, uiModal } from './UiKit';

export interface PauseButtons {
  onResume(): void;
  onRetry(): void;
  onHome(): void;
}

export class PauseScreen {
  readonly node: Node;

  constructor(parent: Node, cb: PauseButtons) {
    const modal = uiModal(parent, 'Pause', 720, 720);
    this.node = modal.root;
    const panel = modal.panel;

    uiLabel(panel, 'Title', '暂停', { size: 76, color: UI_C.textDark, y: 250 });
    new UiButton(panel, 'Resume', { text: '继续游戏', w: 480, h: 140, fontSize: 52, y: 70 }, cb.onResume);
    new UiButton(panel, 'Retry', {
      text: '重开本关', w: 480, h: 140, color: UI_C.secondary, textColor: UI_C.textLight, fontSize: 52, y: -100,
    }, cb.onRetry);
    new UiButton(panel, 'Home', {
      text: '返回主界面', w: 480, h: 140, color: UI_C.secondary, textColor: UI_C.textLight, fontSize: 52, y: -270,
    }, cb.onHome);

    this.node.active = false;
  }

  show(): void { this.node.active = true; }
  hide(): void { this.node.active = false; }
}
