// v2 表现层 —— 只读 Game 字段 + 消费 events,不含任何玩法规则。
// 伪 3D 投影沿用 v1 render.js 的做法(手感一致);配色按《v2》§0「明亮大胆降 CPI」。

import { unitFormationSlot, isBuff, rewardLabel } from './core/rules.js';

export const W = 1080, H = 1920;

const SKY = '#7ACCF5';
const GROUND = '#2E6B7A';
const ROAD = '#C9D6D0';
const ROAD_LINE = '#DCE6E1';
const GARLIC = '#F5F0E6';
const GARLIC_DARK = '#D8CDB6';
const MOLD = '#5E8C2B';
const MOLD_DARK = '#3C5C1B';
const THICK = '#7A5C2B';
const BULLET = '#FFFFFF';
const BULLET_TRAIL = '#FF9A2E';
const HIT = '#FFF3B0';
const INK = '#2B2420';

// 维度配色(《v2》§4)
const DIM_COLOR = { N: '#3E8FE0', L: '#9B5DE5', R: '#F49D1A', D: '#E5484D' };
const TRAP_COLOR = '#3A2B2B';

// 障碍配色(§V4):门是"要不要走进去",障碍是"必须走开",两者不能长得像 ——
// 门是半透高框 + 维度字,障碍是实心低矮的红尖刺 / 黄黑滚筒,零文字。
const SPIKE = '#FF3B30';
const SPIKE_DARK = '#7A1418';
const ROLLER = '#F5C518';

// 油桶配色(§V5):障碍是威胁、油桶是奖励,一眼要分得开(《美术需求清单v2补充》§5 点名的要求)。
// 「是不是该打」沿用这一版立住的语法:**有血条的是打的,没血条的是躲的**(闸门有,障碍没有)。
//
// 桶体固定走铁锈橙,**不跟着奖励维度换色**:第一版把箍带涂成维度色,结果 N 桶站在 N+5 门墙里
// 就是一根蓝条混在一片蓝框中间,教学关的新东西反而最看不见。现在分工是 ——
// 锈色桶身负责"这是个桶"(全场唯一的暖色实心筒),中间那道维度色宽带 + 上方标签负责"它给什么"。
const BARREL_BODY = '#C4643A';
const BARREL_BODY_D = '#8F4526';
const BARREL_CAP = '#DE8B5E';
const BARREL_HOOP = '#5A3520';
const BUFF_COLOR = '#FF66C4';   // 限时 buff 没有维度,单给一个别处没用过的品红

const rewardColor = (r) => (r.buff ? BUFF_COLOR : DIM_COLOR[r.dim]);

// 撞击推挤(纯表现):怪撞进大军时把附近的兵顶开,弹簧拉回原位
const KICK = 7, KICK_R = 2.6, SPRING = 120, DAMP = 13;

const FAIL_TEXT = { boss: 'BOSS 压垮了你', obstacle: '撞上障碍全灭' };

const HORIZON_Y = H * 0.30;
const ARMY_Y = H * 0.78;
const PERSP = 0.030;
export const X_SCALE = 46;   // 世界 1 单位 = 近处 46 设计像素(输入换算也用它)

export const BTN = { x: W / 2 - 260, y: H * 0.62, w: 520, h: 150 };

/** 世界(x, 相对纵深 rel) → 屏幕。rel<0 表示在大军身后。 */
function proj(x, rel) {
  const d = 1 / (1 + Math.max(rel, -12) * PERSP);
  return { sx: W / 2 + x * X_SCALE * d, sy: HORIZON_Y + (ARMY_Y - HORIZON_Y) * d, d };
}

export class Renderer {
  constructor(canvas, tuning) {
    this.ctx = canvas.getContext('2d');
    this.tuning = tuning;
    this.fx = [];        // 击杀/穿门的一次性特效
    this.floats = [];    // 飘字
    this.waves = [];     // 突破冲击波的扩散环
    this.impacts = [];   // 本帧撞进大军的怪的 x,给 #army 做推挤
    this.units = [];     // 大军每个位置的推挤偏移(ox/oz + 速度)
    this.zsort = [];     // 怪的绘制序,复用免得 300 只时每帧新建数组
    this.shake = 0;
    this.aimPip = false; // 有障碍逼近时才画大军中心标(见 #aimPip)
    this.flash = 0;      // 全屏闪:掉兵红 / 突破金
    this.flashRGB = '229,72,77';
  }

