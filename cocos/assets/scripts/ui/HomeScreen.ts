// 主界面 —— Logo / 开始 / 最高关卡与金币 / P1 入口占位。
// 展示的数字全部由外部(GameController 取自 T3 的 Progress)喂进来,本层不做任何换算。

import { Color, Label, Node } from 'cc';
import { UI_C, UiButton, uiBlock, uiIcon, uiLabel, uiNode } from './UiKit';

/** 主界面展示数据,全部是 core 侧的现成值。 */
export interface HomeData {
  /** 点开始要打的关卡号。 */
  nextLevel: number;
  /** 已通关的最高关(0 = 一关没过)。 */
  maxLevel: number;
  coins: number;
}

/** P1 才接的入口,点了先给"敬请期待"。 */
const LOCKED = ['皮肤', '排行榜', '签到'];

export class HomeScreen {
  readonly node: Node;
  private readonly lbMaxLevel: Label;
  private readonly lbCoins: Label;
  private readonly lbNext: Label;
  private readonly btnStart: UiButton;

  constructor(parent: Node, onStart: () => void, onLocked: (name: string) => void) {
    this.node = uiNode(parent, 'Home');
    uiBlock(this.node, 'Backdrop', UI_C.backdrop, 2400, 2320);

    // Logo(branding 占位:交付里没有 logo 图,先用字体版式顶上)
    uiLabel(this.node, 'Logo', '蒜鸟的战斗', { size: 128, color: UI_C.textLight, y: 520, outline: true });
    uiLabel(this.node, 'Slogan', '滚雪球 · 撞穿霉烂军团', { size: 44, color: UI_C.textLight, y: 380, outline: true });

    this.lbMaxLevel = this.stat('MaxLevel', '军', UI_C.secondary, -190, 170);
    this.lbCoins = this.stat('Coins', '金', UI_C.primary, 190, 170);
    this.lbNext = uiLabel(this.node, 'Next', '', { size: 44, color: UI_C.textLight, y: 60, outline: true });

    this.btnStart = new UiButton(this.node, 'Start', {
      text: '开始游戏', w: 520, h: 168, fontSize: 60, y: -90,
    }, onStart);

    // P1 入口:按钮先做出来,只弹 Toast,免得主界面日后改版
    for (let i = 0; i < LOCKED.length; i++) {
      const name = LOCKED[i];
      new UiButton(this.node, name, {
        text: name, w: 236, h: 120, color: UI_C.secondary, textColor: UI_C.textLight,
        fontSize: 42, x: (i - 1) * 256, y: -380,
      }, () => onLocked(name));
    }
  }

  /** 图标 + 数值的一格信息条,返回数值 Label。 */
  private stat(name: string, glyph: string, color: Color, x: number, y: number): Label {
    const root = uiNode(this.node, name);
    root.setPosition(x, y, 0);
    uiBlock(root, 'Bg', UI_C.mask, 340, 108);
    uiIcon(root, 'Icon', glyph, color, 76).setPosition(-118, 0, 0);
    return uiLabel(root, 'Value', '', { size: 46, color: UI_C.textLight, x: 34 });
  }

  show(data: HomeData): void {
    this.lbMaxLevel.string = data.maxLevel > 0 ? `最高 ${data.maxLevel} 关` : '尚未通关';
    this.lbCoins.string = String(data.coins);
    this.lbNext.string = `即将挑战 第 ${data.nextLevel} 关`;
    this.btnStart.setText(data.maxLevel > 0 ? '继续闯关' : '开始游戏');
    this.node.active = true;
  }

  hide(): void { this.node.active = false; }
}
