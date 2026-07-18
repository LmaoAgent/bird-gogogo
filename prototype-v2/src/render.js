// v2 表现层 —— 只读 Game 字段 + 消费 events,不含任何玩法规则。
// 伪 3D 投影沿用 v1 render.js 的做法(手感一致);配色按《v2》§0「明亮大胆降 CPI」。

import { unitFormationSlot, firepower, isBuff } from './core/rules.js';

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
const BULLET = '#FFF3B0';
const INK = '#2B2420';

// 维度配色(《v2》§4)
const DIM_COLOR = { N: '#3E8FE0', L: '#9B5DE5', R: '#F49D1A', D: '#E5484D' };
const TRAP_COLOR = '#3A2B2B';

// 撞击推挤(纯表现):怪撞进大军时把附近的兵顶开,弹簧拉回原位
const KICK = 7, KICK_R = 2.6, SPRING = 120, DAMP = 13;

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
    if (game.boostT > 0) this.#boostStreaks(game);
    this.#gates(game);
    this.#enemies(game);
    if (game.barrier) this.#barrier(game);
    if (game.bossActive && game.boss) this.#boss(game);
    this.#army(game, dt);
    this.#bullets(game);
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
    const R = this.tuning.formationRadiusK * Math.sqrt(n);
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
      slots.push({ x: x + u.ox, rel: 1.2 + s.z * R * 0.5 + u.oz, i });
    }
    slots.sort((a, b) => b.rel - a.rel);
    for (const s of slots) {
      const p = proj(s.x, s.rel);
      const size = 44 * p.d * over;
      const bob = Math.sin(game.time * 10 + s.i) * size * 0.06;
      g.fillStyle = blink ? '#FFFFFF' : boost ? '#FFF3C4' : GARLIC;
      g.fillRect(p.sx - size / 2, p.sy - size + bob, size, size);
      g.fillStyle = blink ? '#FFE9E9' : boost ? '#E8CE7A' : GARLIC_DARK;
      g.fillRect(p.sx - size / 2, p.sy - size * 0.3 + bob, size, size * 0.3);
      g.fillStyle = '#F2A83B';   // 嘴
      g.fillRect(p.sx - size * 0.08, p.sy - size * 0.62 + bob, size * 0.16, size * 0.12);
    }
  }

  #bullets(game) {
    const g = this.ctx;
    g.fillStyle = BULLET;
    for (const b of game.bullets) {
      const rel = b.z - game.z;
      if (rel > 62 || rel < -2) continue;
      const p = proj(b.x, rel);
      const s = Math.max(4, 24 * p.d);
      g.fillRect(p.sx - s / 2, p.sy - s * 2.0, s, s * 2.0);
    }
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
      const s = (f.type === 'boss' ? 90 : f.type === 'wave' ? 62 : 46) * p.d * (1 + k * 1.6);
      g.globalAlpha = Math.max(0, 1 - k);
      g.fillStyle = f.type === 'thick' ? '#C9A227' : f.type === 'wave' ? '#FF9A2E' : '#DFF5A8';
      g.fillRect(p.sx - s / 2, p.sy - s / 2, s, s);
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
    const F = firepower(s);
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
    line(`火力 ${Math.round(F)}${need > 0 ? ` / 需 ${Math.round(need)}` : ''}`, 40, 240, short ? '#FF6B6B' : '#B6F09C');

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
      g.fillText(r.reason === 'boss' ? 'BOSS 压垮了你' : '被小怪冲垮', W / 2, H * 0.4);
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
