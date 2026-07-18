// 局内表现层 —— 只读 Game 的字段并消费 events,不含任何玩法规则。
// P0 阶段一律色块占位(美术接入是 T5),投影/布点参数照搬 prototype/src/render.js,保证手感一致。

import {
  Color, Graphics, ImageAsset, Label, Layers, Node, Sprite, SpriteFrame, Texture2D, UITransform,
} from 'cc';
import { ObjectPool } from '../core/ObjectPool';
import { unitFormationSlot, clamp } from '../core/rules';
import type { Game } from '../core/game';
import type { GateEffect, Tuning } from '../defs/types';

// 设计分辨率与伪 3D 投影参数(《美术需求清单》§0;与 prototype/src/render.js 同值)
const DESIGN_W = 1080;
const DESIGN_H = 1920;
const FAR = 130;            // 最远可见纵深
const NEAR = -18;           // 赛道近端(需铺满屏幕底部)
const GATE_NEAR = -5;       // 门穿过大军后即剔除
const GATE_H = 5.2;         // 门高(世界单位)
const BIRD_SIZE = 1.05;     // 单兵直径(世界单位)
const HORIZON_Y = DESIGN_H * 0.30;
const ARMY_Y = DESIGN_H * 0.76;
const PERSP = 0.030;
const HALF_H = DESIGN_H / 2;
const WIDE = 900;           // 横向超绘,兜住 FIT_HEIGHT 下比 1080 更宽的屏

const C = {
  sky: new Color(143, 211, 244, 255),
  water: new Color(46, 107, 132, 255),
  deck: new Color(178, 188, 178, 255),
  stripe: new Color(255, 255, 255, 46),
  rail: new Color(62, 124, 116, 255),
  bird: new Color(240, 226, 178, 255),
  enemy: new Color(110, 133, 66, 255),
  boss: new Color(150, 60, 120, 255),
};

// 门的视觉分类(《美术需求清单》§4)：加成小额=蓝、大额=金、乘法=紫、陷阱=红黑
const GATE_STYLE = {
  blue: new Color(79, 168, 232, 150),
  gold: new Color(242, 195, 59, 160),
  purple: new Color(169, 111, 214, 160),
  hazard: new Color(192, 57, 43, 170),
};

function gateStyle(effect: GateEffect): Color {
  if (effect.type === 'mul') return GATE_STYLE.purple;
  if (effect.type === 'sub' || effect.type === 'div') return GATE_STYLE.hazard;
  return effect.value >= 20 ? GATE_STYLE.gold : GATE_STYLE.blue;
}

function gateLabel(effect: GateEffect): string {
  switch (effect.type) {
    case 'add': return `+${effect.value}`;
    case 'mul': return `×${effect.value}`;
    case 'sub': return `-${effect.value}`;
    case 'div': return `÷${effect.value}`;
    default: return '';
  }
}

const lerp = (a: number, b: number, t: number): number => a + (b - a) * t;

/** 1×1 纯白贴图,所有色块共用一张,靠节点 color 染色。 */
function solidSpriteFrame(): SpriteFrame {
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
  return frame;
}

interface Slot { i: number; x: number; z: number; }

export class ArenaView {
  private readonly tuning: Tuning;
  private readonly unit: number;
  private readonly solid = solidSpriteFrame();

  private readonly world: Node;       // 震屏作用在这一层
  private readonly bg: Graphics;
  private readonly track: Graphics;
  private readonly gateLayer: Node;
  private readonly enemyLayer: Node;
  private readonly armyLayer: Node;
  private readonly hud: Node;

  private readonly lbLevel: Label;
  private readonly lbArmy: Label;
  private readonly lbWave: Label;
  private readonly lbResult: Label;

  private readonly unitPool: ObjectPool<Node>;
  private readonly enemyPool: ObjectPool<Node>;
  private readonly gatePool: ObjectPool<Node>;
  private readonly units: Node[] = [];
  private readonly enemies: Node[] = [];
  private readonly gates: Node[] = [];

  /** 队形槽位只取决于数量,按数量缓存,避免逐帧重算 + 逐帧重排渲染顺序。 */
  private readonly slotCache = new Map<number, Slot[]>();

  private time = 0;
  private nPop = 0;
  private shake = 0;
  private readonly p = { x: 0, y: 0, s: 1 };

