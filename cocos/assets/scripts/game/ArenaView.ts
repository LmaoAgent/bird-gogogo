// 局内射击表现层(T14)—— 只读 Game 字段 + 消费 events,不含任何玩法规则。
// **参考实现 prototype-v2/src/render.js**:弹幕成流、怪潮铺满堆叠、门墙长龙、闸门数字、
// 突破冲击波、命中飘字、震屏 —— 那里已把手感调好,本文件把它的表现语言原样搬进 Cocos,不重新发明。
//
// 渲染结构:每个游戏实体(兵/怪/子弹/门/桶/障碍/闸门/BOSS)都是一个池化 Sprite 节点,
// 现在贴 1×1 纯白占位、靠 color 染色;**T15 换真美术只需把占位帧换成对应 SpriteFrame/动画,结构不动**。
// 全部色块共用同一张 solid 帧 → Cocos 2D 同材质同贴图自动合批,300 怪 + 300 子弹也只有个位数 draw call。
// 唯一的例外是突破冲击波的扩散环:它是投影后的椭圆描边,用一个 Graphics 画最省(且只在破门那 0.5 秒出现)。
//
// 伪 3D 投影沿用 render.js 的做法(手感一致);x 方向刻度与输入换算(GameController.unitPx)同源
// —— unit = 设计宽 0.90 / 赛道宽 —— 保证色块位置和手指走位对得上。配色按《v2》§0「明亮大胆降 CPI」。

import {
  Color, Graphics, ImageAsset, Label, Layers, Node, Sprite, Texture2D, SpriteFrame, UITransform,
} from 'cc';
import { unitFormationSlot, isBuff, rewardLabel } from '../core/rules';
import type { Game } from '../core/game';
import type { BarrelReward, GateEffect, Tuning } from '../defs/types';

const DESIGN_W = 1080;
const DESIGN_H = 1920;
const HALF_H = DESIGN_H / 2;

// 投影常量(逐字沿用 render.js)
const HORIZON_Y = DESIGN_H * 0.30;
const ARMY_Y = DESIGN_H * 0.78;
const PERSP = 0.030;
const FAR = 62;        // 最远可见相对纵深;超过就剔除

// 撞击推挤(纯表现):怪撞进大军时把附近的兵顶开,弹簧拉回原位
const KICK = 7, KICK_R = 2.6, SPRING = 120, DAMP = 13;

// fx 节点上限:抽样已经压过大头,这里再兜一道底,防成片死亡的瞬间把池撑爆掉帧
const FX_CAP = 220;

// —— 配色(《v2》§0 / §4)——
const C = (r: number, g: number, b: number): Color => new Color(r, g, b, 255);
const SKY = C(122, 204, 245);
const GROUND = C(46, 107, 122);
const ROAD = C(201, 214, 208);
const ROAD_LINE = C(220, 230, 225);
const GARLIC = C(245, 240, 230);
const GARLIC_DARK = C(216, 205, 182);
const GARLIC_BLINK = C(255, 255, 255);
const GARLIC_BLINK_D = C(255, 233, 233);
const GARLIC_BOOST = C(255, 243, 196);
const GARLIC_BOOST_D = C(232, 206, 122);
const MOUTH = C(242, 168, 59);
const MOLD = C(94, 140, 43);
const MOLD_DARK = C(60, 92, 27);
const THICK = C(122, 92, 43);
const BULLET = C(255, 255, 255);
const BULLET_TRAIL = C(255, 154, 46);
const HIT = C(255, 243, 176);
const INK = C(43, 36, 32);
const WHITE = C(255, 255, 255);

const DIM_COLOR: Record<string, Color> = {
  N: C(62, 143, 224), L: C(155, 93, 229), R: C(244, 157, 26), D: C(229, 72, 77),
};
const TRAP_COLOR = C(58, 43, 43);

// 障碍:门是「要不要走进去」、障碍是「必须走开」,长相不能像 —— 障碍是实心低矮红尖刺 / 黄黑滚筒,零文字。
const SPIKE = C(255, 59, 48);
const SPIKE_DARK = C(122, 20, 24);
const ROLLER = C(245, 197, 24);
const ROLLER_AXLE = C(110, 116, 120);

// 油桶:锈色桶身负责「这是个桶」,维度色腰带 + 上方标签负责「它给什么」(《美术需求清单v2补充》§5)。
const BARREL_BODY = C(196, 100, 58);
const BARREL_BODY_D = C(143, 69, 38);
const BARREL_CAP = C(222, 139, 94);
const BARREL_HOOP = C(90, 53, 32);
const BUFF_COLOR = C(255, 102, 196);   // 限时 buff 无维度,单给一个别处没用过的品红

// 闸门 / BOSS
const BARRIER_BODY = C(110, 116, 120);
const BARRIER_BODY_D = C(86, 92, 96);
const BARRIER_WARN = C(232, 185, 58);
const BARRIER_POST = C(74, 80, 84);
const BOSS_BODY = C(59, 47, 30);
const BOSS_HP = C(229, 72, 77);

// 特效方块的类型色
const FX_THICK = C(201, 162, 39);
const FX_WAVE = C(255, 154, 46);
const FX_DEFAULT = C(223, 245, 168);

// 冲击波扩散环 + 冲刺速度线
const WAVE_OUTER = C(255, 106, 26);
const WAVE_MID = C(255, 194, 58);
const STREAK = C(255, 154, 46);

// 掉兵红闪 / 突破金闪的底色
const FLASH_RED = C(229, 72, 77);
const FLASH_GOLD = C(255, 236, 170);

const rewardColor = (r: BarrelReward): Color => (r.buff ? BUFF_COLOR : DIM_COLOR[r.dim]);
const gateLabel = (e: GateEffect): string => `${e.dim}${e.op === 'mul' ? '×' : '+'}${e.value}`;
const gateColor = (e: GateEffect): Color => (isBuff(e) ? DIM_COLOR[e.dim] : TRAP_COLOR);

