// 局内表现层(T13 色块占位)—— 只读 Game 的字段做呈现,不含任何玩法规则。
// 照 T4 的做法:大军 / 怪 / 门 / 闸门 / 障碍 / 桶都用纯色块 + 文字标号,能看出位置与状态即可。
// **射击表现(弹幕、怪潮堆叠、冲击波、命中闪光)是 T14 的活,这里一概不画。** 美术接入是 T15。
//
// 伪 3D 投影参数与输入换算(GameController.unitPx)同源,保证色块位置和手指走位对得上。

import {
  Color, ImageAsset, Label, Layers, Node, Sprite, Texture2D, SpriteFrame, UITransform,
} from 'cc';
import { ObjectPool } from '../core/ObjectPool';
import { rewardLabel, isBuff } from '../core/rules';
import type { Game } from '../core/game';
import type { GateEffect, Tuning } from '../defs/types';

const DESIGN_W = 1080;
const DESIGN_H = 1920;
const FAR = 130;            // 最远可见纵深
const NEAR = -14;           // 赛道近端(穿过大军后即剔除)
const HORIZON_Y = DESIGN_H * 0.30;
const ARMY_Y = DESIGN_H * 0.76;
const PERSP = 0.030;
const HALF_H = DESIGN_H / 2;
const TRACK_STEP = 8;       // 赛道横档纵向间距(世界单位),给滚动一个参照
const MAX_ENEMY_BLOCK = 200;// 色块调试上限,别把 300 只全建成节点

const SKY = new Color(143, 211, 244, 255);
const ROAD = new Color(94, 116, 74, 255);
const C_ARMY = new Color(245, 240, 230, 255);
const C_ARMY_HIT = new Color(232, 86, 86, 255);   // 掉兵红闪
const C_ARMY_BOOST = new Color(120, 220, 235, 255);// 突破冲刺
const C_ENEMY = new Color(120, 60, 70, 255);
const C_ENEMY_THICK = new Color(70, 40, 55, 255);
const C_GATE_BUFF = new Color(90, 150, 235, 255);
const C_GATE_MUL = new Color(170, 90, 210, 255);
const C_GATE_TRAP = new Color(40, 20, 24, 255);
const C_PICK = new Color(150, 100, 210, 255);
const C_BARRIER = new Color(210, 150, 60, 255);
const C_OBSTACLE = new Color(35, 30, 28, 255);
const C_BARREL = new Color(235, 200, 90, 255);
const C_BOSS = new Color(150, 40, 90, 255);
const C_TEXT = new Color(255, 255, 255, 255);
const C_TEXT_DARK = new Color(30, 24, 20, 255);

/** 门色:陷阱(减益)红黑,乘法紫,加法蓝。 */
function gateColor(e: GateEffect): Color {
  if (!isBuff(e)) return C_GATE_TRAP;
  return e.op === 'mul' ? C_GATE_MUL : C_GATE_BUFF;
}

/** 门标号:如 N+2 / L×2 / R+1。 */
function gateText(e: GateEffect): string {
  return `${e.dim}${e.op === 'mul' ? '×' : '+'}${e.value}`;
}

/** 1×1 纯白贴图,色块靠 tint 上色(与旧 ArenaView 同法:运行时造的贴图不进动态图集)。 */
function solidFrame(): SpriteFrame {
  const image = new ImageAsset({
    _data: new Uint8Array([255, 255, 255, 255]), _compressed: false,
    width: 1, height: 1, format: Texture2D.PixelFormat.RGBA8888,
  });
  const tex = new Texture2D();
  tex.image = image;
  const frame = new SpriteFrame();
  frame.texture = tex;
  frame.packable = false;
  return frame;
}

export class ArenaView {
  private readonly tuning: Tuning;
  private readonly unit: number;
  private readonly solid = solidFrame();

  private readonly world: Node;
  private readonly bg: Sprite;
  private readonly trackLayer: Node;
  private readonly enemyLayer: Node;
  private readonly propLayer: Node;   // 障碍 / 桶
  private readonly gateLayer: Node;   // 门 / 闸门
  private readonly armyLayer: Node;

  private readonly pool: ObjectPool<Node>;
  private readonly track: Node[] = [];
  private readonly enemies: Node[] = [];
  private readonly props: Node[] = [];
  private readonly gates: Node[] = [];
  private readonly army: Node[] = [];

  private shake = 0;
  private readonly p = { x: 0, y: 0, s: 1 };

