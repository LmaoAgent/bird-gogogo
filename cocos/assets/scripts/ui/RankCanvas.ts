// 开放数据域画面的宿主 —— 全局只有一张 sharedCanvas,所以这个节点也只有一个,
// 谁要显示就 showXxx 挂到谁身上(排行榜面板 / 结算横幅),同一时刻只有一处在显示。

import { Node, SubContextView, UITransform } from 'cc';
import { isWx } from '../game/WxApi';
import { uiNode } from './UiKit';

/**
 * sharedCanvas 的尺寸由 SubContextView.designResolutionSize 决定,而那个 setter 在运行时是
 * 空转的(`if (!EDITOR) return`),我们的界面又全是代码建的、没在编辑器里配过,
 * 所以它恒等于组件默认值 640×960。子域按这个尺寸排版,这里也照它算。
 */
const SUB_W = 640;
const SUB_H = 960;

/** 子域画结算横幅时只用画布顶部这一条(见 openData/index.js 的 BEAT_BAND),其余留透明。 */
const BEAT_BAND = 200;

/** 横幅在屏幕上的目标高度与中心 Y:压在结算面板上沿之上,不挡任何按钮。 */
const BEAT_H = 170;
const BEAT_Y = 700;

export class RankCanvas {
  readonly node: Node;

  constructor(parent: Node) {
    this.node = uiNode(parent, 'SubCanvas');
    this.node.getComponent(UITransform).setContentSize(SUB_W, SUB_H);
    // 非微信环境下 SubContextView 自己会 disable,索性不加,免得多一层"看着装了其实没跑"
    if (isWx) this.node.addComponent(SubContextView);
    this.node.active = false;
  }

  /** 整页榜单。宽度按 640:960 反推,SubContextView 是等比适配,比例不对就会留黑边。 */
  showBoard(parent: Node, y: number, height: number): void {
    this.place(parent, y, height);
  }

  /**
   * 结算横幅。画布顶部那条要落在屏幕 BEAT_Y 处、高 BEAT_H,于是反解节点尺寸与位置：
   *   节点高 = BEAT_H × SUB_H / BEAT_BAND,节点中心 = 目标中心 + 节点高/2 − BEAT_H/2。
   * 节点其余部分是透明的,压在面板上也不挡显示;没有触摸监听,更不会挡按钮。
   */
  showBeat(parent: Node): void {
    const h = BEAT_H * SUB_H / BEAT_BAND;
    this.place(parent, BEAT_Y + h / 2 - BEAT_H / 2, h);
  }

  hide(): void { this.node.active = false; }

  private place(parent: Node, y: number, height: number): void {
    this.node.parent = parent;
    this.node.getComponent(UITransform).setContentSize(height * SUB_W / SUB_H, height);
    this.node.setPosition(0, y, 0);
    this.node.active = true;
  }
}