/** 1×1 纯白贴图:所有色块靠 tint 上色。运行时造的贴图不进动态图集(否则逐帧抛异常整屏画不出)。 */
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

function mkChild(parent: Node, name: string): Node {
  const n = new Node(name);
  n.layer = Layers.Enum.UI_2D;
  n.addComponent(UITransform);
  n.parent = parent;
  return n;
}

interface Q { node: Node; ut: UITransform; sp: Sprite; }
interface L { node: Node; lb: Label; }

/**
 * 一层同类色块的即时模式池:每帧 begin() → add() 若干次 → end()。
 * 复用上一帧的节点(不够才新建),多出来的只 active=false 不销毁 —— 全程零 instantiate/destroy。
 * 同层节点建的先后即渲染序:调用方按「远→近」顺序 add,近的天然压在上面(堆叠层次靠这个)。
 */
class Quads {
  readonly node: Node;
  private readonly items: Q[] = [];
  private used = 0;
  private prev = 0;
  constructor(parent: Node, name: string, private readonly frame: SpriteFrame) {
    this.node = mkChild(parent, name);
  }

  begin(): void { this.used = 0; }

  add(cx: number, cy: number, w: number, h: number, color: Color): Q {
    let q = this.items[this.used];
    if (!q) {
      const node = mkChild(this.node, 'q');
      const ut = node.getComponent(UITransform);
      ut.setAnchorPoint(0.5, 0.5);
      const sp = node.addComponent(Sprite);
      sp.sizeMode = Sprite.SizeMode.CUSTOM;
      sp.type = Sprite.Type.SIMPLE;
      sp.spriteFrame = this.frame;
      q = { node, ut, sp };
      this.items.push(q);
    }
    this.used++;
    if (!q.node.active) q.node.active = true;
    if (q.node.angle !== 0) q.node.angle = 0;
    q.node.setPosition(cx, cy, 0);
    q.ut.setContentSize(w, h);
    q.sp.color = color;
    return q;
  }

  end(): void {
    for (let i = this.used; i < this.prev; i++) this.items[i].node.active = false;
    this.prev = this.used;
  }

  clear(): void {
    for (const q of this.items) q.node.active = false;
    this.used = 0; this.prev = 0;
  }
}

/** 文字层的即时模式池,同 Quads,只是每个节点带一个描边 Label。 */
class Labels {
  readonly node: Node;
  private readonly items: L[] = [];
  private used = 0;
  private prev = 0;
  constructor(parent: Node, name: string) { this.node = mkChild(parent, name); }

  begin(): void { this.used = 0; }

  add(cx: number, cy: number, str: string, size: number, color: Color): void {
    let it = this.items[this.used];
    if (!it) {
      const node = mkChild(this.node, 't');
      const lb = node.addComponent(Label);
      lb.horizontalAlign = Label.HorizontalAlign.CENTER;
      lb.verticalAlign = Label.VerticalAlign.CENTER;
      lb.isBold = true;
      lb.enableOutline = true;
      lb.outlineColor = INK;
      lb.outlineWidth = 4;
      it = { node, lb };
      this.items.push(it);
    }
    this.used++;
    if (!it.node.active) it.node.active = true;
    it.node.setPosition(cx, cy, 0);
    if (it.lb.string !== str) it.lb.string = str;
    if (it.lb.fontSize !== size) { it.lb.fontSize = size; it.lb.lineHeight = size; }
    it.lb.color = color;
  }

  end(): void {
    for (let i = this.used; i < this.prev; i++) this.items[i].node.active = false;
    this.prev = this.used;
  }

  clear(): void {
    for (const it of this.items) it.node.active = false;
    this.used = 0; this.prev = 0;
  }
}

interface Fx { x: number; rel: number; t: number; life: number; kind: 'kill' | 'hit'; type?: string; color?: Color; }
interface Float { x: number; rel: number; t: number; life: number; txt: string; color: Color; }
interface Wave { z: number; range: number; t: number; life: number; }
interface Unit { ox: number; oz: number; vx: number; vz: number; }

export class ArenaView {
  private readonly tuning: Tuning;
  private readonly X: number;                 // 世界 1 单位 = 近处多少设计像素(= GameController.unitPx)
  private readonly solid = solidFrame();

  private readonly world: Node;
  private readonly shakeRoot: Node;           // 震屏偏移挂在它上;flash 在它之外,不跟着抖
  private readonly flashNode: Node;
  private readonly flashSp: Sprite;

  private readonly track: Quads;
  private readonly groundFx: Quads;
  private readonly gateQ: Quads;
  private readonly gateL: Labels;
  private readonly enemyQ: Quads;
  private readonly propQ: Quads;
  private readonly propL: Labels;
  private readonly bulletQ: Quads;
  private readonly armyQ: Quads;
  private readonly pipQ: Quads;
  private readonly fxQ: Quads;
  // 冲击波用的 Graphics 惰性建:构造期(boot 阶段)引擎的 2d Graphics 模块可能尚未求值,
  // 此刻 addComponent(Graphics) 会拿到 undefined 抛「Type must be non-nil」。破门冲击波是低频特效,
  // 首次真要画时(游戏早跑起来了)再建即可,顺带省掉不破门那些局的一个节点。
  private waveGNode: Node | null = null;
  private _waveG: Graphics | null = null;
  private readonly floatL: Labels;

  private readonly fx: Fx[] = [];
  private readonly floats: Float[] = [];
  private readonly waves: Wave[] = [];
  private readonly impacts: number[] = [];    // 本帧撞进大军的怪的 x,给大军做推挤
  private readonly units: Unit[] = [];        // 每个阵型位置的推挤偏移(持久)
  private readonly zsort: Game['enemies'] = [];// 怪的绘制序,复用免得每帧新建数组
  private shake = 0;
  private flash = 0;
  private flashCol = FLASH_RED;
  private aimPip = false;