  constructor(root: Node, tuning: Tuning) {
    this.tuning = tuning;
    this.unit = (DESIGN_W * 0.90) / tuning.track.width;

    this.world = this.child(root, 'World');
    this.bg = this.child(this.world, 'Bg').addComponent(Sprite);
    this.bg.spriteFrame = this.solid;
    this.bg.sizeMode = Sprite.SizeMode.CUSTOM;
    this.bg.color = SKY;
    this.bg.getComponent(UITransform).setContentSize(DESIGN_W * 1.2, DESIGN_H * 1.2);

    this.trackLayer = this.child(this.world, 'Track');
    this.enemyLayer = this.child(this.world, 'Enemies');
    this.propLayer = this.child(this.world, 'Props');
    this.gateLayer = this.child(this.world, 'Gates');
    this.armyLayer = this.child(this.world, 'Army');

    this.pool = new ObjectPool<Node>(
      () => this.makeBlock(),
      (n) => { n.active = true; },
      (n) => { n.active = false; },
    );
  }

  // —— 对外(GameController 只认这四个 + reset) ——

  reset(): void {
    for (const list of [this.track, this.enemies, this.props, this.gates, this.army]) {
      while (list.length) this.pool.put(list.pop());
    }
    this.shake = 0;
    this.world.setPosition(0, 0, 0);
  }

  /** 消费本帧事件驱动打击感(色块阶段只做轻微震屏,弹幕/冲击波留给 T14)。 */
  consume(game: Game): void {
    for (const e of game.events) {
      if (e.kind === 'obstacleHit' || e.kind === 'barrierDown') this.shake = 14;
      else if (e.kind === 'leak' && e.loss > 0) this.shake = Math.max(this.shake, 8);
    }
  }

  draw(game: Game, dt: number): void {
    this.shake = Math.max(0, this.shake - dt * 60);
    this.world.setPosition(
      this.shake > 0 ? (Math.random() - 0.5) * this.shake * 2 : 0,
      this.shake > 0 ? (Math.random() - 0.5) * this.shake * 2 : 0, 0,
    );
    this.drawTrack(game);
    this.drawEnemies(game);
    this.drawProps(game);
    this.drawGates(game);
    this.drawArmy(game);
  }

  /** 结算 UI 由 ResultScreen(T6)负责,色块层不另画结算页,冻在最后一帧即可。 */
  showResult(_game: Game, _gain: { coins: number; unlocked: boolean }, _coins: number): void { /* no-op */ }

  // —— 各层色块 ——

  private drawTrack(game: Game): void {
    const half = this.tuning.track.width / 2;
    const first = Math.ceil((game.z + NEAR) / TRACK_STEP);
    const last = Math.floor((game.z + FAR) / TRACK_STEP);
    let n = 0;
    for (let m = last; m >= first; m--) {           // 远 → 近
      const p = this.project(0, m * TRACK_STEP - game.z);
      const node = this.acquire(this.track, this.trackLayer, n++);
      this.paint(node, p.x, p.y, half * 2 * p.s * this.unit, Math.max(2, 6 * p.s), ROAD, '', C_TEXT);
    }
    this.trim(this.track, n);
  }

  private drawEnemies(game: Game): void {
    const shown = Math.min(game.enemies.length, MAX_ENEMY_BLOCK);
    let n = 0;
    for (let i = 0; i < shown; i++) {
      const e = game.enemies[i];
      const dz = e.z - game.z;
      if (dz > FAR || dz < NEAR) continue;
      const p = this.project(e.x, dz);
      const size = Math.max(4, 0.9 * p.s * this.unit);
      const node = this.acquire(this.enemies, this.enemyLayer, n++);
      this.paint(node, p.x, p.y, size, size, e.type === 'thick' ? C_ENEMY_THICK : C_ENEMY, '', C_TEXT);
    }
    this.trim(this.enemies, n);
  }

  /** 障碍(不可摧毁,画危险带宽度)+ 油桶(可打,带奖励标号)。 */
  private drawProps(game: Game): void {
    let n = 0;
    for (const o of game.obstacles) {
      const dz = o.posZ - game.z;
      if (dz > FAR || dz < NEAR) continue;
      const p = this.project(o.cx, dz);
      const w = (o.width + this.tuning.obstacleHitHalfW * 2) * p.s * this.unit;   // 画判定区宽度,让"该躲多远"看得见
      const node = this.acquire(this.props, this.propLayer, n++);
      this.paint(node, p.x, p.y, w, Math.max(8, 22 * p.s), C_OBSTACLE, o.type === 'roller' ? '轮' : '刺', C_TEXT);
    }
    for (const b of game.barrels) {
      if (b.dead) continue;
      const dz = b.posZ - game.z;
      if (dz > FAR || dz < NEAR) continue;
      const p = this.project(b.x, dz);
      const size = Math.max(10, 1.6 * p.s * this.unit);
      const node = this.acquire(this.props, this.propLayer, n++);
      this.paint(node, p.x, p.y, size, size, C_BARREL, rewardLabel(b.reward), C_TEXT_DARK);
    }
    this.trim(this.props, n);
  }

