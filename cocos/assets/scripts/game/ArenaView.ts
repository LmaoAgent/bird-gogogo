// 局内表现层 —— 只读 Game 的字段并消费 events,不含任何玩法规则。
// 投影/布点参数照搬 prototype/src/render.js,保证手感一致。
//
// T5 起接入 P0 美术:资源规格一律以 art_delivery/p0/integration_manifest.json 为准
// (图集帧名、动画帧率/循环、九宫格 inset、pivot、集群扰动参数)。
// 图集只绑 .plist(交付说明明确警告不要同时绑 .json),九宫格 inset 写在图集 meta 里。
// 美术未就绪的这几帧只留天空底色 —— 加载失败时是有色底 + 一行报错,不是黑屏。

import {
  assetManager, BitmapFont, Color, ImageAsset, Label, Layers, Node, Rect,
  Sprite, SpriteAtlas, SpriteFrame, Texture2D, UITransform,
} from 'cc';
import { loadSubpackage } from './WxApi';
import { ObjectPool } from '../core/ObjectPool';
import { unitFormationSlot, clamp } from '../core/rules';
import type { Game } from '../core/game';
import type { GateEffect, Tuning, Wave } from '../defs/types';

// 设计分辨率与伪 3D 投影参数(《美术需求清单》§0;与 prototype/src/render.js 同值)
const DESIGN_W = 1080;
const DESIGN_H = 1920;
const FAR = 130;            // 最远可见纵深(单位/门/道具)
const NEAR = -18;           // 赛道近端(需铺满屏幕底部)
const GATE_NEAR = -5;       // 门穿过大军后即剔除
const GATE_H = 5.2;         // 门高(世界单位)
const BIRD_SIZE = 1.05;     // 单兵直径(世界单位)
const HORIZON_Y = DESIGN_H * 0.30;
const ARMY_Y = DESIGN_H * 0.76;
const PERSP = 0.030;
const HALF_H = DESIGN_H / 2;

// 精灵帧四周留了透明边(蒜鸟实测主体只占 86%),按主体占比补偿绘制尺寸,
// 这样"世界单位尺寸"说的仍是看得见的那只鸟,集群密度才和原型一致。
const SPRITE_PAD = 1.16;

// 赛道:平铺贴图按"路面石板宽 == track.width"对齐世界坐标,
// 于是栏杆正好落在赛道边缘外侧、水面更外(实测石板占贴图宽 347/540)。
const TILE_ROAD_FRAC = 347 / 540;
const BAND_PX = 8;          // 赛道横带的屏幕高度,越小越贴合梯形轮廓、节点越多
const BG_COVER = 1.2;       // 远景超绘系数,兜住 FIT_HEIGHT 下比 1080 更宽的屏

// 集群扰动(manifest.cluster_rendering.variation):同一套精灵靠 tint/scale/相位做丰富度
const CLUSTER_SCALE = [0.92, 1.08];
const CLUSTER_TINT = 0.06;

// 门数字的高度(占门高比例)。门框九宫格压缩后,门洞落在 0.28~0.51,取其中点。
const GATE_TEXT_Y = 0.39;
const DIE_TRAIL = 6;        // 撞击时同时在播死亡帧的杂兵数
const PROP_STEP = 14;       // 氛围道具的纵向间距(世界单位)
const PROP_X = 9.0;         // 道具摆在栏杆线上(赛道半宽 8 之外)

const SKY = new Color(120, 200, 245, 255);   // 美术未就绪时的底色

/** 门的视觉分类(《美术需求清单》§4)：加成小额=蓝、大额=金、乘法=紫、陷阱=红黑 */
function gateKind(effect: GateEffect): number {
  if (effect.type === 'mul') return 2;
  if (effect.type === 'sub' || effect.type === 'div') return 3;
  return effect.value >= 20 ? 1 : 0;
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
const frac = (x: number): number => x - Math.floor(x);
/** 按单兵下标取稳定扰动值,同一只鸟每帧拿到的都一样。 */
const hash01 = (i: number): number => frac(Math.sin((i + 1) * 127.1) * 43758.5453);

/** 1×1 纯白贴图,美术就绪前的天空底色用它染色。 */
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
  // 运行时用 Uint8Array 造的贴图没有 HTMLImageElement 之类的图像源,
  // 若让它进动态图集,copyTexImagesToTexture 会以图像源重载去调 texSubImage2D 而抛异常,
  // 且是逐帧抛 —— 表现为除性能面板外什么都画不出来。
  frame.packable = false;
  return frame;
}