  private readonly c = new Color();            // 透明度 / 混色的临时色(add 会立即拷贝,复用安全)

  constructor(root: Node, tuning: Tuning) {
    this.tuning = tuning;
    this.X = (DESIGN_W * 0.90) / tuning.track.width;

    this.world = mkChild(root, 'Arena');
    this.shakeRoot = mkChild(this.world, 'Shake');

    // 天空铺满、地面盖下半(震屏时也不露边,故都放大一圈)
    this.bgQuad(SKY, 0, DESIGN_W * 1.3, DESIGN_H * 1.3);
    const gy = HALF_H - HORIZON_Y;               // 地平线的 cocos y
    this.bgQuad(GROUND, (gy + (-HALF_H * 1.3)) / 2, DESIGN_W * 1.3, gy + HALF_H * 1.3);

    // 层序(远→近),逐字对应 render.js 的 draw() 调用顺序
    this.track = new Quads(this.shakeRoot, 'Track', this.solid);
    this.groundFx = new Quads(this.shakeRoot, 'GroundFx', this.solid);   // 危险带 / 对准带 / 冲刺线,贴地
    this.gateQ = new Quads(this.shakeRoot, 'Gates', this.solid);
    this.gateL = new Labels(this.shakeRoot, 'GateText');
    this.enemyQ = new Quads(this.shakeRoot, 'Enemies', this.solid);
    this.propQ = new Quads(this.shakeRoot, 'Props', this.solid);        // 障碍 + 桶 + 闸门 + BOSS 本体
    this.propL = new Labels(this.shakeRoot, 'PropText');
    this.bulletQ = new Quads(this.shakeRoot, 'Bullets', this.solid);
    this.armyQ = new Quads(this.shakeRoot, 'Army', this.solid);
    this.pipQ = new Quads(this.shakeRoot, 'Pip', this.solid);
    this.fxQ = new Quads(this.shakeRoot, 'Fx', this.solid);
    // waveG 惰性建(见字段声明处),这里只占好层序位置:'Waves' 节点要排在 Fx 之后、Floats 之前,
    // 建一个空 Node 占位,Graphics 组件等首次画冲击波时补上,层序不受影响。
    this.waveGNode = mkChild(this.shakeRoot, 'Waves');
    this.floatL = new Labels(this.shakeRoot, 'Floats');

    // 全屏闪:掉兵红 / 突破金。放在 shakeRoot 之外,盖住整屏且不跟着抖(HUD 在它之上)
    this.flashNode = mkChild(this.world, 'Flash');
    this.flashSp = this.flashNode.addComponent(Sprite);
    this.flashSp.sizeMode = Sprite.SizeMode.CUSTOM;
    this.flashSp.spriteFrame = this.solid;
    this.flashNode.getComponent(UITransform).setContentSize(DESIGN_W, DESIGN_H);
    this.flashNode.active = false;
  }

  private bgQuad(color: Color, cy: number, w: number, h: number): void {
    const n = mkChild(this.shakeRoot, 'Bg');
    n.setPosition(0, cy, 0);
    const sp = n.addComponent(Sprite);
    sp.sizeMode = Sprite.SizeMode.CUSTOM;
    sp.spriteFrame = this.solid;
    sp.color = color;
    n.getComponent(UITransform).setContentSize(w, h);
  }

  // —— 对外(GameController 只认这四个 + reset) ——

  reset(): void {
    for (const q of [this.track, this.groundFx, this.gateQ, this.enemyQ, this.propQ, this.bulletQ, this.armyQ, this.pipQ, this.fxQ]) q.clear();
    for (const l of [this.gateL, this.propL, this.floatL]) l.clear();
    if (this._waveG) this._waveG.clear();   // 没画过冲击波就没建 Graphics,别为了 clear 反而把它建出来
    this.fx.length = 0; this.floats.length = 0; this.waves.length = 0;
    this.impacts.length = 0; this.units.length = 0;
    this.shake = 0; this.flash = 0;
    this.flashNode.active = false;
    this.shakeRoot.setPosition(0, 0, 0);
  }

  showResult(_game: Game, _gain: { coins: number; unlocked: boolean }, _coins: number): void { /* 结算 UI 归 ResultScreen(T6),表现层冻在最后一帧即可 */ }

  // —— 投影(canvas 无关,直接给 cocos 坐标:原点屏幕中心,+y 朝上) ——
  private dOf(rel: number): number { return 1 / (1 + Math.max(rel, -12) * PERSP); }
  private yOf(d: number): number { return HALF_H - (HORIZON_Y + (ARMY_Y - HORIZON_Y) * d); }
  private xOf(x: number, d: number): number { return x * this.X * d; }

  /** 带透明度的临时色。 */
  private a(base: Color, alpha: number): Color {
    this.c.set(base); this.c.a = alpha; return this.c;
  }

