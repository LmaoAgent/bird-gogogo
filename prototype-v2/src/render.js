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
    this.shake = 0;
    this.flash = 0;      // 掉兵红闪
  }

  consume(game) {
    for (const ev of game.events) {
      if (ev.kind === 'kill') {
        this.fx.push({ x: ev.x, rel: ev.z - game.z, t: 0, life: 0.25, kind: 'kill', type: ev.type });
      } else if (ev.kind === 'gate') {
        const e = ev.effect;
        const txt = `${e.dim}${e.op === 'mul' ? '×' : '+'}${e.value}`;
        this.floats.push({ x: 0, rel: 2, t: 0, life: 0.9, txt, color: isBuff(e) ? DIM_COLOR[e.dim] : TRAP_COLOR });
        this.shake = Math.max(this.shake, isBuff(e) ? 0.18 : 0.3);
      } else if (ev.kind === 'leak') {
        this.flash = 0.35;
        this.shake = Math.max(this.shake, 0.35);
        this.floats.push({ x: 0, rel: 1, t: 0, life: 0.8, txt: `-${ev.loss}`, color: '#E5484D' });
      } else if (ev.kind === 'barrierIn') {
        this.shake = 0.4;
      } else if (ev.kind === 'barrierDown') {
        // 打穿瞬间:炸裂 + 强震,紧接着堆在门后的怪会一起涌出
        this.shake = 0.75;
        for (let i = 0; i < 26; i++) {
          this.fx.push({ x: (Math.random() * 2 - 1) * 8, rel: ev.barrier.posZ - game.z, t: 0, life: 0.45, kind: 'kill', type: 'boss' });
        }
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
    this.#gates(game);
    this.#enemies(game);
    if (game.barrier) this.#barrier(game);
    if (game.bossActive && game.boss) this.#boss(game);
    this.#army(game);
    this.#bullets(game);
    this.#effects(dt);
    g.restore();

    if (this.flash > 0) {
      g.fillStyle = `rgba(229,72,77,${this.flash * 0.5})`;
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
    const sorted = [...game.enemies].sort((a, b) => b.z - a.z);
    for (const e of sorted) {
      const rel = e.z - game.z;
      if (rel > 62 || rel < -6) continue;
      const p = proj(e.x, rel);
      const thick = e.type === 'thick';
      const s = (thick ? 84 : 58) * p.d;
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

  #army(game) {
    const g = this.ctx;
    const n = game.stats.N;
    if (n <= 0) return;
    const shown = Math.min(n, this.tuning.nRender);
    const R = this.tuning.formationRadiusK * Math.sqrt(n);
    const over = n > this.tuning.nRender ? 1 + Math.log10(n / this.tuning.nRender) * 0.3 : 1;
    const blink = game.shieldT > 0 && Math.floor(game.time * 12) % 2 === 0;

    const slots = [];
    for (let i = 0; i < shown; i++) {
      const s = unitFormationSlot(i, shown);
      slots.push({ x: game.centerX + s.x * R, rel: 1.2 + s.z * R * 0.5, i });
    }
    slots.sort((a, b) => b.rel - a.rel);
    for (const s of slots) {
      const p = proj(s.x, s.rel);
      const size = 44 * p.d * over;
      const bob = Math.sin(game.time * 10 + s.i) * size * 0.06;
      g.fillStyle = blink ? '#FFFFFF' : GARLIC;
      g.fillRect(p.sx - size / 2, p.sy - size + bob, size, size);
      g.fillStyle = blink ? '#FFE9E9' : GARLIC_DARK;
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

  #effects(dt) {
    const g = this.ctx;
    for (const f of this.fx) {
      f.t += dt;
      const k = f.t / f.life;
      const p = proj(f.x, f.rel);
      const s = (f.type === 'boss' ? 90 : 46) * p.d * (1 + k * 1.6);
      g.globalAlpha = Math.max(0, 1 - k);
      g.fillStyle = f.type === 'thick' ? '#C9A227' : '#DFF5A8';
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
