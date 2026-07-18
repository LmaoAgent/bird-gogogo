// Canvas 渲染层 —— 只读 Game 的状态,不含任何玩法规则。
// 迁 Cocos 时整体替换本文件(core/ 不动)。设计分辨率 1080×1920(《美术需求清单》§0)。

import { unitFormationSlot, clamp } from './core/rules.js';
import { makeGarlicBird, makeMoldling, makeRotGarlic, PALETTE } from './sprites.js';

export const W = 1080;
export const H = 1920;

const FAR = 130;          // 最远可见纵深
const NEAR = -18;         // 赛道近端(需铺满屏幕底部)
const GATE_NEAR = -5;     // 门穿过大军后即剔除,否则透视放大成巨幅门框挡住视线
const GATE_H = 5.2;       // 门高(世界单位)
const BIRD_SIZE = 1.05;   // 单兵直径(世界单位)

// 结算页按钮(main.js 用同一份坐标做点击判定)
export const BTN = { x: W / 2 - 260, y: 1130, w: 520, h: 150 };

const GATE_STYLE = {
  blue:   { frame: '#4FA8E8', fill: 'rgba(79,168,232,0.18)',  text: '#EAF6FF' },
  gold:   { frame: '#F2C33B', fill: 'rgba(242,195,59,0.20)',  text: '#FFF8E0' },
  purple: { frame: '#A96FD6', fill: 'rgba(169,111,214,0.20)', text: '#F6ECFF' },
  hazard: { frame: '#C0392B', fill: 'rgba(192,57,43,0.22)',   text: '#FFE7E3' },
};

/** 门的视觉分类(《美术需求清单》§4)：加成小额=蓝、大额=金、乘法=紫、陷阱=红黑。 */
function gateStyle(effect) {
  if (effect.type === 'mul') return GATE_STYLE.purple;
  if (effect.type === 'sub' || effect.type === 'div') return GATE_STYLE.hazard;
  return effect.value >= 20 ? GATE_STYLE.gold : GATE_STYLE.blue;
}

function gateLabel(effect) {
  switch (effect.type) {
    case 'add': return `+${effect.value}`;
    case 'mul': return `×${effect.value}`;
    case 'sub': return `-${effect.value}`;
    case 'div': return `÷${effect.value}`;
    default: return '';
  }
}

const lerp = (a, b, t) => a + (b - a) * t;

export class Renderer {
  constructor(canvas, tuning) {
    this.canvas = canvas;
    canvas.width = W;
    canvas.height = H;
    this.g = canvas.getContext('2d');
    this.tuning = tuning;

    this.sprites = {
      bird: makeGarlicBird(128),
      moldling: makeMoldling(128),
      boss: makeRotGarlic(256),
    };

    this.cx = W / 2;
    this.horizonY = H * 0.30;
    this.armyY = H * 0.76;
    this.persp = 0.030;
    this.unit = (W * 0.90) / tuning.track.width;

    this.time = 0;
    this.shake = 0;
    this.nPop = 0;
    this.flashes = [];
  }

  /** 伪 3D 投影：dz 为相对大军的纵深差。 */
  project(worldX, dz) {
    const s = 1 / Math.max(1 + dz * this.persp, 0.15);
    return {
      x: this.cx + worldX * s * this.unit,
      y: this.horizonY + (this.armyY - this.horizonY) * s,
      s,
    };
  }

  /** 消费本帧事件,驱动打击感与特效(§8 手感参数)。 */
  consume(game) {
    for (const e of game.events) {
      if (e.kind === 'gate') {
        this.nPop = 1;
        this.flashes.push({
          x: this.tuning.track.laneX[e.effect.side],
          z: e.gate.posZ,
          t: 0,
          style: gateStyle(e.effect),
        });
      } else if (e.kind === 'smashStart') {
        this.shake = this.tuning.fx.smashShakeAmp;
      }
    }
  }