interface Slot {
  i: number;
  x: number;
  z: number;
  scale: number;    // 集群 scale 扰动
  tint: Color;      // 集群 tint 扰动
}

/** 原始资源句柄,加载齐了才一次性交给 onArtReady。 */
interface Raw {
  chars: SpriteAtlas;
  world: SpriteAtlas;
  bg: SpriteFrame;
  tile: Texture2D;
  fontBonus: BitmapFont;
  fontTrap: BitmapFont;
}

/** 逐帧要用的精灵帧全部在加载完成时解析好,避免每帧拼字符串查字典。 */
interface Art {
  tile: Texture2D;
  fontBonus: BitmapFont;
  fontTrap: BitmapFont;
  heroRun: SpriteFrame;
  heroCheer: SpriteFrame;
  heroPanic: SpriteFrame;
  moldFlow: SpriteFrame[];
  moldDie: SpriteFrame[];
  bossIdle: SpriteFrame;
  bossRoar: SpriteFrame;
  bossHit: SpriteFrame;
  bossPhase2: SpriteFrame;
  bossDie: SpriteFrame;
  gates: SpriteFrame[];      // 下标同 gateKind:蓝/金/紫/红黑
  props: SpriteFrame[];
}

/** 赛道的一条横带。屏幕位置和尺寸建好就不再变,逐帧只改采样到贴图哪一段。 */
interface Band {
  sprite: Sprite;
  frame: SpriteFrame;
  dzFar: number;
  dzNear: number;
}

export class ArenaView {
  private readonly tuning: Tuning;
  private readonly unit: number;
  private readonly solid = solidSpriteFrame();

  private art: Art | null = null;
  private readonly bands: Band[] = [];
  private readonly uv = new Rect();   // 逐帧复用,免得每条横带 new 一个
  private tileLenZ = 0;       // 一格平铺覆盖的世界纵深
  private tileWideZ = 0;      // 一格平铺覆盖的世界横宽(含栏杆与水面)

  private readonly world: Node;       // 震屏作用在这一层
  private readonly bg: Sprite;
  private readonly trackLayer: Node;
  private readonly propLayer: Node;
  private readonly gateLayer: Node;
  private readonly enemyLayer: Node;
  private readonly armyLayer: Node;
  private readonly hud: Node;

  private readonly lbLevel: Label;
  private readonly lbArmy: Label;
  private readonly lbWave: Label;
  private readonly lbResult: Label;

  private readonly propPool: ObjectPool<Node>;
  private readonly unitPool: ObjectPool<Node>;
  private readonly enemyPool: ObjectPool<Node>;
  private readonly gatePool: ObjectPool<Node>;
  private readonly props: Node[] = [];
  private readonly units: Node[] = [];
  private readonly enemies: Node[] = [];
  private readonly gates: Node[] = [];

  /** 队形槽位只取决于数量,按数量缓存,避免逐帧重算 + 逐帧重排渲染顺序。 */
  private readonly slotCache = new Map<number, Slot[]>();

  private time = 0;
  private nPop = 0;
  private shake = 0;
  private roarLeft = 0;       // BOSS 登场吼叫剩余时长
  private hitLeft = 0;        // BOSS 受击顿帧剩余时长
  private dieLeft = 0;        // BOSS 最后一阶段被打穿后的倒地剩余时长
  private dieZ = 0;
  private seenBoss: Wave | null = null;
  private readonly p = { x: 0, y: 0, s: 1 };