  /** 门(含 pick 双选)+ 闸门 + BOSS。 */
  private drawGates(game: Game): void {
    let n = 0;
    const track = this.tuning.track;
    const gw = track.gateHalfWidth * 2;
    for (const gate of game.gates) {
      const dz = gate.posZ - game.z;
      if (dz > FAR || dz < NEAR) continue;
      const opts: GateEffect[] = 'options' in gate ? gate.options : [gate as GateEffect];
      for (const e of opts) {
        const p = this.project(track.laneX[e.side], dz);
        const node = this.acquire(this.gates, this.gateLayer, n++);
        this.paint(node, p.x, p.y, gw * p.s * this.unit, Math.max(10, 40 * p.s),
          gate.type === 'pick' ? C_PICK : gateColor(e), gateText(e), C_TEXT);
      }
    }
    // 闸门:横跨赛道的火力检验点,标号 = 剩余血量
    for (const b of game.barriers) {
      if (b.hp <= 0) continue;
      const dz = b.posZ - game.z;
      if (dz > FAR || dz < NEAR) continue;
      const p = this.project(0, dz);
      const node = this.acquire(this.gates, this.gateLayer, n++);
      this.paint(node, p.x, p.y, track.width * p.s * this.unit, Math.max(14, 52 * p.s),
        C_BARRIER, String(Math.max(0, Math.round(b.hp))), C_TEXT_DARK);
    }
    // BOSS:单体大块,标号 = 剩余血量
    if (game.boss && game.boss.hp > 0) {
      const dz = game.boss.posZ - game.z;
      if (dz <= FAR && dz >= NEAR) {
        const p = this.project(0, dz);
        const size = Math.max(30, 6 * p.s * this.unit);
        const node = this.acquire(this.gates, this.gateLayer, n++);
        this.paint(node, p.x, p.y, size, size, C_BOSS, String(Math.round(game.boss.hp)), C_TEXT);
      }
    }
    this.trim(this.gates, n);
  }

  /** 大军:一块随阵型半径涨大的色块 + 兵力数字,红闪/冲刺换色。 */
  private drawArmy(game: Game): void {
    const t = this.tuning;
    const R = Math.min(t.formationRadiusK * Math.sqrt(Math.max(1, game.stats.N)), t.formationRadiusMax);
    const p = this.project(game.centerX, 0);
    const w = Math.max(30, R * 2 * p.s * this.unit);
    const h = Math.max(24, R * 1.1 * p.s * this.unit);
    const color = game.shieldT > 0 ? C_ARMY_HIT : game.boostT > 0 ? C_ARMY_BOOST : C_ARMY;
    const node = this.acquire(this.army, this.armyLayer, 0);
    this.paint(node, p.x, p.y, w, h, color, String(game.stats.N), C_TEXT_DARK);
    this.trim(this.army, 1);
  }

  // —— 基建 ——

  private project(worldX: number, dz: number): { x: number; y: number; s: number } {
    const s = 1 / Math.max(1 + dz * PERSP, 0.15);
    this.p.x = worldX * s * this.unit;
    this.p.y = HALF_H - (HORIZON_Y + (ARMY_Y - HORIZON_Y) * s);
    this.p.s = s;
    return this.p;
  }

  /** 从池里取 list[i](不够就补),并保证它在对应 layer 下。 */
  private acquire(list: Node[], layer: Node, i: number): Node {
    let node = list[i];
    if (!node) { node = this.pool.get(); list[i] = node; }
    if (node.parent !== layer) node.parent = layer;
    return node;
  }

  /** 把 list 收缩到 count,多的还池。 */
  private trim(list: Node[], count: number): void {
    while (list.length > count) this.pool.put(list.pop());
  }

  private paint(node: Node, x: number, y: number, w: number, h: number, color: Color, text: string, textColor: Color): void {
    node.setPosition(x, y, 0);
    node.getComponent(UITransform).setContentSize(w, h);
    node.getComponent(Sprite).color = color;
    const lb = node.getChildByName('T').getComponent(Label);
    if (text) {
      lb.node.active = true;
      lb.string = text;
      lb.color = textColor;
      lb.fontSize = Math.max(12, Math.min(40, h * 0.7));
      lb.lineHeight = lb.fontSize;
    } else {
      lb.node.active = false;
    }
  }

  private makeBlock(): Node {
    const n = this.child(this.world, 'B');
    n.getComponent(UITransform).setAnchorPoint(0.5, 0.5);
    const sp = n.addComponent(Sprite);
    sp.sizeMode = Sprite.SizeMode.CUSTOM;
    sp.type = Sprite.Type.SIMPLE;
    sp.spriteFrame = this.solid;

    const tag = this.child(n, 'T');
    const lb = tag.addComponent(Label);
    lb.horizontalAlign = Label.HorizontalAlign.CENTER;
    lb.verticalAlign = Label.VerticalAlign.CENTER;
    lb.enableOutline = true;
    lb.outlineColor = new Color(20, 16, 12, 200);
    lb.outlineWidth = 2;
    return n;
  }

  private child(parent: Node, name: string): Node {
    const n = new Node(name);
    n.layer = Layers.Enum.UI_2D;
    n.addComponent(UITransform);
    n.parent = parent;
    return n;
  }
}