  constructor(root: Node, tuning: Tuning) {
    this.tuning = tuning;
    this.unit = (DESIGN_W * 0.90) / tuning.track.width;

    this.world = this.child(root, 'World');
    this.bg = this.child(this.world, 'Bg').addComponent(Graphics);
    this.track = this.child(this.world, 'Track').addComponent(Graphics);
    this.enemyLayer = this.child(this.world, 'Enemies');
    this.gateLayer = this.child(this.world, 'Gates');
    this.armyLayer = this.child(this.world, 'Army');
    this.hud = this.child(root, 'Hud');

    this.lbLevel = this.label(this.hud, 'Level', 44, 0, HALF_H - 116);
    this.lbWave = this.label(this.hud, 'Wave', 34, 0, HALF_H - 250);
    this.lbArmy = this.label(this.hud, 'Army', 120, 0, HALF_H - ARMY_Y + 340);
    this.lbResult = this.label(this.hud, 'Result', 60, 0, 0);
    this.lbResult.node.active = false;

    this.unitPool = new ObjectPool<Node>(
      () => this.makeBlock(this.armyLayer, C.bird),
      (n) => { n.active = true; },
      (n) => { n.active = false; },
      tuning.nRender,
    );
    this.enemyPool = new ObjectPool<Node>(
      () => this.makeBlock(this.enemyLayer, C.enemy),
      (n) => { n.active = true; },
      (n) => { n.active = false; },
    );
    this.gatePool = new ObjectPool<Node>(
      () => this.makeGate(),
      (n) => { n.active = true; },
      (n) => { n.active = false; },
    );
  }

  // —— 节点搭建 ——

  private child(parent: Node, name: string): Node {
    const n = new Node(name);
    n.layer = Layers.Enum.UI_2D;
    n.addComponent(UITransform);
    n.parent = parent;
    return n;
  }

  private label(parent: Node, name: string, size: number, x: number, y: number): Label {
    const n = this.child(parent, name);
    n.setPosition(x, y, 0);
    const lb = n.addComponent(Label);
    lb.fontSize = size;
    lb.lineHeight = size * 1.2;
    lb.horizontalAlign = Label.HorizontalAlign.CENTER;
    lb.verticalAlign = Label.VerticalAlign.CENTER;
    lb.color = new Color(255, 255, 255, 255);
    lb.enableOutline = true;
    lb.outlineColor = new Color(43, 36, 32, 255);
    lb.outlineWidth = 4;
    return lb;
  }

  /** 锚点在底边中点的纯色块,与原型"贴地绘制"一致。 */
  private makeBlock(parent: Node, color: Color): Node {
    const n = this.child(parent, 'Block');
    n.getComponent(UITransform).setAnchorPoint(0.5, 0);
    const sp = n.addComponent(Sprite);
    sp.spriteFrame = this.solid;
    sp.sizeMode = Sprite.SizeMode.CUSTOM;
    sp.type = Sprite.Type.SIMPLE;
    sp.color = color;
    return n;
  }

  private makeGate(): Node {
    const n = this.makeBlock(this.gateLayer, GATE_STYLE.blue);
    this.label(n, 'Tag', 78, 0, 0);
    return n;
  }

  // —— 投影(伪 3D,返回 Canvas 局部 UI 坐标) ——

  private project(worldX: number, dz: number): { x: number; y: number; s: number } {
    const s = 1 / Math.max(1 + dz * PERSP, 0.15);
    this.p.x = worldX * s * this.unit;
    this.p.y = HALF_H - (HORIZON_Y + (ARMY_Y - HORIZON_Y) * s);
    this.p.s = s;
    return this.p;
  }

  private slotsFor(count: number): Slot[] {
    let slots = this.slotCache.get(count);
    if (slots) return slots;
    slots = [];
    for (let i = 0; i < count; i++) {
      const s = unitFormationSlot(i, count);
      slots.push({ i, x: s.x, z: s.z });
    }
    slots.sort((a, b) => b.z - a.z);   // 远 → 近,渲染顺序即兄弟顺序
    this.slotCache.set(count, slots);
    return slots;
  }

  // —— 对外 ——

  /** 换关时回收全部池化节点。 */
  reset(): void {
    while (this.units.length) this.unitPool.put(this.units.pop());
    while (this.enemies.length) this.enemyPool.put(this.enemies.pop());
    while (this.gates.length) this.gatePool.put(this.gates.pop());
    this.lbResult.node.active = false;
    this.nPop = 0;
    this.shake = 0;
    this.world.setPosition(0, 0, 0);
  }

  /** 消费本帧事件,驱动打击感(§8 手感参数)。 */
  consume(game: Game): void {
    for (const e of game.events) {
      if (e.kind === 'gate') this.nPop = 1;
      else if (e.kind === 'smashStart') this.shake = this.tuning.fx.smashShakeAmp;
      // smashEnd 无需额外表现:兵力与血条已由 draw() 按 game 状态刷新
    }
  }