  constructor(root: Node, tuning: Tuning) {
    this.tuning = tuning;
    this.unit = (DESIGN_W * 0.90) / tuning.track.width;

    this.world = this.child(root, 'World');
    this.bg = this.child(this.world, 'Bg').addComponent(Sprite);
    this.bg.spriteFrame = this.solid;
    this.bg.sizeMode = Sprite.SizeMode.CUSTOM;
    this.bg.color = SKY;
    this.bg.getComponent(UITransform).setContentSize(DESIGN_W * BG_COVER, DESIGN_H * BG_COVER);
    this.trackLayer = this.child(this.world, 'Track');
    this.propLayer = this.child(this.world, 'Props');
    this.enemyLayer = this.child(this.world, 'Enemies');
    this.gateLayer = this.child(this.world, 'Gates');
    this.armyLayer = this.child(this.world, 'Army');
    this.hud = this.child(root, 'Hud');

    this.lbLevel = this.label(this.hud, 'Level', 44, 0, HALF_H - 116);
    this.lbWave = this.label(this.hud, 'Wave', 34, 0, HALF_H - 250);
    this.lbArmy = this.label(this.hud, 'Army', 120, 0, HALF_H - ARMY_Y + 340);
    this.lbResult = this.label(this.hud, 'Result', 60, 0, 0);
    this.lbResult.node.active = false;

    this.propPool = new ObjectPool<Node>(
      () => this.makeSprite(this.propLayer, 0.5, 0.08),
      (n) => { n.active = true; },
      (n) => { n.active = false; },
    );
    // 不预热:ObjectPool 的 prewarm 参数会把 create() 的产物直接塞进空闲表、不经过 onPut,
    // 节点停在 active=true,实测 n=10 时仍有 nRender 个节点参与渲染遍历。
    // 池本身按需增长且 get/put 全程维护 active,省掉预热即可保证「在用数 == 当前兵力」。
    this.unitPool = new ObjectPool<Node>(
      () => this.makeSprite(this.armyLayer, 0.5, 0.08),
      (n) => { n.active = true; },
      (n) => { n.active = false; },
    );
    this.enemyPool = new ObjectPool<Node>(
      () => this.makeSprite(this.enemyLayer, 0.5, 0.08),
      (n) => { n.active = true; },
      (n) => { n.active = false; },
    );
    this.gatePool = new ObjectPool<Node>(
      () => this.makeGate(),
      (n) => { n.active = true; },
      (n) => { n.active = false; },
    );

    this.loadArt();
  }

  // —— 美术加载(异步,构造函数不阻塞) ——

  private loadArt(): void {
    const raw: Partial<Raw> = {};
    let left = 6;
    const got = <K extends keyof Raw>(key: K) => (err: Error | null, asset: Raw[K]): void => {
      if (err) { console.error('[ArenaView] 美术资源加载失败', key, err); return; }
      raw[key] = asset;
      if (--left === 0) this.onArtReady(raw as Raw);
    };
    // T8:美术整体搬出 resources 成了独立 bundle,微信下再声明成分包
    // (build-templates/wechatgame/game.json),否则 2.67 MiB 的图集顶在主包里必超 4MB。
    // 分包要现下,到得比 P0 更晚 —— 但 onArtReady 之前本来就是纯色占位,这条链路没变。
    loadSubpackage('art', () => {
      assetManager.loadBundle('art', (err, bundle) => {
        if (err) { console.error('[ArenaView] art bundle 加载失败', err); return; }
        bundle.load('atlases/p0_characters_atlas', SpriteAtlas, got('chars'));
        bundle.load('atlases/p0_world_atlas', SpriteAtlas, got('world'));
        bundle.load('scene/scene_marketbridge_background_runtime_01/spriteFrame', SpriteFrame, got('bg'));
        bundle.load('scene/scene_marketbridge_track_tile_runtime_01/texture', Texture2D, got('tile'));
        bundle.load('fonts/font_gate_bonus_01', BitmapFont, got('fontBonus'));
        bundle.load('fonts/font_gate_trap_01', BitmapFont, got('fontTrap'));
      });
    });
  }