  // —— 消费事件(逐字对应 render.js consume) ——
  consume(game: Game): void {
    const waveKills: { x: number; z: number }[] = [];
    this.impacts.length = 0;
    for (const ev of game.events) {
      if ((ev as { xs?: number[] }).xs) for (const x of (ev as { xs: number[] }).xs) this.impacts.push(x);
      if (ev.kind === 'kill') {
        if (ev.by === 'wave') { waveKills.push(ev); continue; }
        this.pushFx({ x: ev.x, rel: ev.z - game.z, t: 0, life: 0.25, kind: 'kill', type: ev.type as string });
      } else if (ev.kind === 'trample') {
        for (let i = 0; i < Math.min(ev.count, 6); i++) {
          this.pushFx({ x: ev.xs[i], rel: this.tuning.contactZ, t: 0, life: 0.3, kind: 'kill', type: 'wave' });
        }
      } else if (ev.kind === 'gate') {
        const e = ev.effect;
        this.floats.push({ x: 0, rel: 2, t: 0, life: 0.9, txt: gateLabel(e), color: gateColor(e) });
        this.shake = Math.max(this.shake, isBuff(e) ? 0.18 : 0.3);
      } else if (ev.kind === 'leak' && ev.loss) {
        // loss=0 的接触只推挤大军,不给红闪飘字 —— 那是「撞上了」,还不是「死人了」
        this.flash = 0.35; this.flashCol = FLASH_RED;
        this.shake = Math.max(this.shake, 0.35);
        this.floats.push({ x: 0, rel: 1, t: 0, life: 0.8, txt: `-${ev.loss}`, color: FLASH_RED });
      } else if (ev.kind === 'obstacleHit') {
        // 撞障碍比漏怪疼一档,反馈也要重一档,否则玩家学不会「该躲」
        this.flash = 0.55; this.flashCol = FLASH_RED;
        this.shake = Math.max(this.shake, 0.6);
        this.floats.push({ x: 0, rel: 1, t: 0, life: 0.9, txt: `-${ev.loss}`, color: FLASH_RED });
        for (let i = 0; i < 8; i++) this.pushFx({ x: ev.x + (Math.random() * 2 - 1) * 2, rel: 1.5, t: 0, life: 0.4, kind: 'kill', type: 'obstacle' });
      } else if (ev.kind === 'barrelBreak') {
        // 炸开比穿门轻、比撞障碍重:自己下注赢来的,回报感给足但不盖过突破那一下。飘字落在大军头顶(奖励上身)。
        const col = rewardColor(ev.reward);
        this.shake = Math.max(this.shake, 0.45);
        this.flash = 0.4; this.flashCol = FLASH_GOLD;
        const rel = ev.barrel.posZ - game.z;
        for (let i = 0; i < 14; i++) {
          this.pushFx({ x: ev.barrel.x + (Math.random() * 2 - 1) * 1.8, rel: rel + (Math.random() * 2 - 1) * 2.5, t: 0, life: 0.45, kind: 'kill', type: 'barrel', color: col });
        }
        this.floats.push({ x: 0, rel: 2, t: 0, life: 1.0, color: col, txt: ev.reward.buff ? `${rewardLabel(ev.reward)} ${ev.sec}s` : rewardLabel(ev.reward) });
      } else if (ev.kind === 'barrierIn') {
        this.shake = 0.4;
      } else if (ev.kind === 'barrierDown') {
        for (let i = 0; i < 26; i++) this.pushFx({ x: (Math.random() * 2 - 1) * 8, rel: ev.barrier.posZ - game.z, t: 0, life: 0.45, kind: 'kill', type: 'boss' });
      } else if (ev.kind === 'breakWave') {
        // 扩散环 + 金闪 + 强震:打穿闸门就是一片炸开,飘个字远远不够
        this.shake = 1.0;
        this.flash = 0.55; this.flashCol = FLASH_GOLD;
        this.waves.push({ z: ev.z, range: ev.range, t: 0, life: 0.5 });
        this.floats.push({ x: 0, rel: 2, t: 0, life: 0.8, txt: '突破!', color: BARRIER_WARN });
      } else if (ev.kind === 'bossIn') {
        this.shake = 0.5;
      } else if (ev.kind === 'bossDown') {
        this.shake = 0.6;
        for (let i = 0; i < 18; i++) this.pushFx({ x: (Math.random() * 2 - 1) * 5, rel: this.tuning.bossStandZ, t: 0, life: 0.5, kind: 'kill', type: 'boss' });
      }
      // bossHit(BOSS 战持续掉兵)不单独给特效:压力已由 HUD 兵力下滑 + BOSS 血条体现,逐次闪反而糊(同 render.js)
    }

    // 冲击波一击扫倒上百只,逐只画会糊成白饼盖掉冲击环。按《v2》§2.3「逻辑击杀 / 视觉击杀解耦」抽样:
    // 死多少由 core 说了算,画几朵是表现层的事。
    const stride = Math.ceil(waveKills.length / this.tuning.maxWaveFx) || 1;
    for (let i = 0; i < waveKills.length; i += stride) {
      const ev = waveKills[i];
      this.pushFx({ x: ev.x, rel: ev.z - game.z, t: 0, life: 0.5, kind: 'kill', type: 'wave' });
    }

    // 命中闪光:射速拉高后一帧命中十几发,全画会连成白饼 —— 同口径抽样,每帧只补 maxHitFx 朵。
    const hits = game.bulletHits;
    const hitStride = Math.ceil(hits.length / 2 / this.tuning.maxHitFx) || 1;
    for (let i = 0; i < hits.length; i += 2 * hitStride) {
      this.pushFx({ x: hits[i], rel: hits[i + 1] - game.z, t: 0, life: 0.13, kind: 'hit' });
    }
  }

  private pushFx(f: Fx): void { if (this.fx.length < FX_CAP) this.fx.push(f); }

  // —— 每帧绘制(逐字对应 render.js draw 的层序) ——
  draw(game: Game, dt: number): void {
    this.shake = Math.max(0, this.shake - dt * 2.2);
    this.flash = Math.max(0, this.flash - dt * 2.5);

    if (this.shake > 0) {
      const amp = this.shake * 22;
      this.shakeRoot.setPosition((Math.random() * 2 - 1) * amp, (Math.random() * 2 - 1) * amp, 0);
    } else {
      this.shakeRoot.setPosition(0, 0, 0);
    }

    this.drawTrack(game);
    this.drawGroundFx(game);        // 危险带 / 对准带贴地,压在所有立体物之下;顺带算出 aimPip
    this.drawGates(game);
    this.drawEnemies(game);
    this.drawProps(game);           // 障碍 → 桶 → 闸门 → BOSS(压在怪群之上,被埋住就等于没有)
    this.drawBullets(game);         // 子弹画在大军之前:让兵挡住膛口,只有冲出队伍那截可见 = 火力从人群里喷出来
    this.drawArmy(game, dt);
    this.drawPip(game);
    this.drawEffects(dt);
    this.drawWaves(game, dt);
    this.drawFloats(dt);

    if (this.flash > 0) {
      this.flashNode.active = true;
      this.flashSp.color = this.a(this.flashCol, Math.round(this.flash * 0.5 * 255));
    } else if (this.flashNode.active) {
      this.flashNode.active = false;
    }
  }