  draw(game: Game, dt: number): void {
    this.time += dt;
    this.nPop = Math.max(0, this.nPop - dt * 4);
    this.shake = Math.max(0, this.shake - dt * (this.tuning.fx.smashShakeAmp / this.tuning.fx.smashShakeDuration));
    this.world.setPosition(
      this.shake > 0 ? (Math.random() - 0.5) * this.shake * 2 : 0,
      this.shake > 0 ? (Math.random() - 0.5) * this.shake * 2 : 0,
      0,
    );

    this.drawBg();
    this.drawTrack(game);
    this.syncGates(game);
    this.syncEnemies(game);
    this.syncArmy(game);
    this.drawHud(game);
  }

  private drawBg(): void {
    const g = this.bg;
    g.clear();
    const horizon = HALF_H - HORIZON_Y;
    g.fillColor = C.sky;
    g.rect(-WIDE, horizon, WIDE * 2, HALF_H - horizon);
    g.fill();
    g.fillColor = C.water;
    g.rect(-WIDE, -HALF_H, WIDE * 2, horizon + HALF_H);
    g.fill();
  }

  private drawTrack(game: Game): void {
    const g = this.track;
    const hw = this.tuning.track.width / 2;
    g.clear();

    // 桥面梯形
    const nl = this.project(-hw, NEAR); const nlx = nl.x; const nly = nl.y;
    const nr = this.project(hw, NEAR); const nrx = nr.x; const nry = nr.y;
    const fl = this.project(-hw, FAR); const flx = fl.x; const fly = fl.y;
    const fr = this.project(hw, FAR); const frx = fr.x; const fry = fr.y;
    g.fillColor = C.deck;
    g.moveTo(nlx, nly);
    g.lineTo(flx, fly);
    g.lineTo(frx, fry);
    g.lineTo(nrx, nry);
    g.close();
    g.fill();

    // 前进条纹(速度感):每 10 世界单位一条,按透视收窄
    const step = 10;
    const first = Math.ceil(game.z / step) * step;
    g.fillColor = C.stripe;
    for (let z = first; z < game.z + FAR; z += step) {
      const dz = z - game.z;
      const a = this.project(-hw, dz); const ax = a.x; const ay = a.y;
      const b = this.project(hw, dz); const bx = b.x;
      const c = this.project(-hw, dz + 1.6); const cx = c.x; const cy = c.y;
      const d = this.project(hw, dz + 1.6); const dx = d.x;
      g.moveTo(ax, ay);
      g.lineTo(cx, cy);
      g.lineTo(dx, cy);
      g.lineTo(bx, ay);
      g.close();
      g.fill();
    }

    // 护栏
    g.lineWidth = 6;
    g.strokeColor = C.rail;
    for (const side of [-1, 1]) {
      const n = this.project(side * hw, NEAR); const nx = n.x; const ny = n.y;
      const f = this.project(side * hw, FAR);
      g.moveTo(nx, ny);
      g.lineTo(f.x, f.y);
    }
    g.stroke();
  }

  private syncGates(game: Game): void {
    const frames: { effect: GateEffect; dz: number }[] = [];
    for (const gate of game.gates) {
      const dz = gate.posZ - game.z;
      if (dz > FAR || dz < GATE_NEAR) continue;
      if (gate.type === 'pick') for (const opt of gate.options) frames.push({ effect: opt, dz });
      else frames.push({ effect: gate, dz });
    }
    frames.sort((a, b) => b.dz - a.dz);   // 远 → 近

    this.resize(this.gates, this.gatePool, frames.length);

    const track = this.tuning.track;
    for (let i = 0; i < frames.length; i++) {
      const { effect, dz } = frames[i];
      const node = this.gates[i];
      const bl = this.project(track.laneX[effect.side] - track.gateHalfWidth, dz);
      const blx = bl.x; const bly = bl.y; const s = bl.s;
      const brx = this.project(track.laneX[effect.side] + track.gateHalfWidth, dz).x;
      const height = GATE_H * this.unit * s;   // 门高按透视缩放,与原型同式

      if (height <= 2) { node.active = false; continue; }
      node.active = true;
      node.setPosition((blx + brx) / 2, bly, 0);
      node.getComponent(UITransform).setContentSize(brx - blx, height);
      node.getComponent(Sprite).color = gateStyle(effect);

      const tag = node.getChildByName('Tag');
      tag.setPosition(0, height / 2, 0);
      const lb = tag.getComponent(Label);
      lb.string = gateLabel(effect);
      lb.fontSize = Math.max(10, 78 * s);
      lb.lineHeight = lb.fontSize * 1.2;
    }
  }

