// UI 基建 —— 节点 / 文字 / 按钮 / 条形控件的极简封装。只做布局与呈现,不含任何玩法规则。
// P0 一律色块占位(美术接入是 T5):每处注释标了对应的交付图,换图时给 Sprite 赋 spriteFrame、
// 把 type 改成 SLICED 并按 art_delivery/p0/integration_manifest.json 的 inset 填九宫格,布局不用动。

import {
  BlockInputEvents, Button, Color, ImageAsset, Label, Layers, Node,
  Sprite, SpriteFrame, Texture2D, UITransform,
} from 'cc';
import type { Reward } from '../defs/types';

export const DESIGN_H = 1920;
export const HALF_H = DESIGN_H / 2;

/** fitHeight 策略下可见宽度随机型变化(19.5:9 约 886、20:9 约 864),侧边元素一律收在 ±SAFE_HALF_W 内。 */
export const SAFE_HALF_W = 420;

/** 触区下限 88px@2x;设计分辨率 1080 就是 @2x 基准,故 1 设计单位 = 1px@2x,直接取 88。 */
export const TOUCH_MIN = 88;

export const UI_C = {
  mask: new Color(24, 18, 14, 170),
  backdrop: new Color(143, 211, 244, 255),   // 与 ArenaView 天空同色,主界面不至于黑屏
  panel: new Color(247, 233, 200, 255),      // ui_panel_common_base_01.png(inset 96)
  panelEdge: new Color(122, 82, 48, 255),
  textDark: new Color(58, 46, 36, 255),
  textLight: new Color(255, 255, 255, 255),
  primary: new Color(242, 195, 59, 255),     // ui_button_start_base_01.png / ui_button_restart_base_01.png
  secondary: new Color(143, 168, 184, 255),
  disabled: new Color(170, 163, 152, 255),
  barBg: new Color(52, 42, 34, 200),
  barProgress: new Color(242, 195, 59, 255), // ui_bar_progress_base_01.png(inset 88,44)
  barEnemy: new Color(192, 57, 43, 255),     // ui_bar_boss_base_01.png(inset 88,48)
  barBoss: new Color(201, 80, 143, 255),
  starOn: new Color(255, 213, 74, 255),      // ui_icon_star_base_01.png
  starOff: new Color(150, 142, 130, 255),
  redDot: new Color(226, 60, 60, 255),
  /** 签到今日格 / 可领任务的高亮底。 */
  highlight: new Color(255, 236, 176, 255),
};

/** 1×1 纯白贴图,UI 所有色块共用一张,靠节点 color 染色。 */
function makeSolid(): SpriteFrame {
  const image = new ImageAsset({
    _data: new Uint8Array([255, 255, 255, 255]),
    _compressed: false,
    width: 1,
    height: 1,
    format: Texture2D.PixelFormat.RGBA8888,
  });
  const texture = new Texture2D();
  texture.image = image;
  const frame = new SpriteFrame();
  frame.texture = texture;
  // 运行时贴图没有图像源,进动态图集会逐帧抛异常导致整屏画不出来(同 ArenaView 处注释)。
  frame.packable = false;
  return frame;
}

const SOLID = makeSolid();

export function uiNode(parent: Node, name: string): Node {
  const n = new Node(name);
  n.layer = Layers.Enum.UI_2D;
  n.addComponent(UITransform);
  n.parent = parent;
  return n;
}

/** 居中锚点的纯色块。 */
export function uiBlock(parent: Node, name: string, color: Color, w: number, h: number): Node {
  const n = uiNode(parent, name);
  const sp = n.addComponent(Sprite);
  sp.sizeMode = Sprite.SizeMode.CUSTOM;
  sp.type = Sprite.Type.SIMPLE;
  sp.spriteFrame = SOLID;
  sp.color = color;
  // 尺寸必须最后设：sizeMode 还是默认 TRIMMED 时给 spriteFrame 赋值会把 contentSize 顶成贴图的 1×1。
  n.getComponent(UITransform).setContentSize(w, h);
  return n;
}

export interface LabelOpts {
  size: number;
  color?: Color;
  x?: number;
  y?: number;
  /** 深色底上的文字描边;浅色面板上的正文不要开。 */
  outline?: boolean;
}

export function uiLabel(parent: Node, name: string, text: string, opts: LabelOpts): Label {
  const n = uiNode(parent, name);
  n.setPosition(opts.x || 0, opts.y || 0, 0);
  const lb = n.addComponent(Label);
  lb.string = text;
  lb.fontSize = opts.size;
  lb.lineHeight = opts.size * 1.25;
  lb.horizontalAlign = Label.HorizontalAlign.CENTER;
  lb.verticalAlign = Label.VerticalAlign.CENTER;
  lb.color = opts.color || UI_C.textDark;
  if (opts.outline) {
    lb.enableOutline = true;
    lb.outlineColor = new Color(43, 36, 32, 255);
    lb.outlineWidth = 4;
  }
  return lb;
}

/** 图标占位:色块 + 一个字形。对应 ui_icon_*_base_01.png,换图时整块换成 Sprite。 */
export function uiIcon(parent: Node, name: string, glyph: string, color: Color, size: number): Node {
  const n = uiBlock(parent, name, color, size, size);
  uiLabel(n, 'Glyph', glyph, { size: size * 0.56, color: UI_C.textLight, outline: true });
  return n;
}