  draw(game, dt) {
    const g = this.g;
    this.time += dt;
    this.nPop = Math.max(0, this.nPop - dt * 4);
    this.shake = Math.max(0, this.shake - dt * (this.tuning.fx.smashShakeAmp / this.tuning.fx.smashShakeDuration));
    this.flashes = this.flashes.filter(f => (f.t += dt) < 0.35);

    g.save();
    if (this.shake > 0) {
      g.translate((Math.random() - 0.5) * this.shake * 2, (Math.random() - 0.5) * this.shake * 2);
    }

    this.#drawSky();
    this.#drawTrack(game);

    // 远 → 近：先画大军身前的门与敌人,再画大军,最后画已越过的门
    const ahead = [];
    const behind = [];
    for (const gate of game.gates) {
      const dz = gate.posZ - game.z;
      if (dz > FAR || dz < GATE_NEAR) continue;
      (dz > 0 ? ahead : behind).push({ gate, dz });
    }
    ahead.sort((a, b) => b.dz - a.dz);

    for (const it of ahead) this.#drawGate(it.gate, it.dz);
    this.#drawEnemies(game);
    this.#drawFlashes(game);
    this.#drawArmy(game);
    for (const it of behind) this.#drawGate(it.gate, it.dz);

    g.restore();

    this.#drawHud(game);
    if (game.state === 'win' || game.state === 'fail') this.#drawResult(game);
  }

  #drawSky() {
    const g = this.g;
    const sky = g.createLinearGradient(0, 0, 0, this.horizonY);
    sky.addColorStop(0, '#8FD3F4');
    sky.addColorStop(1, '#DFF3FB');
    g.fillStyle = sky;
    g.fillRect(0, 0, W, this.horizonY);

    // 远景桥塔剪影(场景占位,《美术需求清单》§3)
    g.fillStyle = 'rgba(120,150,170,0.35)';
    for (const [x, w, h] of [[150, 90, 240], [820, 110, 300], [420, 70, 170]]) {
      g.fillRect(x, this.horizonY - h, w, h);
    }
    g.fillStyle = 'rgba(255,255,255,0.55)';
    for (const [x, y, r] of [[260, 210, 70], [340, 190, 90], [760, 260, 60], [840, 240, 80]]) {
      g.beginPath();
      g.arc(x, y, r, 0, Math.PI * 2);
      g.fill();
    }