  consume(game) {
    const waveKills = [];
    this.impacts.length = 0;
    for (const ev of game.events) {
      if (ev.xs) for (const x of ev.xs) this.impacts.push(x);   // 撞击点:leak / trample 都带
      if (ev.kind === 'kill') {
        if (ev.by === 'wave') { waveKills.push(ev); continue; }
        this.fx.push({ x: ev.x, rel: ev.z - game.z, t: 0, life: 0.25, kind: 'kill', type: ev.type });
      } else if (ev.kind === 'trample') {
        for (let i = 0; i < Math.min(ev.count, 6); i++) {
          this.fx.push({ x: ev.xs[i], rel: this.tuning.contactZ, t: 0, life: 0.3, kind: 'kill', type: 'wave' });
        }
      } else if (ev.kind === 'gate') {
        const e = ev.effect;
        const txt = `${e.dim}${e.op === 'mul' ? '×' : '+'}${e.value}`;
        this.floats.push({ x: 0, rel: 2, t: 0, life: 0.9, txt, color: isBuff(e) ? DIM_COLOR[e.dim] : TRAP_COLOR });
        this.shake = Math.max(this.shake, isBuff(e) ? 0.18 : 0.3);
      } else if (ev.kind === 'leak' && ev.loss) {
        // loss 为 0 的接触只推挤大军,不给红闪飘字 —— 那是"撞上了",还不是"死人了"
        this.flash = 0.35;
        this.flashRGB = '229,72,77';
        this.shake = Math.max(this.shake, 0.35);
        this.floats.push({ x: 0, rel: 1, t: 0, life: 0.8, txt: `-${ev.loss}`, color: '#E5484D' });
      } else if (ev.kind === 'obstacleHit') {
        // 撞障碍比漏怪疼(一下掉一成八),反馈也要比漏怪重一档,否则玩家学不会"该躲"
        this.flash = 0.55;
        this.flashRGB = '229,72,77';
        this.shake = Math.max(this.shake, 0.6);
        this.floats.push({ x: 0, rel: 1, t: 0, life: 0.9, txt: `-${ev.loss}`, color: '#E5484D' });
        for (let i = 0; i < 8; i++) {
          this.fx.push({ x: ev.x + (Math.random() * 2 - 1) * 2, rel: 1.5, t: 0, life: 0.4, kind: 'kill', type: 'obstacle' });
        }
      } else if (ev.kind === 'barrelBreak') {
        // 炸开要比穿门重、比撞障碍轻:它是玩家自己下注赢来的,得给足回报感,但不能盖过突破那一下。
        // 飘字画在大军头顶(x=0)而不是桶的位置 —— 奖励是落在自己身上的,不是留在原地的。
        const col = rewardColor(ev.reward);
        this.shake = Math.max(this.shake, 0.45);
        this.flash = 0.4;
        this.flashRGB = '255,236,170';
        // 桶总是在大军快贴上它的时候才打穿(交火窗口就是那 24 个纵深),所以碎片必然炸在脸前 ——
        // rel≈0 处透视不缩,一堆整尺寸方块会糊成一整块色板把大军盖掉。碎片要小、要散开纵深。
        const rel = ev.barrel.posZ - game.z;
        for (let i = 0; i < 14; i++) {
          this.fx.push({
            x: ev.barrel.x + (Math.random() * 2 - 1) * 1.8, rel: rel + (Math.random() * 2 - 1) * 2.5,
            t: 0, life: 0.45, kind: 'kill', type: 'barrel', color: col,
          });
        }
        this.floats.push({
          x: 0, rel: 2, t: 0, life: 1.0, color: col,
          txt: ev.reward.buff ? `${rewardLabel(ev.reward)} ${ev.sec}s` : rewardLabel(ev.reward),
        });
      } else if (ev.kind === 'barrierIn') {
        this.shake = 0.4;
      } else if (ev.kind === 'barrierDown') {
        // 门体碎裂的残片(冲击波本身由下面的 breakWave 画)
        for (let i = 0; i < 26; i++) {
          this.fx.push({ x: (Math.random() * 2 - 1) * 8, rel: ev.barrier.posZ - game.z, t: 0, life: 0.45, kind: 'kill', type: 'boss' });
        }
      } else if (ev.kind === 'breakWave') {
        // 扩散环 + 金闪 + 强震:素材里打穿闸门就是一片炸开,飘个字远远不够
        this.shake = 1.0;
        this.flash = 0.55;
        this.flashRGB = '255,236,170';
        this.waves.push({ z: ev.z, range: ev.range, t: 0, life: 0.5 });
        this.floats.push({ x: 0, rel: 2, t: 0, life: 0.8, txt: '突破!', color: '#E8B93A' });
      } else if (ev.kind === 'bossIn') {
        this.shake = 0.5;
      } else if (ev.kind === 'bossDown') {
        this.shake = 0.6;
        for (let i = 0; i < 18; i++) {
          this.fx.push({ x: (Math.random() * 2 - 1) * 5, rel: this.tuning.bossStandZ, t: 0, life: 0.5, kind: 'kill', type: 'boss' });
        }
      }
    }

    // 冲击波一击能扫倒上百只,逐只画特效会糊成一张白饼、把冲击环整个盖住。
    // 按《v2》§2.3「逻辑击杀与视觉击杀解耦」抽样播放:死多少只由 core 说了算,画几朵是表现层的事。
    const stride = Math.ceil(waveKills.length / this.tuning.maxWaveFx) || 1;
    for (let i = 0; i < waveKills.length; i += stride) {
      const ev = waveKills[i];
      this.fx.push({ x: ev.x, rel: ev.z - game.z, t: 0, life: 0.5, kind: 'kill', type: 'wave' });
    }

    // 命中闪光:原本只有"怪凭空消失",打闸门时更是几秒钟一点反馈都没有。
    // 射速拉高后一帧能命中十几发,全画会连成一张白饼 —— 同 maxWaveFx 的抽样口径,每帧只补 maxHitFx 朵。
    const hits = game.bulletHits;
    const hitStride = Math.ceil(hits.length / 2 / this.tuning.maxHitFx) || 1;
    for (let i = 0; i < hits.length; i += 2 * hitStride) {
      this.fx.push({ x: hits[i], rel: hits[i + 1] - game.z, t: 0, life: 0.13, kind: 'hit' });
    }
  }

  draw(game, dt) {
    const g = this.ctx;
    this.shake = Math.max(0, this.shake - dt * 2.2);
    this.flash = Math.max(0, this.flash - dt * 2.5);

    g.save();
    if (this.shake > 0) {
      const a = this.shake * 22;
      g.translate((Math.random() * 2 - 1) * a, (Math.random() * 2 - 1) * a);
    }

    this.#sky();
    this.#road(game);
    this.#obstacleGround(game);   // 危险带贴地,压在路面上、所有立体物之下
    this.#barrelGround(game);     // 对准带同层(它会读 #obstacleGround 写的 aimPip,顺序不能反)
    if (game.boostT > 0) this.#boostStreaks(game);
    this.#gates(game);
    this.#enemies(game);
    this.#obstacles(game);        // 本体压在怪群之上:被密怪埋住就谈不上"提前可见"
    this.#barrels(game);          // 同理:桶被怪埋住就等于没有
    if (game.barrier) this.#barrier(game);
    if (game.bossActive && game.boss) this.#boss(game);
    // 子弹画在大军之前:弹丸从队伍中间(rel 1.5)出膛,画在后面就有一半白弹体压在奶油色的兵身上,
    // 两者同色糊成一团。让兵挡住膛口,只有冲出队伍的那一截可见,才是"火力从人群里喷出来"。
    this.#bullets(game);
    this.#army(game, dt);
    this.#aimPip(game);
    this.#effects(dt);
    this.#waves(game, dt);   // 画在死亡特效之上,否则冲击环会被那片爆开的粒子埋掉
    g.restore();

    if (this.flash > 0) {
      g.fillStyle = `rgba(${this.flashRGB},${this.flash * 0.5})`;
      g.fillRect(0, 0, W, H);
    }
    this.#hud(game);
    if (game.state === 'win' || game.state === 'fail') this.#result(game);
  }