  private drawTrack(game: Game): void {
    const q = this.track; q.begin();
    const w = this.tuning.track.width;
    // 路面用一叠横条拼出梯形(远窄近宽):条略高于间距,拼实不留缝
    const step = 5;
    for (let rel = FAR; rel >= -12; rel -= step) {
      const d = this.dOf(rel);
      const y = this.yOf(d);
      const y2 = this.yOf(this.dOf(rel - step));
      q.add(0, (y + y2) / 2, w * this.X * d, Math.abs(y - y2) + 2, ROAD);
    }
    // 横向亮条:跟着 game.z 往近处滚,给速度感
    const off = game.z % 10;
    for (let rel = 10 - off; rel < FAR; rel += 10) {
      const d = this.dOf(rel);
      q.add(0, this.yOf(d), w * this.X * d, Math.max(2, 9 * d), ROAD_LINE);
    }
    q.end();
  }

  /** 贴地判定带:危险带(障碍)/ 对准带(桶)/ 冲刺线共用这一层。画的永远是判定宽度,不是本体轮廓。 */
  private drawGroundFx(game: Game): void {
    const q = this.groundFx; q.begin();
    const lim = this.tuning.track.width / 2;
    let near = Infinity;

    // 危险带(§V4):画真实命中区(本体半宽 + obstacleHitHalfW),让玩家对齐判定线而不是目测牙尖
    const pulse = 0.22 + 0.1 * Math.sin(game.time * 6);
    for (const o of game.obstacles) {
      const rel = o.posZ - game.z;
      if (rel > FAR) break;
      if (rel < -3) continue;
      if (rel >= 0) near = Math.min(near, rel);
      const half = o.width / 2 + this.tuning.obstacleHitHalfW;
      if (o.type === 'roller') {
        this.band(q, o.x, half + (o.amp ?? this.tuning.rollerAmp), rel, 0.1, ROLLER, lim);   // 整条巡逻范围
        this.band(q, o.cx, half, rel, pulse, ROLLER, lim);                                    // 此刻命中区
      } else {
        this.band(q, o.x, half, rel, pulse, SPIKE, lim);
      }
    }

    // 对准带(§V5):同一套语法,意思相反 —— 那是「别站这」,这是「站这才打得到」。进射程才点亮。
    const bp = 0.34 + 0.16 * Math.sin(game.time * 7);
    const aw = this.tuning.barrelAimHalfW;
    for (const b of game.barrels) {
      if (b.dead) continue;
      const rel = b.posZ - game.z;
      if (rel > FAR) break;
      if (rel < -3) continue;
      const live = rel <= this.tuning.barrelRangeZ;
      if (live) near = Math.min(near, Math.max(rel, 0));
      const col = rewardColor(b.reward);
      this.band(q, b.x, aw, rel, live ? bp : 0.1, col, lim);
      if (game.barrelTarget === b) {
        // 正在打的那个,带子压白铺满交火纵深:一眼看清火力现在被这桶吃着(面积比给桶镶白边管用得多)
        this.band(q, b.x, aw, rel, 0.3, WHITE, lim);
        for (let dz = 4; dz <= rel; dz += 4) this.band(q, b.x, aw, rel - dz, 0.12, col, lim);
      }
    }
    this.aimPip = near <= 34;   // 对准桶、躲开障碍要的是同一条中心线

    // 突破后的冲刺:地面拉出速度线,让「冲出去」看得见
    if (game.boostT > 0) {
      const alpha = Math.min(1, game.boostT / this.tuning.breakBoostS) * 0.5;
      for (let i = 0; i < 18; i++) {
        const x = (Math.random() * 2 - 1) * lim;
        const rel = Math.random() * 55;
        const d = this.dOf(rel);
        const y = this.yOf(d);
        const y2 = this.yOf(this.dOf(rel + 9));
        q.add(this.xOf(x, d), (y + y2) / 2, Math.max(3, 14 * d), Math.abs(y - y2), this.a(STREAK, Math.round(alpha * 255)));
      }
    }
    q.end();
  }

  /** 一条贴地色带(用一个矩形近似投影后的梯形:宽取 rel 处、纵深取 rel±2 的屏幕跨度)。 */
  private band(q: Quads, cx: number, half: number, rel: number, alpha: number, color: Color, lim: number): void {
    const x0 = Math.max(cx - half, -lim), x1 = Math.min(cx + half, lim);
    const d = this.dOf(rel);
    const yN = this.yOf(this.dOf(rel - 2)), yF = this.yOf(this.dOf(rel + 2));
    q.add(this.xOf((x0 + x1) / 2, d), (yN + yF) / 2, (x1 - x0) * this.X * d, Math.abs(yN - yF) + 2, this.a(color, Math.round(alpha * 255)));
  }

  /** 门:半透高框 + 维度字,横成一排「长龙」。 */
  private drawGates(game: Game): void {
    const q = this.gateQ; q.begin();
    const l = this.gateL; l.begin();
    const list: { effs: GateEffect[]; rel: number }[] = [];
    for (let i = game.gateIndex; i < game.gates.length; i++) {
      const gate = game.gates[i];
      const rel = gate.posZ - game.z;
      if (rel > FAR) break;
      if (rel < -3) continue;
      const effs = 'options' in gate ? gate.options : [gate as unknown as GateEffect];
      list.push({ effs, rel });
    }
    for (let k = list.length - 1; k >= 0; k--) {          // 远的先画,近的压上面
      for (const e of list[k].effs) this.gateFrame(q, l, e, list[k].rel);
    }
    q.end(); l.end();
  }