    // 桥下水面(赛道梯形两侧)
    const water = g.createLinearGradient(0, this.horizonY, 0, H);
    water.addColorStop(0, '#6FB3CC');
    water.addColorStop(1, '#2E6B84');
    g.fillStyle = water;
    g.fillRect(0, this.horizonY, W, H - this.horizonY);
  }

  #drawTrack(game) {
    const g = this.g;
    const hw = this.tuning.track.width / 2;
    const nl = this.project(-hw, NEAR), nr = this.project(hw, NEAR);
    const fl = this.project(-hw, FAR), fr = this.project(hw, FAR);

    // 桥面
    g.beginPath();
    g.moveTo(nl.x, nl.y);
    g.lineTo(fl.x, fl.y);
    g.lineTo(fr.x, fr.y);
    g.lineTo(nr.x, nr.y);
    g.closePath();
    const deck = g.createLinearGradient(0, fl.y, 0, nl.y);
    deck.addColorStop(0, '#9AA6A0');
    deck.addColorStop(1, '#C4CCC2');
    g.fillStyle = deck;
    g.fill();

    // 前进条纹(速度感)
    const step = 10;
    const first = Math.ceil(game.z / step) * step;
    g.fillStyle = 'rgba(255,255,255,0.16)';
    for (let z = first; z < game.z + FAR; z += step) {
      const dz = z - game.z;
      const a = this.project(-hw, dz), b = this.project(hw, dz);
      const t = this.project(hw, dz + 1.6);
      g.fillRect(a.x, a.y, b.x - a.x, Math.max(1, t.y - a.y));
    }

    // 护栏
    g.lineWidth = 6;
    g.strokeStyle = '#3E7C74';
    for (const side of [-1, 1]) {
      const n = this.project(side * hw, NEAR), f = this.project(side * hw, FAR);
      g.beginPath();
      g.moveTo(n.x, n.y);
      g.lineTo(f.x, f.y);
      g.stroke();
    }
  }

  #drawGate(gate, dz) {
    const opts = gate.type === 'pick' ? gate.options : [gate];
    for (const opt of opts) this.#drawGateFrame(opt, dz, gate.type === 'pick');
  }

  #drawGateFrame(effect, dz, isPick) {
    const g = this.g;
    const track = this.tuning.track;
    const x = track.laneX[effect.side];
    const hw = track.gateHalfWidth;
    const style = gateStyle(effect);

    const bl = this.project(x - hw, dz);
    const br = this.project(x + hw, dz);
    const top = this.horizonY + (this.armyY - this.horizonY - GATE_H * this.unit) * bl.s;
    const h = bl.y - top;
    if (h <= 2) return;

    g.fillStyle = style.fill;
    g.fillRect(bl.x, top, br.x - bl.x, h);
    g.lineWidth = Math.max(2, 10 * bl.s);
    g.strokeStyle = style.frame;
    g.strokeRect(bl.x, top, br.x - bl.x, h);

    const fs = Math.max(10, 78 * bl.s);
    g.font = `bold ${fs}px -apple-system, "PingFang SC", sans-serif`;
    g.textAlign = 'center';
    g.textBaseline = 'middle';
    g.lineWidth = Math.max(2, fs * 0.13);
    g.strokeStyle = PALETTE.ink;
    g.strokeText(gateLabel(effect), (bl.x + br.x) / 2, top + h * 0.5);
    g.fillStyle = style.text;
    g.fillText(gateLabel(effect), (bl.x + br.x) / 2, top + h * 0.5);

    if (isPick) {
      g.font = `bold ${Math.max(8, 34 * bl.s)}px -apple-system, "PingFang SC", sans-serif`;
      g.fillStyle = 'rgba(255,255,255,0.85)';
      g.fillText('二选一', (bl.x + br.x) / 2, top - fs * 0.45);
    }
  }

  #drawArmy(game) {
    const g = this.g;
    const t = this.tuning;
    const shown = Math.min(game.n, t.nRender);
    if (shown <= 0) return;

    // 超出 N_render 的部分用整体放大表现"更多"(§2)
    const overflow = game.n > t.nRender ? 1 + Math.log10(game.n / t.nRender) * 0.28 : 1;
    const R = t.formationRadiusK * Math.sqrt(game.n);
    const hw = t.track.width / 2 - BIRD_SIZE / 2;   // 留出鸟身宽度,不让单兵悬在赛道外
    const sprite = this.sprites.bird;

    const slots = [];
    for (let i = 0; i < shown; i++) {
      const s = unitFormationSlot(i, shown);
      slots.push({ i, x: s.x * R, z: s.z * R });
    }
    slots.sort((a, b) => b.z - a.z);

    for (const slot of slots) {
      const wx = clamp(game.centerX + slot.x, -hw, hw);
      const p = this.project(wx, slot.z);
      if (p.s <= 0) continue;
      const size = BIRD_SIZE * overflow * p.s * this.unit;
      const bob = Math.sin(this.time * 12 + slot.i * 0.7) * size * 0.06;
      g.drawImage(sprite, p.x - size / 2, p.y - size + bob, size, size);
    }
  }

  #drawEnemies(game) {
    const wave = game.currentWave;
    if (!wave) return;
    const dz = wave.posZ - game.z;
    if (dz > FAR || dz < NEAR) return;

    const g = this.g;
    const smashing = game.state === 'smashing' && game.smash.wave === wave;
    const ratio = smashing
      ? lerp(1, game.smash.hAfter / game.smash.hBefore, game.smash.progress)
      : 1;

    if (wave.isBoss) {
      const p = this.project(0, dz);
      const size = 6.5 * p.s * this.unit;
      g.drawImage(this.sprites.boss, p.x - size / 2, p.y - size, size, size);
      return;
    }

    const total = clamp(Math.round(wave.H / 14), 6, 40);
    const alive = Math.max(1, Math.round(total * ratio));
    const R = 0.75 * Math.sqrt(total);
    const slots = [];
    for (let i = 0; i < alive; i++) {
      const s = unitFormationSlot(i, total);
      slots.push({ i, x: s.x * R, z: s.z * R });
    }
    slots.sort((a, b) => b.z - a.z);

    for (const slot of slots) {
      const p = this.project(slot.x, dz + slot.z);
      if (p.s <= 0) continue;
      const size = 1.25 * p.s * this.unit;
      const bob = Math.sin(this.time * 8 + slot.i) * size * 0.05;
      g.drawImage(this.sprites.moldling, p.x - size / 2, p.y - size + bob, size, size);
    }
  }

  #drawFlashes(game) {
    const g = this.g;
    for (const f of this.flashes) {
      const dz = f.z - game.z;
      if (dz < NEAR || dz > FAR) continue;
      const p = this.project(f.x, dz);
      const k = f.t / 0.35;
      g.globalAlpha = 1 - k;
      g.lineWidth = 12 * p.s;
      g.strokeStyle = f.style.frame;
      g.beginPath();
      g.arc(p.x, p.y - 1.6 * p.s * this.unit, (0.6 + k * 2.6) * p.s * this.unit, 0, Math.PI * 2);
      g.stroke();
      g.globalAlpha = 1;
    }
  }

  #drawHud(game) {
    const g = this.g;
    const smashing = game.state === 'smashing';
    const shownN = smashing
      ? Math.round(lerp(game.smash.nBefore, game.smash.nAfter, game.smash.progress))
      : game.n;

    // 关卡 + 进度条(避开右上角胶囊区)
    g.font = 'bold 44px -apple-system, "PingFang SC", sans-serif';
    g.textAlign = 'left';
    g.textBaseline = 'middle';
    g.fillStyle = 'rgba(43,36,32,0.75)';
    g.fillText(`第 ${game.level.level} 关 / 10`, 60, 116);

    const bar = { x: 60, y: 168, w: 700, h: 20 };
    g.fillStyle = 'rgba(43,36,32,0.22)';
    g.fillRect(bar.x, bar.y, bar.w, bar.h);
    g.fillStyle = '#8FBF4D';
    g.fillRect(bar.x, bar.y, bar.w * game.progress, bar.h);
    const head = this.sprites.bird;
    g.drawImage(head, bar.x + bar.w * game.progress - 26, bar.y - 32, 56, 56);

    // 敌方血条(§6 UI)：接近时显示
    const wave = game.currentWave;
    if (wave && wave.posZ - game.z < 70) {
      const hp = smashing
        ? lerp(game.smash.hBefore, game.smash.hAfter, game.smash.progress)
        : wave.H;
      const hb = { x: 140, y: 250, w: 800, h: 34 };
      g.fillStyle = 'rgba(43,36,32,0.55)';
      g.fillRect(hb.x - 4, hb.y - 4, hb.w + 8, hb.h + 8);
      g.fillStyle = '#3A3128';
      g.fillRect(hb.x, hb.y, hb.w, hb.h);
      g.fillStyle = wave.isBoss ? '#C0392B' : '#6E8542';
      g.fillRect(hb.x, hb.y, hb.w * clamp(hp / wave.H, 0, 1), hb.h);
      g.font = 'bold 30px -apple-system, "PingFang SC", sans-serif';
      g.textAlign = 'center';
      g.fillStyle = '#FFF';
      const tag = wave.isBoss ? `烂蒜魔王 ${wave.phase}/${wave.phaseCount}` : '霉烂军团';
      g.fillText(`${tag}   ${Math.max(0, Math.round(hp))}`, hb.x + hb.w / 2, hb.y + hb.h / 2);
    }

    // 当前兵力(大军上方,吃门时弹一下)
    const pop = 1 + this.nPop * 0.25;
    g.save();
    g.translate(W / 2, this.armyY - 340);
    g.scale(pop, pop);
    g.font = 'bold 130px -apple-system, "PingFang SC", sans-serif';
    g.textAlign = 'center';
    g.textBaseline = 'middle';
    g.lineWidth = 16;
    g.strokeStyle = PALETTE.ink;
    g.strokeText(String(shownN), 0, 0);
    g.fillStyle = PALETTE.garlic;
    g.fillText(String(shownN), 0, 0);
    g.restore();
  }

  #drawResult(game) {
    const g = this.g;
    const r = game.result;
    g.fillStyle = 'rgba(20,16,14,0.66)';
    g.fillRect(0, 0, W, H);

    const panel = { x: 110, y: 620, w: W - 220, h: 700 };
    g.fillStyle = '#F7F1E3';
    g.fillRect(panel.x, panel.y, panel.w, panel.h);
    g.lineWidth = 10;
    g.strokeStyle = PALETTE.ink;
    g.strokeRect(panel.x, panel.y, panel.w, panel.h);

    g.textAlign = 'center';
    g.textBaseline = 'middle';
    g.fillStyle = PALETTE.ink;
    g.font = 'bold 96px -apple-system, "PingFang SC", sans-serif';
    g.fillText(r.win ? '通关!' : '失败', W / 2, panel.y + 130);

    if (r.win) {
      for (let i = 0; i < 3; i++) {
        g.font = '86px -apple-system, sans-serif';
        g.fillStyle = i < r.star ? '#F2C33B' : 'rgba(43,36,32,0.20)';
        g.fillText('★', W / 2 - 130 + i * 130, panel.y + 280);
      }
      g.font = 'bold 46px -apple-system, "PingFang SC", sans-serif';
      g.fillStyle = PALETTE.ink;
      g.fillText(`剩余兵力 ${r.nEnd}   峰值 ${r.nPeak}`, W / 2, panel.y + 410);
    } else {
      const wave = game.waves[game.result.failWave];
      g.font = 'bold 46px -apple-system, "PingFang SC", sans-serif';
      const need = wave ? Math.ceil(wave.H / game.level.k) : 0;
      g.fillText(`峰值兵力 ${r.nPeak}`, W / 2, panel.y + 280);
      if (wave) {
        g.fillStyle = '#C0392B';
        g.fillText(`撞击时 ${game.smash.nBefore} 兵，需要 ${need} 兵`, W / 2, panel.y + 360);
        g.fillStyle = 'rgba(43,36,32,0.6)';
        g.font = '38px -apple-system, "PingFang SC", sans-serif';
        g.fillText(`差 ${need - game.smash.nBefore} 兵 —— 换条路线试试`, W / 2, panel.y + 430);
      }
    }

    g.fillStyle = r.win ? '#4FA8E8' : '#C0392B';
    g.fillRect(BTN.x, BTN.y, BTN.w, BTN.h);
    g.lineWidth = 8;
    g.strokeStyle = PALETTE.ink;
    g.strokeRect(BTN.x, BTN.y, BTN.w, BTN.h);
    g.fillStyle = '#FFFFFF';
    g.font = 'bold 62px -apple-system, "PingFang SC", sans-serif';
    g.fillText(r.win ? (game.level.level >= 10 ? '再来一轮' : '下一关') : '重开', W / 2, BTN.y + BTN.h / 2);
  }
}