  #sky() {
    const g = this.ctx;
    g.fillStyle = SKY; g.fillRect(0, 0, W, HORIZON_Y);
    g.fillStyle = GROUND; g.fillRect(0, HORIZON_Y, W, H - HORIZON_Y);
  }

  #road(game) {
    const g = this.ctx;
    const half = this.tuning.track.width / 2;
    const near = proj(-half, -12), far = proj(-half, 70);
    const nearR = proj(half, -12), farR = proj(half, 70);
    g.fillStyle = ROAD;
    g.beginPath();
    g.moveTo(near.sx, near.sy); g.lineTo(far.sx, far.sy);
    g.lineTo(farR.sx, farR.sy); g.lineTo(nearR.sx, nearR.sy);
    g.closePath(); g.fill();

    // 横向条纹:给速度感
    g.fillStyle = ROAD_LINE;
    const step = 10;
    const off = game.z % step;
    for (let rel = -off; rel < 70; rel += step) {
      const a = proj(-half, rel), b = proj(half, rel);
      const h = Math.max(1.5, 9 * a.d);
      g.fillRect(a.sx, a.sy, b.sx - a.sx, h);
    }
  }

  #gates(game) {
    const g = this.ctx;
    const list = [];
    for (let i = game.gateIndex; i < game.gates.length; i++) {
      const gate = game.gates[i];
      const rel = gate.posZ - game.z;
      if (rel > 62) break;
      if (rel < -3) continue;
      list.push({ gate, rel });
    }
    for (const { gate, rel } of list.reverse()) {
      const opts = gate.type === 'pick' ? gate.options : [gate];
      for (const o of opts) this.#gateFrame(o, rel);
    }
  }

  #gateFrame(effect, rel) {
    const g = this.ctx;
    const x = this.tuning.track.laneX[effect.side];
    const hw = this.tuning.track.gateHalfWidth;
    const a = proj(x - hw, rel), b = proj(x + hw, rel);
    const top = a.sy - 185 * a.d;
    const buff = isBuff(effect);
    const col = buff ? DIM_COLOR[effect.dim] : TRAP_COLOR;

    g.globalAlpha = 0.30;
    g.fillStyle = col;
    g.fillRect(a.sx, top, b.sx - a.sx, a.sy - top);
    g.globalAlpha = 1;
    g.strokeStyle = col; g.lineWidth = Math.max(2, 8 * a.d);
    g.strokeRect(a.sx, top, b.sx - a.sx, a.sy - top);

    const fs = Math.max(14, 78 * a.d);
    g.font = `900 ${fs}px system-ui, sans-serif`;
    g.textAlign = 'center'; g.textBaseline = 'middle';
    const label = `${effect.dim}${effect.op === 'mul' ? '×' : '+'}${effect.value}`;
    g.lineWidth = Math.max(2, fs * 0.14); g.strokeStyle = INK;
    g.strokeText(label, (a.sx + b.sx) / 2, top + (a.sy - top) * 0.45);
    g.fillStyle = '#FFF';
    g.fillText(label, (a.sx + b.sx) / 2, top + (a.sy - top) * 0.45);
  }

  /**
   * 障碍的地面预告 —— "提前可见"落在这一层。
   * 画的是**真实命中区**(本体半宽 + obstacleHitHalfW),不是本体轮廓:玩家要对齐的是判定线,
   * 让他去目测尖刺牙尖到哪是耍赖。
   * roller 画两条:淡的是整条巡逻范围(告诉你这一段归它管),亮的是**此刻**的命中区、跟着滚筒走。
   * 只画巡逻范围不行 —— amp 一大就铺满整条路,等于说"哪都危险",反而没了信息(验收②要的是可预判)。
   * 呼吸式透明度是为了在浅灰路面上跳出来:静态色块会被路面横纹吃掉。
   */
  /** 贴地的判定区色带(危险带 / 对准带共用)。画的永远是判定宽度,不是本体轮廓。 */
  #band(x, half, rel, alpha, color) {
    const g = this.ctx;
    const lim = this.tuning.track.width / 2;
    const x0 = Math.max(x - half, -lim), x1 = Math.min(x + half, lim);   // 不画到路面外
    const n0 = proj(x0, rel - 2), n1 = proj(x1, rel - 2);
    const f0 = proj(x0, rel + 2), f1 = proj(x1, rel + 2);
    g.globalAlpha = alpha;
    g.fillStyle = color;
    g.beginPath();
    g.moveTo(n0.sx, n0.sy); g.lineTo(f0.sx, f0.sy); g.lineTo(f1.sx, f1.sy); g.lineTo(n1.sx, n1.sy);
    g.closePath(); g.fill();
    g.globalAlpha = 1;
  }

  #obstacleGround(game) {
    const pulse = 0.22 + 0.1 * Math.sin(game.time * 6);
    let near = Infinity;
    for (const o of game.obstacles) {
      const rel = o.posZ - game.z;
      if (rel > 62) break;
      if (rel < -3) continue;
      if (rel >= 0) near = Math.min(near, rel);
      const half = o.width / 2 + this.tuning.obstacleHitHalfW;
      if (o.type === 'roller') {
        this.#band(o.x, half + (o.amp ?? this.tuning.rollerAmp), rel, 0.1, ROLLER);
        this.#band(o.cx, half, rel, pulse, ROLLER);
      } else {
        this.#band(o.x, half, rel, pulse, SPIKE);
      }
    }

    this.aimPip = near <= 34;
  }

  /**
   * 油桶的地面对准带 —— 与障碍危险带同一套语法,只是意思相反:那个是"别站这",这个是"站这才打得到"。
   * 画的同样是**判定宽度**(barrelAimHalfW),不是桶的轮廓 —— 桶画得比判定窄一圈,
   * 玩家能看出自己有多少余量,而不是去目测桶壁贴没贴上(V4 那条教训对反过来的机制一样成立)。
   *
   * 进入射程(barrelRangeZ)才点亮:桶老远就看得见,但"现在打得到"是另一件事,
   * 不区分的话玩家会在射程外白白站过去。
   */
  #barrelGround(game) {
    const pulse = 0.34 + 0.16 * Math.sin(game.time * 7);
    const half = this.tuning.barrelAimHalfW;
    let near = Infinity;
    for (const b of game.barrels) {
      if (b.dead) continue;
      const rel = b.posZ - game.z;
      if (rel > 62) break;
      if (rel < -3) continue;
      const live = rel <= this.tuning.barrelRangeZ;
      if (live) near = Math.min(near, Math.max(rel, 0));
      const col = rewardColor(b.reward);
      this.#band(b.x, half, rel, live ? pulse : 0.1, col);
      // 正在打的那个,带子铺满整条交火纵深并压白:一眼看清"火力现在正被这个桶吃着"。
      // 这块面积比桶身大一个量级,比给桶镶白边管用得多。
      if (game.barrelTarget === b) {
        this.#band(b.x, half, rel, 0.3, '#FFFFFF');
        // 只铺到大军跟前(rel ≥ 0)。再往后画会被 proj 的 rel 下限夹住,糊成一块贴在屏幕底的大色块。
        for (let d = 4; d <= rel; d += 4) this.#band(b.x, half, rel - d, 0.12, col);
      }
    }
    this.aimPip = this.aimPip || near <= 34;   // 中心标:对准桶和躲开障碍要的是同一条线
  }

  /**
   * 中心标(在大军之后画,否则被队伍盖住)。判定只看大军中心(见 game.js #checkObstacles),
   * 而队形铺开有十几个单位宽 —— 不把中心标出来,擦身而过看起来就是"压上去了却没掉兵",
   * 玩家学不到那条线在哪,只会觉得掉不掉兵是随机的。有障碍逼近时才亮,平时不占画面。
   */
  #aimPip(game) {
    if (!this.aimPip) return;
    const g = this.ctx;
    const p = proj(game.centerX, 5.5);
    const s = Math.max(7, 34 * p.d);
    g.fillStyle = '#FFFFFF';
    g.strokeStyle = INK;
    g.lineWidth = Math.max(1.5, s * 0.18);
    g.beginPath();
    g.moveTo(p.sx, p.sy + s * 0.5); g.lineTo(p.sx - s * 0.6, p.sy - s * 0.5); g.lineTo(p.sx + s * 0.6, p.sy - s * 0.5);
    g.closePath(); g.fill(); g.stroke();
  }

  /**
   * 障碍本体。不可摧毁,所以**不画血条** —— 闸门有血条有数字("打它"),障碍什么都没有("躲它"),
   * 玩家不用读说明就能分清这两种横在路上的东西。
   */
  #obstacles(game) {
    const g = this.ctx;
    for (const o of game.obstacles) {
      const rel = o.posZ - game.z;
      if (rel > 62) break;
      if (rel < -3) continue;
      const a = proj(o.cx - o.width / 2, rel), b = proj(o.cx + o.width / 2, rel);
      const w = b.sx - a.sx;
      g.lineWidth = Math.max(1.5, 7 * a.d);
      g.strokeStyle = INK;
      if (o.type === 'roller') {
        // 高度压在闸门(210)之下、比小怪(58~84)高一截:一眼分得清"打的"和"躲的",又不至于被怪群埋了
        const h = 150 * a.d, top = a.sy - h;
        g.fillStyle = ROLLER;
        g.fillRect(a.sx, top, w, h);
        // 斜条纹跟着 cx 走:滚筒往哪边挪,条纹就往哪边卷 —— 静止的条纹会读成一块黄板
        g.save();
        g.beginPath(); g.rect(a.sx, top, w, h); g.clip();
        g.fillStyle = INK;
        const sw = Math.max(6, 26 * a.d), span = sw * 2;
        const off = ((o.cx * 60 * a.d) % span + span) % span;
        for (let sx = a.sx - h - off; sx < b.sx + h; sx += span) {
          g.beginPath();
          g.moveTo(sx, a.sy); g.lineTo(sx + sw, a.sy); g.lineTo(sx + sw + h, top); g.lineTo(sx + h, top);
          g.closePath(); g.fill();
        }
        g.restore();
        g.strokeRect(a.sx, top, w, h);
        g.fillStyle = '#6E7478';   // 两端轴帽:读成滚筒而不是一块牌子
        g.fillRect(a.sx - 9 * a.d, top, 15 * a.d, h);
        g.fillRect(b.sx - 6 * a.d, top, 15 * a.d, h);
      } else {
        const h = 155 * a.d;
        g.fillStyle = SPIKE_DARK;                       // 底座
        g.fillRect(a.sx, a.sy - h * 0.3, w, h * 0.3);
        g.strokeRect(a.sx, a.sy - h * 0.3, w, h * 0.3);
        // 牙要少而宽:牙一密,那圈保证轮廓的描边就吃掉整个三角,红色全变成黑的
        const teeth = Math.max(3, Math.round(o.width * 0.9));
        const tw = w / teeth;
        g.lineWidth *= 0.45;
        g.fillStyle = SPIKE;
        for (let i = 0; i < teeth; i++) {
          const cx = a.sx + (i + 0.5) * tw;
          g.beginPath();
          g.moveTo(cx - tw * 0.44, a.sy - h * 0.24);
          g.lineTo(cx, a.sy - h);
          g.lineTo(cx + tw * 0.44, a.sy - h * 0.24);
          g.closePath();
          g.fill(); g.stroke();                          // 描边:红尖刺压在霉绿怪群上要靠轮廓才分得开
        }
      }
    }
  }

  /**
   * 油桶本体。三样东西必须同时给全,少一样玩家就不敢打:
   * **血条**(打得动、还剩多少)、**奖励标签**(值不值得打)、**裂纹**(打中了,有进展)。
   * 裂纹是给血条补的冗余 —— 血条在远处只有几个像素高,裂纹在桶身上占一大片,是远距离唯一读得到的进度。
   *
   * 桶身画得比对准带窄:带子是判定,桶是本体,看得见的余量就是"你还能偏多少"。
   */
  #barrels(game) {
    const g = this.ctx;
    const CRACKS = [
      [[0.52, 0.06], [0.38, 0.3], [0.56, 0.48], [0.42, 0.72], [0.5, 0.94]],
      [[0.16, 0.18], [0.33, 0.4], [0.18, 0.58], [0.29, 0.8]],
      [[0.86, 0.14], [0.7, 0.36], [0.85, 0.62]],
    ];
    for (const b of game.barrels) {
      if (b.dead) continue;
      const rel = b.posZ - game.z;
      if (rel > 62) break;
      if (rel < -3) continue;
      const col = rewardColor(b.reward);
      const a = proj(b.x - 1.5, rel), c = proj(b.x + 1.5, rel);
      const w = c.sx - a.sx, h = 190 * a.d, top = a.sy - h;
      const engaged = game.barrelTarget === b;
      const k = Math.max(0, b.hp / b.maxHp);

      // 各段占比是调过的:维度色带一宽,锈色就只剩两条缝,远看又变回"一块彩色方片"。
      // 锈色至少要占四成,桶才是桶。
      g.fillStyle = BARREL_BODY;
      g.fillRect(a.sx, top, w, h);
      g.fillStyle = BARREL_BODY_D;                                  // 下半身压暗,读出圆筒的体积
      g.fillRect(a.sx, top + h * 0.76, w, h * 0.24);
      g.fillStyle = BARREL_CAP;                                     // 顶盖
      g.fillRect(a.sx, top, w, h * 0.08);
      g.fillStyle = BARREL_HOOP;                                    // 上下两道箍,把色带夹成"桶"而不是"色块"
      g.fillRect(a.sx, top + h * 0.36, w, h * 0.04);
      g.fillRect(a.sx, top + h * 0.6, w, h * 0.04);
      g.fillStyle = col;                                            // 腰带 = 这桶给什么
      g.fillRect(a.sx, top + h * 0.4, w, h * 0.2);

      // 裂纹按剩余血量分两段露出(《美术需求清单v2补充》§5 的 barrel_crack_* 两段受损状态)
      const stage = k <= 0.34 ? 3 : k <= 0.67 ? 1 : 0;
      if (stage) {
        g.strokeStyle = INK;
        g.lineWidth = Math.max(1.5, 7 * a.d);
        g.lineJoin = 'round';
        for (let i = 0; i < stage; i++) {
          g.beginPath();
          CRACKS[i].forEach(([u, v], j) => {
            const px = a.sx + u * w, py = top + v * h;
            j === 0 ? g.moveTo(px, py) : g.lineTo(px, py);
          });
          g.stroke();
        }
        g.lineJoin = 'miter';   // 不还原的话后面所有 strokeRect(门框/大军)的直角都会跟着变圆
      }

      // 描边一律用 INK:白边看着醒目,但桶在远处只有几十像素,粗白边会把锈色桶身整个吃掉,
      // 反而糊成一块白片。"正在打哪个"改由地面对准带加亮来说(见 #barrelGround),那块面积大得多。
      g.lineWidth = Math.max(2, 7 * a.d);
      g.strokeStyle = INK;
      g.strokeRect(a.sx, top, w, h);

      // 血条 + 奖励标签(照闸门的语法:血条在上、数字在中,一眼归到"这是打的"那一类)
      const bh = Math.max(5, 17 * a.d), by = top - bh * 1.9;
      g.fillStyle = 'rgba(0,0,0,0.5)';
      g.fillRect(a.sx - 2, by - 2, w + 4, bh + 4);
      g.fillStyle = col;
      g.fillRect(a.sx, by, w * k, bh);

      const fs = Math.max(15, 62 * a.d);
      g.font = `900 ${fs}px system-ui, sans-serif`;
      g.textAlign = 'center'; g.textBaseline = 'middle';
      g.lineWidth = Math.max(2, fs * 0.16); g.strokeStyle = INK;
      const label = rewardLabel(b.reward);
      g.strokeText(label, (a.sx + c.sx) / 2, by - fs * 0.7);
      g.fillStyle = col;
      g.fillText(label, (a.sx + c.sx) / 2, by - fs * 0.7);
    }
  }

  #enemies(game) {
    const g = this.ctx;
    // 先剔掉画不到的再排序:300 只时省掉大半比较,也省掉每帧新建一个数组
    const list = this.zsort;
    list.length = 0;
    for (const e of game.enemies) {
      const rel = e.z - game.z;
      if (rel <= 62 && rel >= -6) list.push(e);
    }
    list.sort((a, b) => b.z - a.z);   // 远的先画、近的压在上面 —— 堆积时的前后层次全靠这一下
    for (const e of list) {
      const rel = e.z - game.z;
      const p = proj(e.x, rel);
      const thick = e.type === 'thick';
      // 远处怪按透视会缩成一颗颗小点、看着稀疏。放大一档让它们互相压住,读出来才是"海量"
      const s = (thick ? 84 : 58) * p.d * (1 + Math.min(rel / 62, 1) * 0.55);
      g.fillStyle = thick ? THICK : MOLD;
      g.fillRect(p.sx - s / 2, p.sy - s, s, s);
      g.fillStyle = thick ? '#5C4520' : MOLD_DARK;
      g.fillRect(p.sx - s / 2, p.sy - s * 0.28, s, s * 0.28);
      // 受伤露白
      if (e.hp < e.maxHp) {
        g.fillStyle = 'rgba(255,255,255,0.35)';
        g.fillRect(p.sx - s / 2, p.sy - s, s * (1 - e.hp / e.maxHp), s * 0.16);
      }
    }
  }

  /** 闸门:横跨赛道的金属门 + 黄黑警示条 + 剩余血量大数字(照素材里的 621)。 */
  #barrier(game) {
    const g = this.ctx;
    const b = game.barrier;
    const rel = b.posZ - game.z;
    const half = this.tuning.track.width / 2;
    const a = proj(-half - 1.2, rel), c = proj(half + 1.2, rel);
    const h = 210 * a.d;
    const top = a.sy - h;
    const w = c.sx - a.sx;

    g.fillStyle = '#6E7478';                       // 门体
    g.fillRect(a.sx, top, w, h);
    g.fillStyle = '#565C60';
    g.fillRect(a.sx, top + h * 0.55, w, h * 0.45);
    // 黄黑警示条
    const bh = Math.max(4, h * 0.13);
    g.fillStyle = '#E8B93A'; g.fillRect(a.sx, top, w, bh);
    g.fillStyle = '#2B2420';
    for (let i = 0; i < w; i += bh * 1.6) g.fillRect(a.sx + i, top, bh * 0.8, bh);
    // 门柱
    g.fillStyle = '#4A5054';
    g.fillRect(a.sx - 10 * a.d, top, 22 * a.d, h);
    g.fillRect(c.sx - 12 * a.d, top, 22 * a.d, h);

    // 剩余血量大数字
    const fs = Math.max(26, 130 * a.d);
    g.font = `900 ${fs}px system-ui, sans-serif`;
    g.textAlign = 'center'; g.textBaseline = 'middle';
    g.lineWidth = Math.max(3, fs * 0.16); g.strokeStyle = INK;
    const txt = String(Math.max(0, Math.ceil(b.hp)));
    g.strokeText(txt, (a.sx + c.sx) / 2, top + h * 0.55);
    g.fillStyle = '#FFF';
    g.fillText(txt, (a.sx + c.sx) / 2, top + h * 0.55);

    // 顶部进度条:一眼看出还要打多久
    const pw = W * 0.5, px = W / 2 - pw / 2, py = H * 0.19;
    g.fillStyle = 'rgba(0,0,0,0.5)'; g.fillRect(px - 5, py - 5, pw + 10, 32);
    g.fillStyle = '#E8B93A';
    g.fillRect(px, py, pw * Math.max(0, b.hp / b.maxHp), 22);
  }

  #boss(game) {
    const g = this.ctx;
    const b = game.boss;
    const p = proj(0, this.tuning.bossStandZ);
    const s = 320 * p.d;
    g.fillStyle = '#3B2F1E';
    g.fillRect(p.sx - s / 2, p.sy - s, s, s);
    g.fillStyle = MOLD_DARK;
    g.fillRect(p.sx - s / 2, p.sy - s * 0.9, s, s * 0.25);
    // 血条
    const bw = W * 0.62, bx = W / 2 - bw / 2, by = H * 0.13;
    g.fillStyle = 'rgba(0,0,0,0.55)'; g.fillRect(bx - 6, by - 6, bw + 12, 46);
    g.fillStyle = '#E5484D';
    g.fillRect(bx, by, bw * Math.max(0, b.hp / b.maxHp), 34);
    g.font = '900 34px system-ui, sans-serif'; g.textAlign = 'center'; g.textBaseline = 'middle';
    g.fillStyle = '#FFF';
    g.fillText(`BOSS  ${Math.max(0, Math.ceil(b.hp))}`, W / 2, by + 17);
  }

  #army(game, dt) {
    const g = this.ctx;
    const n = game.stats.N;
    if (n <= 0) return;
    const shown = Math.min(n, this.tuning.nRender);
    // 半径封顶:R 按 √N 无限长,画出来的却始终只有 nRender 个 —— N=200 时 60 个兵摊在 8.8 单位的盘上,
    // 间距 99px 而个头只有 51px,兵越多反而越稀,还溢出赛道两侧。封顶后多出来的兵力改由 over 放大个头体现。
    const R = Math.min(this.tuning.formationRadiusK * Math.sqrt(n), this.tuning.formationRadiusMax);
    const over = n > this.tuning.nRender ? 1 + Math.log10(n / this.tuning.nRender) * 0.3 : 1;
    const blink = game.shieldT > 0 && Math.floor(game.time * 12) % 2 === 0;
    const boost = game.boostT > 0;   // 冲刺期镀金,和速度线一起把"无敌冲出去"讲清楚

    const slots = [];
    for (let i = 0; i < shown; i++) {
      const s = unitFormationSlot(i, shown);
      const x = game.centerX + s.x * R;
      const u = this.units[i] || (this.units[i] = { ox: 0, oz: 0, vx: 0, vz: 0 });
      // 撞击推挤:只吃最近那一下(一排怪同时撞上来,逐个叠加会把兵顶飞)
      let w = 0, dir = 1;
      for (const hx of this.impacts) {
        const d = Math.abs(x - hx);
        if (d < KICK_R && KICK * (1 - d / KICK_R) > w) { w = KICK * (1 - d / KICK_R); dir = x >= hx ? 1 : -1; }
      }
      if (w) { u.vx += w * dir; u.vz -= w; }        // 让开 + 后退
      u.vx -= (u.ox * SPRING + u.vx * DAMP) * dt;   // 弹簧拉回原位,阻尼收住余震
      u.vz -= (u.oz * SPRING + u.vz * DAMP) * dt;
      u.ox += u.vx * dt; u.oz += u.vz * dt;
      slots.push({ x: x + u.ox, rel: 1.2 + s.z * R * this.tuning.formationDepthK + u.oz, i });
    }
    slots.sort((a, b) => b.rel - a.rel);
    // 透视把纵深压掉七成(z 方向 14px/单位 vs x 方向 46px/单位),队形在屏幕上是个扁盘,
    // 兵一挤密就糊成一张奶油饼 —— 同色方块互相盖住,只剩最前排看得见轮廓。描边是让它读成"一群"而不是"一坨"的关键。
    g.strokeStyle = INK;
    g.lineWidth = Math.max(1.5, this.tuning.unitSize * over * 0.05);
    for (const s of slots) {
      const p = proj(s.x, s.rel);
      const size = this.tuning.unitSize * p.d * over;
      const bob = Math.sin(game.time * 10 + s.i) * size * 0.06;
      const top = p.sy - size + bob;
      g.fillStyle = blink ? '#FFFFFF' : boost ? '#FFF3C4' : GARLIC;
      g.fillRect(p.sx - size / 2, top, size, size);
      g.fillStyle = blink ? '#FFE9E9' : boost ? '#E8CE7A' : GARLIC_DARK;
      g.fillRect(p.sx - size / 2, p.sy - size * 0.3 + bob, size, size * 0.3);
      g.fillStyle = '#F2A83B';   // 嘴
      g.fillRect(p.sx - size * 0.08, p.sy - size * 0.62 + bob, size * 0.16, size * 0.12);
      g.strokeRect(p.sx - size / 2, top, size, size);
    }
  }

  /**
   * 曳光弹:细长拖尾 + 粗亮弹芯,分两遍画。
   * 分遍是为了省状态切换 —— 同屏 300 发时逐发切 fillStyle/globalAlpha 是 600 次状态变更,
   * 分成两趟只要 2 次。淡黄弹丸在浅灰路面上糊成一片(和冲击环、冲刺线踩过同一个坑),
   * 拖尾走橙、弹芯走白才压得住底。
   */
  #bullets(game) {
    const g = this.ctx;
    const { bulletSize, bulletTrailK } = this.tuning;
    const pass = (color, alpha, wk, hk) => {
      g.globalAlpha = alpha;
      g.fillStyle = color;
      for (const b of game.bullets) {
        const rel = b.z - game.z;
        if (rel > 62 || rel < -2) continue;
        const p = proj(b.x, rel);
        const s = Math.max(4, bulletSize * p.d);
        const len = s * bulletTrailK;
        g.fillRect(p.sx - s * wk / 2, p.sy - len, s * wk, len * hk);
      }
      g.globalAlpha = 1;
    };
    // 弹体要比兵窄一大截:同屏上百发时,和兵一样宽的白方块会跟大军糊成一片,分不清谁是谁
    // 限时 buff 期间拖尾换成 buff 色:清怪的时候玩家眼睛在弹幕上不在 HUD 上,弹幕变色才是那 5 秒的即时反馈
    pass(game.buffMul > 1 ? BUFF_COLOR : BULLET_TRAIL, 0.7, 0.34, 1);   // 拖尾:细、长、半透
    pass(BULLET, 1, 0.62, 0.5);            // 弹芯:短、亮,压在拖尾顶端
  }

  /** 突破冲击波:贴地的扩散环,以闸门位置为圆心沿赛道铺开(逻辑范围就是 game 里的 breakWaveRange)。 */
  #waves(game, dt) {
    const g = this.ctx;
    for (const w of this.waves) {
      w.t += dt;
      const k = w.t / w.life;
      const R = w.range * k;
      const rel = w.z - game.z;
      const ring = (rad, width, alpha, color) => {
        g.globalAlpha = alpha;
        g.lineWidth = width;
        g.strokeStyle = color;
        g.beginPath();
        for (let i = 0; i <= 28; i++) {
          const a = (i / 28) * Math.PI * 2;
          const p = proj(Math.sin(a) * rad, rel + Math.cos(a) * rad);
          i === 0 ? g.moveTo(p.sx, p.sy) : g.lineTo(p.sx, p.sy);
        }
        g.closePath(); g.stroke();
      };
      // 路面是浅灰的,金色环会糊在背景里 —— 用橙红外焰 + 白芯才压得住
      const fade = Math.max(0, 1 - k);
      ring(R, Math.max(6, 46 * (1 - k)), fade * 0.55, '#FF6A1A');   // 外焰
      ring(R, Math.max(3, 18 * (1 - k)), fade, '#FFFFFF');          // 芯
      ring(R * 0.55, Math.max(2, 10 * (1 - k)), fade * 0.45, '#FFC23A');
      g.globalAlpha = 1;
    }
    this.waves = this.waves.filter(w => w.t < w.life);
  }

  /** 突破后的冲刺:地面拉出速度线,让"冲出去"看得见。 */
  #boostStreaks(game) {
    const g = this.ctx;
    const half = this.tuning.track.width / 2;
    g.globalAlpha = Math.min(1, game.boostT / this.tuning.breakBoostS) * 0.5;
    g.fillStyle = '#FF9A2E';   // 浅灰路面上淡黄看不见,冲刺线要用橙的
    for (let i = 0; i < 18; i++) {
      const x = (Math.random() * 2 - 1) * half;
      const rel = Math.random() * 55;
      const a = proj(x, rel), b = proj(x, rel + 9);
      g.fillRect(a.sx - 7 * a.d, b.sy, Math.max(3, 14 * a.d), a.sy - b.sy);
    }
    g.globalAlpha = 1;
  }

  #effects(dt) {
    const g = this.ctx;
    for (const f of this.fx) {
      f.t += dt;
      const k = f.t / f.life;
      const p = proj(f.x, f.rel);
      g.globalAlpha = Math.max(0, 1 - k);
      if (f.kind === 'hit') {
        // 十字火星:同样大小下比方块更像"打上去了",两条细长条比画个圆便宜
        const s = this.tuning.bulletSize * p.d * (1 + k * 1.4), w = s * 0.22;
        g.fillStyle = HIT;
        g.fillRect(p.sx - s / 2, p.sy - w / 2, s, w);
        g.fillRect(p.sx - w / 2, p.sy - s / 2, w, s);
      } else {
        const s = (f.type === 'boss' ? 90 : f.type === 'wave' ? 62 : f.type === 'barrel' ? 28 : 46) * p.d * (1 + k * 1.6);
        g.fillStyle = f.color || (f.type === 'thick' ? '#C9A227' : f.type === 'wave' ? '#FF9A2E'
          : f.type === 'obstacle' ? SPIKE : '#DFF5A8');
        g.fillRect(p.sx - s / 2, p.sy - s / 2, s, s);
      }
      g.globalAlpha = 1;
    }
    this.fx = this.fx.filter(f => f.t < f.life);

    for (const f of this.floats) {
      f.t += dt;
      const k = f.t / f.life;
      const p = proj(f.x, f.rel);
      g.globalAlpha = Math.max(0, 1 - k);
      g.font = '900 76px system-ui, sans-serif';
      g.textAlign = 'center'; g.textBaseline = 'middle';
      g.lineWidth = 12; g.strokeStyle = INK;
      g.strokeText(f.txt, p.sx, p.sy - 220 - k * 160);
      g.fillStyle = f.color;
      g.fillText(f.txt, p.sx, p.sy - 220 - k * 160);
      g.globalAlpha = 1;
    }
    this.floats = this.floats.filter(f => f.t < f.life);
  }

  #hud(game) {
    const g = this.ctx;
    const s = game.stats;
    // 取 clearF(真正落在怪身上的那份)而不是总火力 F:打桶分走的、限时 buff 加成的都要当场并进这个数,
    // 否则"分神是要付账的"永远只存在于文档里 —— 玩家看到的仍是一个稳稳不动的火力值。
    const F = game.clearF;
    const need = game.demand;

    g.font = '900 46px system-ui, sans-serif';
    g.textAlign = 'left'; g.textBaseline = 'top';
    g.lineWidth = 9; g.strokeStyle = INK;
    const line = (txt, x, y, color) => { g.strokeText(txt, x, y); g.fillStyle = color; g.fillText(txt, x, y); };

    line(`第 ${game.level.level} 关`, 40, 40, '#FFF');
    line(`击杀 ${game.killCount}`, 40, 100, '#FFF');

    // 四维状态
    const dims = [['N', s.N], ['L', s.L], ['R', s.R.toFixed(1)], ['D', s.D.toFixed(1)]];
    dims.forEach(([k, v], i) => line(`${k} ${v}`, 40 + i * 190, 170, DIM_COLOR[k]));

    // 火力 vs 需求:红了就是在漏怪
    const short = need > 0 && F < need;
    const tag = game.barrelTarget ? ' ↘打桶' : game.buffMul > 1 ? ' ↗buff' : '';
    line(`火力 ${Math.round(F)}${need > 0 ? ` / 需 ${Math.round(need)}` : ''}${tag}`, 40, 240, short ? '#FF6B6B' : '#B6F09C');

    // 进度条
    const bw = W - 80;
    g.fillStyle = 'rgba(0,0,0,0.35)'; g.fillRect(40, 320, bw, 16);
    g.fillStyle = '#B6F09C'; g.fillRect(40, 320, bw * game.progress, 16);
  }

  #result(game) {
    const g = this.ctx;
    const r = game.result;
    g.fillStyle = 'rgba(20,26,30,0.82)';
    g.fillRect(0, 0, W, H);
    g.textAlign = 'center'; g.textBaseline = 'middle';

    g.font = '900 150px system-ui, sans-serif';
    g.fillStyle = r.win ? '#B6F09C' : '#FF8A8A';
    g.fillText(r.win ? '通关!' : '失败', W / 2, H * 0.3);

    g.font = '900 60px system-ui, sans-serif';
    g.fillStyle = '#FFF';
    if (r.win) {
      const star = '★'.repeat(gameStar(game)) + '☆'.repeat(3 - gameStar(game));
      g.fillText(star, W / 2, H * 0.4);
      g.fillText(`火力峰值 ${Math.round(r.fPeak)} / 目标 ${r.targetF}`, W / 2, H * 0.46);
    } else {
      g.fillText(FAIL_TEXT[r.reason] || '被小怪冲垮', W / 2, H * 0.4);
      g.fillText(`火力峰值 ${Math.round(r.fPeak)}`, W / 2, H * 0.46);
    }
    g.fillText(`击杀 ${r.kills}   漏怪 ${r.leaks}   ${r.time}s`, W / 2, H * 0.52);

    g.fillStyle = '#3E8FE0';
    g.fillRect(BTN.x, BTN.y, BTN.w, BTN.h);
    g.fillStyle = '#FFF';
    g.font = '900 66px system-ui, sans-serif';
    g.fillText(r.win ? '下一关' : '再来一次', W / 2, BTN.y + BTN.h / 2);
  }
}

function gameStar(game) {
  const t = game.tuning.star;
  const ratio = game.result.fPeak / game.level.targetF;
  return ratio >= t['3'] ? 3 : ratio >= t['2'] ? 2 : 1;
}