  private syncEnemies(game: Game): void {
    const wave = game.currentWave;
    const dz = wave ? wave.posZ - game.z : 0;
    if (!wave || dz > FAR || dz < NEAR) { this.resize(this.enemies, this.enemyPool, 0); return; }

    const smashing = game.state === 'smashing' && game.smash.wave === wave;
    const ratio = smashing ? lerp(1, game.smash.hAfter / game.smash.hBefore, game.smash.progress) : 1;

    if (wave.isBoss) {
      this.resize(this.enemies, this.enemyPool, 1);
      const p = this.project(0, dz);
      const size = 6.5 * p.s * this.unit;
      const node = this.enemies[0];
      node.setPosition(p.x, p.y, 0);
      node.getComponent(UITransform).setContentSize(size, size);
      node.getComponent(Sprite).color = C.boss;
      return;
    }

    const total = clamp(Math.round(wave.H / 14), 6, 40);
    const alive = Math.max(1, Math.round(total * ratio));
    const R = 0.75 * Math.sqrt(total);
    const slots = this.slotsFor(total);
    this.resize(this.enemies, this.enemyPool, alive);

    for (let i = 0; i < alive; i++) {
      const slot = slots[i];
      const p = this.project(slot.x * R, dz + slot.z * R);
      const size = 1.25 * p.s * this.unit;
      const node = this.enemies[i];
      node.setPosition(p.x, p.y + Math.sin(this.time * 8 + slot.i) * size * 0.05, 0);
      node.getComponent(UITransform).setContentSize(size, size);
      node.getComponent(Sprite).color = C.enemy;
    }
  }

  private syncArmy(game: Game): void {
    const t = this.tuning;
    const shown = Math.min(game.n, t.nRender);
    this.resize(this.units, this.unitPool, Math.max(0, shown));
    if (shown <= 0) return;

    // 超出 N_render 的部分用整体放大表现"更多"(§2)
    const overflow = game.n > t.nRender ? 1 + Math.log10(game.n / t.nRender) * 0.28 : 1;
    const R = t.formationRadiusK * Math.sqrt(game.n);
    const hw = t.track.width / 2 - BIRD_SIZE / 2;
    const slots = this.slotsFor(shown);

    for (let i = 0; i < shown; i++) {
      const slot = slots[i];
      const wx = clamp(game.centerX + slot.x * R, -hw, hw);
      const p = this.project(wx, slot.z * R);
      const size = BIRD_SIZE * overflow * p.s * this.unit;
      const node = this.units[i];
      node.setPosition(p.x, p.y + Math.sin(this.time * 12 + slot.i * 0.7) * size * 0.06, 0);
      node.getComponent(UITransform).setContentSize(size, size);
      node.getComponent(Sprite).color = C.bird;
    }
  }

  /** 把 list 的长度对齐到 want,多退少补 —— 池化的唯一出入口。 */
  private resize(list: Node[], pool: ObjectPool<Node>, want: number): void {
    while (list.length > want) pool.put(list.pop());
    while (list.length < want) list.push(pool.get());
  }

  private drawHud(game: Game): void {
    const smashing = game.state === 'smashing';
    const shownN = smashing
      ? Math.round(lerp(game.smash.nBefore, game.smash.nAfter, game.smash.progress))
      : game.n;

    this.lbLevel.string = `第 ${game.level.level} 关   进度 ${Math.round(game.progress * 100)}%`;

    const pop = 1 + this.nPop * 0.25;
    this.lbArmy.string = String(shownN);
    this.lbArmy.node.setScale(pop, pop, 1);

    const wave = game.currentWave;
    if (wave && wave.posZ - game.z < 70) {
      const hp = smashing ? lerp(game.smash.hBefore, game.smash.hAfter, game.smash.progress) : wave.H;
      const tag = wave.isBoss ? `烂蒜魔王 ${wave.phase}/${wave.phaseCount}` : '霉烂军团';
      this.lbWave.string = `${tag}  ${Math.max(0, Math.round(hp))} / ${wave.H}   需 ${Math.ceil(wave.H / game.level.k)} 兵`;
    } else {
      this.lbWave.string = '';
    }
  }

  /** 结算页(占位,正式 UI 是 T6)。 */
  showResult(game: Game, gain: { coins: number; unlocked: boolean }, coins: number): void {
    const r = game.result;
    const lines = r.win
      ? [
        `通关!  ${'★'.repeat(r.star)}${'☆'.repeat(3 - r.star)}`,
        `剩余 ${r.nEnd}   峰值 ${r.nPeak}   最优度 ${(r.ratio * 100).toFixed(0)}%`,
        `金币 +${gain.coins}  (共 ${coins})`,
        '点击进入下一关',
      ]
      : [
        '失败',
        `峰值兵力 ${r.nPeak}`,
        game.smash ? `撞击时 ${game.smash.nBefore} 兵,需要 ${Math.ceil(game.smash.wave.H / game.level.k)} 兵` : '兵力被陷阱扣光',
        '点击重开本关',
      ];
    this.lbResult.string = lines.join('\n');
    this.lbResult.node.active = true;
  }
}