  private onArtReady(raw: Raw): void {
    const c = (n: string): SpriteFrame => raw.chars.getSpriteFrame(n);
    const w = (n: string): SpriteFrame => raw.world.getSpriteFrame(n);
    const seq = (get: (n: string) => SpriteFrame, stem: string, count: number): SpriteFrame[] => {
      const out: SpriteFrame[] = [];
      for (let i = 1; i <= count; i++) out.push(get(`${stem}_0${i}`));
      return out;
    };

    this.art = {
      tile: raw.tile,
      fontBonus: raw.fontBonus,
      fontTrap: raw.fontTrap,
      heroRun: c('hero_garlicbird_run_01'),
      heroCheer: c('hero_garlicbird_cheer_01'),
      heroPanic: c('hero_garlicbird_panic_01'),
      moldFlow: seq(c, 'enemy_moldling_flow', 4),
      moldDie: seq(c, 'enemy_moldling_die', 4),
      bossIdle: c('boss_rotgarlic_idle_01'),
      bossRoar: c('boss_rotgarlic_roar_01'),
      bossHit: c('boss_rotgarlic_hit_01'),
      bossPhase2: c('boss_rotgarlic_phase2_01'),
      bossDie: c('boss_rotgarlic_die_01'),
      gates: [
        w('gate_bonus_blue_base_01'),
        w('gate_reward_gold_base_01'),
        w('gate_multiplier_purple_base_01'),
        w('gate_trap_red_base_01'),
      ],
      props: [
        w('scene_prop_marketlamp_base_01'),
        w('scene_prop_garlicstring_base_01'),
        w('scene_prop_vegetablecrate_base_01'),
        w('scene_prop_pennant_base_01'),
        w('scene_prop_garlicbasket_base_01'),
        w('scene_prop_picklejar_base_01'),
      ],
    };

    // 平铺贴图的世界尺度:让路面石板宽正好等于 track.width
    this.tileWideZ = this.tuning.track.width / TILE_ROAD_FRAC;
    this.tileLenZ = this.tileWideZ * (raw.tile.height / raw.tile.width);

    this.bg.spriteFrame = raw.bg;
    this.bg.color = Color.WHITE;
    const cover = Math.max(
      (DESIGN_W * BG_COVER) / raw.bg.rect.width,
      (DESIGN_H * BG_COVER) / raw.bg.rect.height,
    );
    this.bg.getComponent(UITransform).setContentSize(
      raw.bg.rect.width * cover, raw.bg.rect.height * cover,
    );

    this.buildTrack();
  }