  private gateFrame(q: Quads, l: Labels, e: GateEffect, rel: number): void {
    const x = this.tuning.track.laneX[e.side];
    const hw = this.tuning.track.gateHalfWidth;
    const d = this.dOf(rel);
    const gy = this.yOf(d);
    const xl = this.xOf(x - hw, d), xr = this.xOf(x + hw, d);
    const h = 185 * d;
    const col = gateColor(e);
    const cx = (xl + xr) / 2, wpx = xr - xl;
    // 半透门体
    q.add(cx, gy + h / 2, wpx, h, this.a(col, 76));
    // 门框:上 + 左 + 右三道实边
    const bw = Math.max(2, 8 * d);
    q.add(cx, gy + h - bw / 2, wpx, bw, col);
    q.add(xl + bw / 2, gy + h / 2, bw, h, col);
    q.add(xr - bw / 2, gy + h / 2, bw, h, col);
    // 维度字
    l.add(cx, gy + h * 0.55, gateLabel(e), Math.max(14, Math.round(78 * d)), WHITE);
  }

  private drawEnemies(game: Game): void {
    const q = this.enemyQ; q.begin();
    const list = this.zsort; list.length = 0;
    for (const e of game.enemies) {
      const rel = e.z - game.z;
      if (rel <= FAR && rel >= -6) list.push(e);
    }
    list.sort((a, b) => b.z - a.z);                       // 远先画、近压上 —— 堆积层次全靠这一下
    for (const e of list) {
      const rel = e.z - game.z;
      const d = this.dOf(rel);
      const thick = e.type === 'thick';
      // 远处按透视会缩成小点显稀;放大一档让它们互相压住,读出来才是「海量」
      const s = (thick ? 84 : 58) * d * (1 + Math.min(rel / FAR, 1) * 0.55);
      const gy = this.yOf(d);
      const px = this.xOf(e.x, d);
      let color: Color = thick ? THICK : MOLD;
      if (e.hp < e.maxHp) {                               // 受伤露白:掉血越多越发白
        const k = (1 - e.hp / e.maxHp) * 0.6;
        this.c.set(color);
        this.c.r += (255 - color.r) * k; this.c.g += (255 - color.g) * k; this.c.b += (255 - color.b) * k;
        this.c.a = 255; color = this.c;
      }
      q.add(px, gy + s / 2, s, s, color);
    }
    q.end();
  }

  private drawProps(game: Game): void {
    const q = this.propQ; q.begin();
    const l = this.propL; l.begin();
    this.drawObstacles(game, q);
    this.drawBarrels(game, q, l);
    if (game.barrier) this.drawBarrier(game, q, l);
    if (game.bossActive && game.boss) this.drawBoss(game, q, l);
    q.end(); l.end();
  }

  /** 障碍本体。不可摧毁 → 不画血条 / 不画文字(闸门才有);一眼分清「躲它」和「打它」。 */
  private drawObstacles(game: Game, q: Quads): void {
    for (const o of game.obstacles) {
      const rel = o.posZ - game.z;
      if (rel > FAR) break;
      if (rel < -3) continue;
      const d = this.dOf(rel);
      const gy = this.yOf(d);
      const cx = this.xOf(o.cx, d);
      const wpx = o.width * this.X * d;
      if (o.type === 'roller') {
        const h = 150 * d;                               // 高度压在闸门之下、比小怪高一截
        q.add(cx, gy + h / 2, wpx, h, ROLLER);
        q.add(cx, gy + h * 0.5, wpx, Math.max(3, 18 * d), this.a(INK, 200));   // 一道暗带,读成滚筒不是牌子
        q.add(cx - wpx / 2, gy + h / 2, Math.max(6, 14 * d), h, ROLLER_AXLE);  // 两端轴帽
        q.add(cx + wpx / 2, gy + h / 2, Math.max(6, 14 * d), h, ROLLER_AXLE);
      } else {
        const h = 155 * d;
        q.add(cx, gy + h * 0.15, wpx, h * 0.3, SPIKE_DARK);                    // 底座
        const teeth = Math.max(3, Math.round(o.width * 0.9));
        const tw = wpx / teeth;
        for (let i = 0; i < teeth; i++) {                                       // 尖牙:转 45° 的方块当刺尖
          const tx = cx - wpx / 2 + (i + 0.5) * tw;
          const ts = h * 0.62;
          const t = q.add(tx, gy + h * 0.3 + ts * 0.35, ts * 0.72, ts * 0.72, SPIKE);
          t.node.angle = 45;
        }
      }
    }
  }

  /** 油桶本体:锈色桶身 + 维度色腰带 + 血条 + 奖励标签。桶身画得比对准带窄,余量看得见。 */
  private drawBarrels(game: Game, q: Quads, l: Labels): void {
    for (const b of game.barrels) {
      if (b.dead) continue;
      const rel = b.posZ - game.z;
      if (rel > FAR) break;
      if (rel < -3) continue;
      const d = this.dOf(rel);
      const gy = this.yOf(d);
      const cx = this.xOf(b.x, d);
      const wpx = 3 * this.X * d;                          // 桶宽 3 世界单位
      const h = 190 * d;
      const k = Math.max(0, b.hp / b.maxHp);
      const col = rewardColor(b.reward);
      q.add(cx, gy + h / 2, wpx, h, BARREL_BODY);
      q.add(cx, gy + h * 0.12, wpx, h * 0.24, BARREL_BODY_D);           // 下半身压暗,读出圆筒体积
      q.add(cx, gy + h * 0.96, wpx, h * 0.08, BARREL_CAP);              // 顶盖
      q.add(cx, gy + h * 0.6, wpx, h * 0.04, BARREL_HOOP);              // 两道箍
      q.add(cx, gy + h * 0.38, wpx, h * 0.04, BARREL_HOOP);
      q.add(cx, gy + h * 0.5, wpx, h * 0.2, col);                       // 腰带 = 给什么
      // 血条(照闸门语法:条在上、字在中,归到「这是打的」那一类)
      const bh = Math.max(5, 17 * d), by = gy + h + bh * 1.4;
      q.add(cx, by, wpx + 4, bh + 4, this.a(INK, 128));
      q.add(cx - wpx / 2 + wpx * k / 2, by, wpx * k, bh, col);
      l.add(cx, by + bh * 1.6, rewardLabel(b.reward), Math.max(15, Math.round(62 * d)), col);
    }
  }

