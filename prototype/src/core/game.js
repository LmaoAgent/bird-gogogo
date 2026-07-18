// 局内状态机 —— 引擎无关。渲染层只读它的字段并消费 events。
// 核心闭环(交接说明 §6)：出兵 N0 → 拖动吃门累加 N → 撞击按 N≥H/k 判定 → 通关/失败。

import {
  clamp, applyGateEffect, inLane, resolvePick, expandGates,
  resolveSmash, smashDuration, buildWaves, starRating,
} from './rules.js';

export class Game {
  constructor(tuning, level) {
    this.tuning = tuning;
    this.level = level;
    this.track = tuning.track;

    this.gates = expandGates(level.gates);
    this.waves = buildWaves(level);

    this.n = tuning.startArmy;      // 实时兵力
    this.nPeak = this.n;            // 本局峰值(星级用,§6)
    this.z = 0;                     // 大军纵深
    this.centerX = 0;               // 队形中心 X(§1)
    this.targetX = 0;               // 跟手目标

    this.gateIndex = 0;
    this.waveIndex = 0;
    this.state = 'running';         // running | smashing | win | fail
    this.smash = null;
    this.smashTimer = 0;
    this.events = [];               // 每帧事件,渲染层消费
    this.result = null;
  }

  get progress() {
    return clamp(this.z / this.level.trackLength, 0, 1);
  }

  /** 当前正在对抗/即将对抗的波次,供 HUD 血条使用。 */
  get currentWave() {
    return this.waves[this.waveIndex] || null;
  }

  /** 输入层调用：按世界坐标增量拖动队形中心,夹取在赛道内(§1)。 */
  dragBy(deltaWorldX) {
    const half = this.track.width / 2;
    this.targetX = clamp(this.targetX + deltaWorldX, -half, half);
  }

  update(dt) {
    this.events.length = 0;
    if (this.state === 'win' || this.state === 'fail') return;

    // 跟手平滑(§1)。文档给的是逐帧 lerp 系数,这里换算成帧率无关形式。
    const t = 1 - Math.pow(1 - this.tuning.followSmooth, dt * 60);
    this.centerX += (this.targetX - this.centerX) * t;

    if (this.state === 'smashing') {
      this.smashTimer -= dt;
      this.smash.progress = clamp(1 - this.smashTimer / this.smash.duration, 0, 1);
      if (this.smashTimer <= 0) this.#finishSmash();
      return;
    }

    this.z += this.tuning.forwardSpeed * dt;

    while (this.gateIndex < this.gates.length && this.gates[this.gateIndex].posZ <= this.z) {
      this.#triggerGate(this.gates[this.gateIndex]);
      this.gateIndex++;
      if (this.state === 'fail') return;
    }

    const wave = this.currentWave;
    if (wave && this.z >= wave.posZ) { this.#beginSmash(wave); return; }

    if (!wave && this.z >= this.level.trackLength) this.#win();
  }

  #triggerGate(gate) {
    const effect = gate.type === 'pick'
      ? resolvePick(gate, this.centerX, this.track)
      : (inLane(this.centerX, gate.side, this.track) ? gate : null);
    if (!effect) return;

    const before = this.n;
    this.n = applyGateEffect(this.n, effect);
    this.nPeak = Math.max(this.nPeak, this.n);
    this.events.push({ kind: 'gate', gate, effect, before, after: this.n });

    // 陷阱把兵力扣光即判负(§6)
    if (this.n <= 0) this.#fail(null);
  }

  #beginSmash(wave) {
    const res = resolveSmash(this.n, wave.H, this.level.k);
    this.state = 'smashing';
    this.smash = {
      wave,
      duration: smashDuration(wave.H, this.n, this.tuning.combat),
      breakthrough: res.breakthrough,
      nBefore: this.n,
      nAfter: res.nAfter,
      hBefore: wave.H,
      // 失败时敌方只被打掉 N·k 血,残血用于血条演出
      hAfter: res.breakthrough ? 0 : Math.max(0, wave.H - this.n * this.level.k),
      progress: 0,
    };
    this.smashTimer = this.smash.duration;
    this.events.push({ kind: 'smashStart', smash: this.smash });
  }

  #finishSmash() {
    const s = this.smash;
    this.n = s.nAfter;
    this.events.push({ kind: 'smashEnd', smash: s });

    if (!s.breakthrough) { this.#fail(s.wave); return; }
    // §6 胜利要求抵达终点时 N > 0：兵力恰好被耗尽同样判负
    if (this.n <= 0) { this.#fail(s.wave); return; }

    this.waveIndex++;
    this.smash = null;
    this.state = 'running';
  }

  #win() {
    this.state = 'win';
    const thresholds = this.level.star || this.tuning.star;
    this.result = {
      win: true, nEnd: this.n, nPeak: this.nPeak,
      ratio: this.nPeak / this.level.targetN,   // 最优度,结算页展示用
      star: starRating(this.nPeak, this.level.targetN, thresholds),
    };
  }

  #fail(wave) {
    this.state = 'fail';
    this.n = 0;
    this.result = {
      win: false, nEnd: 0, nPeak: this.nPeak, star: 0,
      failWave: wave ? this.waveIndex : -1,
    };
  }
}