  /**
   * 赛道横带一次建好。半宽对屏幕 Y 是线性的(s 同时线性决定 y 与半宽),
   * 所以按屏幕 Y 等分就能让每条横带的轮廓误差一样小 —— 按世界 Z 等分则近处会摊到
   * 七八十像素一条,梯形边缘直接锯成台阶。等分后位置与尺寸恒定,逐帧只改 UV。
   */
  private buildTrack(): void {
    const tex = this.art.tile;
    const sAt = (y: number): number => (HALF_H - HORIZON_Y - y) / (ARMY_Y - HORIZON_Y);
    const dzAt = (y: number): number => (1 / sAt(y) - 1) / PERSP;
    const yTop = HALF_H - HORIZON_Y - 1;    // 贴着地平线起铺(再高 s→0,宽度收成 0)
    const yBot = -HALF_H - 40;              // 铺到屏幕底沿以下,不留缝

    for (let y = yTop; y > yBot; y -= BAND_PX) {
      const yA = y;                          // 远端(上沿)
      const yB = Math.max(y - BAND_PX, yBot); // 近端(下沿)
      const node = this.makeSprite(this.trackLayer, 0.5, 0);
      const frame = new SpriteFrame();
      frame.texture = tex;
      frame.packable = false;   // 逐帧改 rect 的帧一旦进动态图集,rect 会被打包结果覆写
      frame.rect = new Rect(0, 0, tex.width, 1);
      const sprite = node.getComponent(Sprite);
      sprite.spriteFrame = frame;
      node.setPosition(0, yB, 0);
      // 半宽线性,取中点即取这条带的平均宽度;高度多给 1px,免得相邻横带间漏出背景
      node.getComponent(UITransform).setContentSize(
        this.tileWideZ * sAt((yA + yB) / 2) * this.unit, yA - yB + 1,
      );
      this.bands.push({ sprite, frame, dzFar: dzAt(yA), dzNear: dzAt(yB) });
    }
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

  /** 自定尺寸的精灵节点;pivot 取 manifest.pivots(角色贴地留 8% 余量,门与横带贴地)。 */
  private makeSprite(parent: Node, ax: number, ay: number): Node {
    const n = this.child(parent, 'S');
    n.getComponent(UITransform).setAnchorPoint(ax, ay);
    const sp = n.addComponent(Sprite);
    sp.sizeMode = Sprite.SizeMode.CUSTOM;
    sp.type = Sprite.Type.SIMPLE;
    return n;
  }

  private makeGate(): Node {
    const n = this.makeSprite(this.gateLayer, 0.5, 0);
    n.getComponent(Sprite).type = Sprite.Type.SLICED;   // 九宫格 inset 来自图集 meta
    const tag = this.child(n, 'Tag');
    const lb = tag.addComponent(Label);
    lb.useSystemFont = false;
    lb.cacheMode = Label.CacheMode.NONE;
    lb.horizontalAlign = Label.HorizontalAlign.CENTER;
    lb.verticalAlign = Label.VerticalAlign.CENTER;
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
      // 扰动按下标取,和数量无关 —— 同一只鸟在任何兵力下都是同一种胖瘦深浅。
      // 幅度压在 ±6% 以内且只做减法,避免超 255 被截断成一片死白。
      const warm = (hash01(i + 977) - 0.5) * 2 * CLUSTER_TINT;
      const dim = 1 - hash01(i + 331) * CLUSTER_TINT;
      slots.push({
        i,
        x: s.x,
        z: s.z,
        scale: lerp(CLUSTER_SCALE[0], CLUSTER_SCALE[1], hash01(i)),
        tint: new Color(
          255 * dim * (1 - Math.max(0, -warm)),
          255 * dim * (1 - Math.abs(warm) * 0.4),
          255 * dim * (1 - Math.max(0, warm)),
          255,
        ),
      });
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
    while (this.props.length) this.propPool.put(this.props.pop());
    this.lbResult.node.active = false;
    this.nPop = 0;
    this.shake = 0;
    this.roarLeft = 0;
    this.hitLeft = 0;
    this.dieLeft = 0;
    this.seenBoss = null;
    this.world.setPosition(0, 0, 0);
  }

  /** 消费本帧事件,驱动打击感(§8 手感参数)。 */
  consume(game: Game): void {
    for (const e of game.events) {
      if (e.kind === 'gate') this.nPop = 1;
      else if (e.kind === 'smashStart') {
        this.shake = this.tuning.fx.smashShakeAmp;
        if (e.smash.wave.isBoss) this.hitLeft = this.tuning.fx.bossHitStop;
      } else if (e.kind === 'smashEnd') {
        const w = e.smash.wave;
        // 最后一阶段被打穿 → 播倒地。波次随后就出队了,位置得自己记下来。
        if (w.isBoss && e.smash.breakthrough && w.phase === w.phaseCount) {
          this.dieLeft = 0.6;
          this.dieZ = w.posZ;
        }
      }
    }
  }

  draw(game: Game, dt: number): void {
    this.time += dt;
    this.nPop = Math.max(0, this.nPop - dt * 4);
    this.shake = Math.max(0, this.shake - dt * (this.tuning.fx.smashShakeAmp / this.tuning.fx.smashShakeDuration));
    this.roarLeft = Math.max(0, this.roarLeft - dt);
    this.hitLeft = Math.max(0, this.hitLeft - dt);
    this.dieLeft = Math.max(0, this.dieLeft - dt);
    this.world.setPosition(
      this.shake > 0 ? (Math.random() - 0.5) * this.shake * 2 : 0,
      this.shake > 0 ? (Math.random() - 0.5) * this.shake * 2 : 0,
      0,
    );

    if (!this.art) return;   // 美术未就绪:只留天空底色
    this.syncTrack(game);
    this.syncProps(game);
    this.syncGates(game);
    this.syncEnemies(game);
    this.syncArmy(game);
    this.drawHud(game);
  }

  /**
   * 赛道滚动:横带的屏幕位置固定,逐帧只把它采样的贴图段往回挪 —— 越近的带挪得越快,
   * 透视感就是这么来的。贴图是 NPOT,WebGL1 下 REPEAT 会被静默降成 CLAMP,
   * 所以 UV 一律夹在 [0,1] 内:横跨平铺接缝的那几条(视野里同时最多五六条)
   * 退让不到一条带的贴图高度,而栏杆是竖直的、对 V 偏移不敏感,看不出来。
   */
  private syncTrack(game: Game): void {
    const L = this.tileLenZ;
    const tex = this.art.tile;
    const uv = this.uv;
    uv.x = 0;
    uv.width = tex.width;
    for (const b of this.bands) {
      const zFar = game.z + b.dzFar;
      const zNear = game.z + b.dzNear;
      // 地平线附近一条带能横跨好几格平铺,夹到一格为止(那里只有几像素高,糊成一片正好)
      const h = Math.min(tex.height, ((zFar - zNear) / L) * tex.height);
      uv.height = h;
      uv.y = clamp((1 - frac(zFar / L)) * tex.height, 0, tex.height - h);
      b.frame.rect = uv;
      b.sprite.markForUpdateRenderData();
    }
  }

  /** 氛围道具:沿栏杆左右交替摆放,跟着 z 滚。位置只由 z 决定,不随机。 */
  private syncProps(game: Game): void {
    let n = 0;
    const last = Math.floor((game.z + FAR) / PROP_STEP);
    const first = Math.ceil((game.z + NEAR) / PROP_STEP);
    for (let m = last; m >= first; m--) {          // 远 → 近,兄弟顺序即渲染顺序
      const p = this.project((m & 1 ? 1 : -1) * PROP_X, m * PROP_STEP - game.z);
      const size = 2.4 * p.s * this.unit;
      if (size < 4) continue;
      const node = this.props[n] || (this.props[n] = this.propPool.get());
      n++;
      node.setPosition(p.x, p.y, 0);
      node.getComponent(UITransform).setContentSize(size, size);
      node.getComponent(Sprite).spriteFrame = this.art.props[((m % 6) + 6) % 6];
    }
    while (this.props.length > n) this.propPool.put(this.props.pop());
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

    // 门框恒按 s=1 的尺寸建,透视缩放交给节点 scale。
    // 九宫格的边角是按贴图像素画的、不跟 contentSize 走,若改用 contentSize 表现透视,
    // 远处的小门会保留一整块原尺寸门楣、糊成一坨 —— 缩节点才能让边角一起变小。
    const track = this.tuning.track;
    const gw = track.gateHalfWidth * 2 * this.unit;
    const gh = GATE_H * this.unit;
    for (let i = 0; i < frames.length; i++) {
      const { effect, dz } = frames[i];
      const node = this.gates[i];
      const p = this.project(track.laneX[effect.side], dz);
      const s = p.s;

      if (gh * s <= 2) { node.active = false; continue; }
      node.active = true;
      node.setPosition(p.x, p.y, 0);
      node.setScale(s, s, 1);
      node.getComponent(UITransform).setContentSize(gw, gh);
      node.getComponent(Sprite).spriteFrame = this.art.gates[gateKind(effect)];

      const tag = node.getChildByName('Tag');
      const lb = tag.getComponent(Label);
      const text = gateLabel(effect);
      // 加成/乘法用绿白 bonus,扣减/除法用红 trap
      lb.font = effect.type === 'sub' || effect.type === 'div' ? this.art.fontTrap : this.art.fontBonus;
      lb.string = text;
      // 数字压着门柱内沿排,长数字自动变小(位图字体 xadvance/size = 1.27)
      const fs = Math.min(96, (gw * 0.85) / Math.max(1, text.length * 1.27));
      lb.fontSize = fs;
      lb.lineHeight = fs * 1.1;
      tag.setPosition(0, gh * GATE_TEXT_Y, 0);
    }
  }

  private syncEnemies(game: Game): void {
    const wave = game.currentWave;

    // 波次已出队但倒地还没放完:BOSS 单独续画一会儿
    if (this.dieLeft > 0 && (!wave || !wave.isBoss)) {
      this.resize(this.enemies, this.enemyPool, 1);
      this.drawBoss(this.enemies[0], this.dieZ - game.z, this.art.bossDie);
      return;
    }

    const dz = wave ? wave.posZ - game.z : 0;
    if (!wave || dz > FAR || dz < NEAR) { this.resize(this.enemies, this.enemyPool, 0); return; }

    const smashing = game.state === 'smashing' && game.smash.wave === wave;
    const ratio = smashing ? lerp(1, game.smash.hAfter / game.smash.hBefore, game.smash.progress) : 1;

    if (wave.isBoss) {
      if (this.seenBoss !== wave) { this.seenBoss = wave; this.roarLeft = 1.0; }
      this.resize(this.enemies, this.enemyPool, 1);
      this.drawBoss(this.enemies[0], dz, this.bossPose(wave, smashing));
      return;
    }

    const total = clamp(Math.round(wave.H / 14), 6, 40);
    const alive = Math.max(1, Math.round(total * ratio));
    const R = 0.75 * Math.sqrt(total);
    const slots = this.slotsFor(total);
    // 刚被打掉的几只接着播死亡帧(4 帧 12fps),再往前的直接剔除
    const dying = smashing ? Math.min(DIE_TRAIL, total - alive) : 0;
    this.resize(this.enemies, this.enemyPool, alive + dying);

    for (let i = 0; i < alive + dying; i++) {
      const slot = slots[i];
      const p = this.project(slot.x * R, dz + slot.z * R);
      const size = 1.25 * SPRITE_PAD * p.s * this.unit;
      const node = this.enemies[i];
      node.setPosition(p.x, p.y + Math.sin(this.time * 8 + slot.i) * size * 0.05, 0);
      node.getComponent(UITransform).setContentSize(size, size);
      node.getComponent(Sprite).spriteFrame = i < alive
        ? this.art.moldFlow[Math.floor(this.time * 8 + slot.i * 0.37) & 3]
        : this.art.moldDie[Math.min(3, Math.floor(((i - alive) * 4) / DIE_TRAIL))];
    }
  }

  /** BOSS 五姿态(manifest 的 boss_rotgarlic_*):受击 > 登场吼 > phase2 狂暴 > 待机。 */
  private bossPose(wave: Wave, smashing: boolean): SpriteFrame {
    if (smashing && this.hitLeft > 0) return this.art.bossHit;
    if (this.roarLeft > 0) return this.art.bossRoar;
    return (wave.phase || 1) >= 2 ? this.art.bossPhase2 : this.art.bossIdle;
  }

  private drawBoss(node: Node, dz: number, frame: SpriteFrame): void {
    const p = this.project(0, dz);
    const size = 6.5 * p.s * this.unit;
    node.setPosition(p.x, p.y, 0);
    node.getComponent(UITransform).setContentSize(size, size);
    node.getComponent(Sprite).spriteFrame = frame;
  }

  private syncArmy(game: Game): void {
    const t = this.tuning;
    const shown = Math.min(game.n, t.nRender);
    this.resize(this.units, this.unitPool, Math.max(0, shown));
    if (shown <= 0) return;

    // 通关欢呼 / 失败惊慌,其余时候一律跑步(P0 是静态关键帧,动感靠位移与相位错开)
    const frame = game.state === 'win' ? this.art.heroCheer
      : game.state === 'fail' ? this.art.heroPanic
        : this.art.heroRun;

    // 超出 N_render 的部分用整体放大表现"更多"(§2)
    const overflow = game.n > t.nRender ? 1 + Math.log10(game.n / t.nRender) * 0.28 : 1;
    const R = t.formationRadiusK * Math.sqrt(game.n);
    const hw = t.track.width / 2 - BIRD_SIZE / 2;
    const slots = this.slotsFor(shown);

    for (let i = 0; i < shown; i++) {
      const slot = slots[i];
      const wx = clamp(game.centerX + slot.x * R, -hw, hw);
      const p = this.project(wx, slot.z * R);
      const size = BIRD_SIZE * SPRITE_PAD * slot.scale * overflow * p.s * this.unit;
      const node = this.units[i];
      node.setPosition(p.x, p.y + Math.sin(this.time * 12 + slot.i * 0.7) * size * 0.06, 0);
      node.getComponent(UITransform).setContentSize(size, size);
      const sp = node.getComponent(Sprite);
      sp.spriteFrame = frame;
      sp.color = slot.tint;
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