  /** 闸门:横跨赛道的金属门 + 黄黑警示条 + 剩余血量大数字(照素材里的 621)。 */
  private drawBarrier(game: Game, q: Quads, l: Labels): void {
    const b = game.barrier!;
    const rel = b.posZ - game.z;
    const d = this.dOf(rel);
    const gy = this.yOf(d);
    const half = this.tuning.track.width / 2;
    const xl = this.xOf(-half - 1.2, d), xr = this.xOf(half + 1.2, d);
    const wpx = xr - xl;
    const h = 210 * d;
    q.add(0, gy + h / 2, wpx, h, BARRIER_BODY);
    q.add(0, gy + h * 0.225, wpx, h * 0.45, BARRIER_BODY_D);
    q.add(0, gy + h - h * 0.065, wpx, h * 0.13, BARRIER_WARN);                 // 黄黑警示条
    q.add(xl + 11 * d, gy + h / 2, 22 * d, h, BARRIER_POST);                   // 门柱
    q.add(xr - 11 * d, gy + h / 2, 22 * d, h, BARRIER_POST);
    l.add(0, gy + h * 0.55, String(Math.max(0, Math.ceil(b.hp))), Math.max(26, Math.round(130 * d)), WHITE);
  }

  private drawBoss(game: Game, q: Quads, l: Labels): void {
    const b = game.boss!;
    const d = this.dOf(this.tuning.bossStandZ);
    const gy = this.yOf(d);
    const s = 320 * d;
    q.add(0, gy + s / 2, s, s, BOSS_BODY);
    q.add(0, gy + s * 0.85, s, s * 0.25, MOLD_DARK);
    // 血条挂在 BOSS 头顶(世界锚定,不占 HUD)
    const bw = s * 1.2, bh = Math.max(10, 34 * d), by = gy + s + bh;
    q.add(0, by, bw + 12, bh + 12, this.a(INK, 140));
    q.add(-bw / 2 + bw * Math.max(0, b.hp / b.maxHp) / 2, by, bw * Math.max(0, b.hp / b.maxHp), bh, BOSS_HP);
    l.add(0, by, `BOSS  ${Math.max(0, Math.ceil(b.hp))}`, Math.max(18, Math.round(34 * d)), WHITE);
  }

  /** 曳光弹:橙拖尾(细长半透)+ 白弹芯(短亮,压在拖尾顶端)。每条弹道一条弹流。 */
  private drawBullets(game: Game): void {
    const q = this.bulletQ; q.begin();
    const { bulletSize, bulletTrailK } = this.tuning;
    const trailCol = game.buffMul > 1 ? BUFF_COLOR : BULLET_TRAIL;   // buff 期拖尾变色,是那 5 秒的即时反馈
    const trail = this.a(trailCol, 179);
    for (const b of game.bullets) {
      const rel = b.z - game.z;
      if (rel > FAR || rel < -2) continue;
      const d = this.dOf(rel);
      const px = this.xOf(b.x, d);
      const gy = this.yOf(d);
      const s = Math.max(4, bulletSize * d);
      const len = s * bulletTrailK;
      q.add(px, gy + len / 2, s * 0.34, len, trail);            // 拖尾:细、长、半透,从膛口往前
      q.add(px, gy + len * 0.75, s * 0.62, len * 0.5, BULLET);  // 弹芯:短、亮,在拖尾顶端
    }
    q.end();
  }

  /** 大军:按黄金角圆盘布点、池化到 nRender;撞击推挤 + 弹簧回位;描边让密集队形读成「一群」而非「一坨」。 */
  private drawArmy(game: Game, dt: number): void {
    const q = this.armyQ; q.begin();
    const n = game.stats.N;
    if (n <= 0) { q.end(); return; }
    const t = this.tuning;
    const shown = Math.min(n, t.nRender);
    // 半径封顶:R 按 √N 无限长,画出来的却始终 nRender 个 —— 不封顶兵越多反而越稀还溢出赛道。多的兵改由 over 放大个头体现。
    const R = Math.min(t.formationRadiusK * Math.sqrt(n), t.formationRadiusMax);
    const over = n > t.nRender ? 1 + Math.log10(n / t.nRender) * 0.3 : 1;
    const blink = game.shieldT > 0 && Math.floor(game.time * 12) % 2 === 0;
    const boost = game.boostT > 0;
    const body = blink ? GARLIC_BLINK : boost ? GARLIC_BOOST : GARLIC;
    const dark = blink ? GARLIC_BLINK_D : boost ? GARLIC_BOOST_D : GARLIC_DARK;

    const slots: { x: number; rel: number; i: number }[] = [];
    for (let i = 0; i < shown; i++) {
      const sl = unitFormationSlot(i, shown);
      const x = game.centerX + sl.x * R;
      const u = this.units[i] || (this.units[i] = { ox: 0, oz: 0, vx: 0, vz: 0 });
      let w = 0, dir = 1;
      for (const hx of this.impacts) {                         // 只吃最近那一下,逐个叠加会把兵顶飞
        const dd = Math.abs(x - hx);
        if (dd < KICK_R && KICK * (1 - dd / KICK_R) > w) { w = KICK * (1 - dd / KICK_R); dir = x >= hx ? 1 : -1; }
      }
      if (w) { u.vx += w * dir; u.vz -= w; }                   // 让开 + 后退
      u.vx -= (u.ox * SPRING + u.vx * DAMP) * dt;              // 弹簧拉回,阻尼收余震
      u.vz -= (u.oz * SPRING + u.vz * DAMP) * dt;
      u.ox += u.vx * dt; u.oz += u.vz * dt;
      slots.push({ x: x + u.ox, rel: 1.2 + sl.z * R * t.formationDepthK + u.oz, i });
    }
    slots.sort((a, b) => b.rel - a.rel);
    const outline = Math.max(1.5, t.unitSize * over * 0.05);
    for (const sl of slots) {
      const d = this.dOf(sl.rel);
      const size = t.unitSize * d * over;
      const px = this.xOf(sl.x, d);
      const gy = this.yOf(d) + Math.sin(game.time * 10 + sl.i) * size * 0.06;   // 呼吸微跳
      q.add(px, gy + size / 2, size + outline * 2, size + outline * 2, INK);    // 描边(压在身后)
      q.add(px, gy + size / 2, size, size, body);
      q.add(px, gy + size * 0.15, size, size * 0.3, dark);                      // 暗底
      q.add(px, gy + size * 0.62, size * 0.16, size * 0.12, MOUTH);             // 嘴
    }
    q.end();
  }