export interface ButtonOpts {
  text: string;
  w: number;
  h: number;
  color?: Color;
  textColor?: Color;
  fontSize?: number;
  x?: number;
  y?: number;
}

/** 色块按钮。触区不足 TOUCH_MIN 时自动撑到下限,再小的图也点得到。 */
export class UiButton {
  readonly node: Node;
  private readonly sprite: Sprite;
  private readonly label: Label;
  private readonly baseColor: Color;
  private readonly button: Button;

  constructor(parent: Node, name: string, opts: ButtonOpts, onClick: () => void) {
    const w = Math.max(opts.w, TOUCH_MIN);
    const h = Math.max(opts.h, TOUCH_MIN);
    this.baseColor = opts.color || UI_C.primary;

    this.node = uiBlock(parent, name, this.baseColor, w, h);
    this.node.setPosition(opts.x || 0, opts.y || 0, 0);
    this.sprite = this.node.getComponent(Sprite);
    this.label = uiLabel(this.node, 'Text', opts.text, {
      size: opts.fontSize || Math.min(h * 0.42, 52),
      color: opts.textColor || UI_C.textDark,
    });

    // 按钮自己吃掉触摸,避免冒泡到 Canvas 被当成拖动大军的手势。
    this.node.addComponent(BlockInputEvents);
    this.button = this.node.addComponent(Button);
    this.button.transition = Button.Transition.SCALE;
    this.button.zoomScale = 0.94;
    this.node.on(Button.EventType.CLICK, onClick);
  }

  setText(text: string): void { this.label.string = text; }

  /** 置灰不可点(广告位在 T9 接 AdManager 前就停在这个状态)。 */
  setEnabled(enabled: boolean): void {
    this.button.interactable = enabled;
    this.sprite.color = enabled ? this.baseColor : UI_C.disabled;
  }
}

/** 左端起填的条形控件:进度条与血条共用。 */
export class UiBar {
  readonly node: Node;
  private readonly fill: Node;
  private readonly fillSprite: Sprite;
  private readonly w: number;
  private readonly h: number;

  constructor(parent: Node, name: string, w: number, h: number, color: Color) {
    this.w = w;
    this.h = h;
    this.node = uiNode(parent, name);
    uiBlock(this.node, 'Bg', UI_C.barBg, w + 8, h + 8);
    this.fill = uiBlock(this.node, 'Fill', color, w, h);
    this.fill.getComponent(UITransform).setAnchorPoint(0, 0.5);
    this.fill.setPosition(-w / 2, 0, 0);
    this.fillSprite = this.fill.getComponent(Sprite);
  }

  set(ratio: number): void {
    const r = ratio < 0 ? 0 : ratio > 1 ? 1 : ratio;
    this.fill.getComponent(UITransform).setContentSize(this.w * r, this.h);
  }

  setColor(color: Color): void { this.fillSprite.color = color; }
}

/** 一闪而过的提示条,给"敬请期待"这类占位反馈用。 */
export class Toast {
  private readonly node: Node;
  private readonly label: Label;
  private timer = 0;

  constructor(parent: Node) {
    this.node = uiBlock(parent, 'Toast', UI_C.mask, 700, 108);
    this.node.setPosition(0, -700, 0);
    this.label = uiLabel(this.node, 'Text', '', { size: 44, color: UI_C.textLight });
    this.node.active = false;
  }

  show(text: string): void {
    this.label.string = text;
    this.node.active = true;
    this.timer = 1.4;
  }

  tick(dt: number): void {
    if (this.timer <= 0) return;
    this.timer -= dt;
    if (this.timer <= 0) this.node.active = false;
  }
}

/** 红点:挂在入口按钮右上角,调用方 active 开关。对应 ui_icon_reddot_base_01.png。 */
export function uiRedDot(parent: Node, x: number, y: number): Node {
  const dot = uiBlock(parent, 'RedDot', UI_C.redDot, 32, 32);
  dot.setPosition(x, y, 0);
  dot.active = false;
  return dot;
}

/** 奖励文案:{coin:80,skinFrag:10} → "80 金 + 10 碎"。签到与任务面板共用。 */
export function rewardText(reward: Reward): string {
  const parts: string[] = [];
  if (reward.coin) parts.push(`${reward.coin} 金`);
  if (reward.skinFrag) parts.push(`${reward.skinFrag} 碎`);
  return parts.join(' + ');
}

/** 半透明遮罩 + 居中面板体;遮罩挂 BlockInputEvents,吃掉会漏到赛道上的拖动。 */
export function uiModal(parent: Node, name: string, w: number, h: number): { root: Node; panel: Node } {
  const root = uiNode(parent, name);
  const mask = uiBlock(root, 'Mask', UI_C.mask, 2400, DESIGN_H + 400);
  mask.addComponent(BlockInputEvents);
  const panel = uiBlock(root, 'Panel', UI_C.panelEdge, w + 14, h + 14);
  uiBlock(panel, 'Body', UI_C.panel, w, h);
  return { root, panel };
}