  /** 中心标:判定只看大军中心,而队形铺开十几单位宽 —— 有障碍 / 桶逼近时把那条线标出来,擦身才学得到。 */
  private drawPip(game: Game): void {
    const q = this.pipQ; q.begin();
    if (this.aimPip) {
      const d = this.dOf(5.5);
      const px = this.xOf(game.centerX, d);
      const py = this.yOf(d);
      const s = Math.max(7, 34 * d);
      const o = q.add(px, py, s * 1.2, s * 1.2, INK); o.node.angle = 45;        // 菱形:小旗标
      const w = q.add(px, py, s * 0.9, s * 0.9, WHITE); w.node.angle = 45;
    }
    q.end();
  }

  private drawEffects(dt: number): void {
    const q = this.fxQ; q.begin();
    for (const f of this.fx) {
      f.t += dt;
      const k = f.t / f.life;
      const d = this.dOf(f.rel);
      const px = this.xOf(f.x, d);
      const py = this.yOf(d);
      const alpha = Math.round(Math.max(0, 1 - k) * 255);
      if (f.kind === 'hit') {
        // 十字火星:同样大小比方块更像「打上去了」,两条细长条也比画圆便宜
        const s = this.tuning.bulletSize * d * (1 + k * 1.4), w = s * 0.22;
        q.add(px, py, s, w, this.a(HIT, alpha));
        q.add(px, py, w, s, this.a(HIT, alpha));
      } else {
        const s = (f.type === 'boss' ? 90 : f.type === 'wave' ? 62 : f.type === 'barrel' ? 28 : 46) * d * (1 + k * 1.6);
        const base = f.color || (f.type === 'thick' ? FX_THICK : f.type === 'wave' ? FX_WAVE : f.type === 'obstacle' ? SPIKE : FX_DEFAULT);
        q.add(px, py, s, s, this.a(base, alpha));
      }
    }
    for (let i = this.fx.length - 1; i >= 0; i--) if (this.fx[i].t >= this.fx[i].life) this.fx.splice(i, 1);
    q.end();
  }

  /** 冲击波 Graphics:首次真要画时才建组件(见字段声明处的时序说明)。 */
  private get waveG(): Graphics {
    if (!this._waveG) this._waveG = this.waveGNode!.addComponent(Graphics);
    return this._waveG;
  }

  /** 突破冲击波:贴地扩散环,以闸门位置为圆心沿赛道铺开(逻辑范围就是 core 的 breakWaveRange)。 */
  private drawWaves(game: Game, dt: number): void {
    if (!this.waves.length && !this._waveG) return;   // 没冲击波、也从没建过 Graphics → 不碰它,连组件都不建
    const g = this.waveG;
    g.clear();
    for (let i = this.waves.length - 1; i >= 0; i--) {
      const wv = this.waves[i];
      wv.t += dt;
      if (wv.t >= wv.life) { this.waves.splice(i, 1); continue; }
      const k = wv.t / wv.life;
      const R = wv.range * k;
      const rel0 = wv.z - game.z;
      const fade = Math.max(0, 1 - k);
      // 路面是浅灰的,金色环糊在背景里 —— 橙红外焰 + 白芯 + 金内环才压得住
      this.ring(g, R, rel0, Math.max(6, 46 * (1 - k)), this.a(WAVE_OUTER, Math.round(fade * 0.55 * 255)));
      this.ring(g, R, rel0, Math.max(3, 18 * (1 - k)), this.a(WHITE, Math.round(fade * 255)));
      this.ring(g, R * 0.55, rel0, Math.max(2, 10 * (1 - k)), this.a(WAVE_MID, Math.round(fade * 0.45 * 255)));
    }
  }

  private ring(g: Graphics, rad: number, rel0: number, width: number, color: Color): void {
    g.lineWidth = width;
    g.strokeColor = color;
    for (let i = 0; i <= 28; i++) {
      const a = (i / 28) * Math.PI * 2;
      const rel = rel0 + Math.cos(a) * rad;
      const d = this.dOf(rel);
      const x = this.xOf(Math.sin(a) * rad, d);
      const y = this.yOf(d);
      if (i === 0) g.moveTo(x, y); else g.lineTo(x, y);
    }
    g.stroke();
  }

  private drawFloats(dt: number): void {
    const l = this.floatL; l.begin();
    for (const f of this.floats) {
      f.t += dt;
      const k = f.t / f.life;
      const d = this.dOf(f.rel);
      const px = this.xOf(f.x, d);
      const py = this.yOf(d) + 220 + k * 160;             // 边升边淡
      this.c.set(f.color); this.c.a = Math.round(Math.max(0, 1 - k) * 255);
      l.add(px, py, f.txt, 76, this.c);
    }
    for (let i = this.floats.length - 1; i >= 0; i--) if (this.floats[i].t >= this.floats[i].life) this.floats.splice(i, 1);
    l.end();
  }
}
