// v2 局内状态机 —— 引擎无关。渲染层只读字段并消费 events。
// 核心闭环：出兵 → 自动射击 → 海量小怪迎面冲来 → 穿倍增门增强 → BOSS → 通关。
//
// 逻辑与表现解耦(《v2》§2.3)：击杀按火力 F 结算(数值可验算),
// 子弹只是视觉,不参与伤害计算 —— 否则弹道数一多,命中判定会成为性能与数值的双重噩梦。

import {
  clamp, firepower, singleTargetDps, applyGate, clampStats,
  expandGates, resolvePick, inLane, fMin,
} from './rules.js';

let uid = 0;

export class Game {
  constructor(tuning, level) {
    this.tuning = tuning;
    this.level = level;
    this.track = tuning.track;

    this.stats = clampStats({ ...tuning.start, ...(level.start || {}) });
    this.statsPeak = { ...this.stats };
    this.fPeak = firepower(this.stats);

    this.gates = expandGates(level.gates);
    this.gateIndex = 0;

    this.enemies = [];
    this.bullets = [];
    this.boss = level.boss ? { ...level.boss, hp: level.boss.hp, maxHp: level.boss.hp, phase: 1 } : null;
    this.bossActive = false;

    this.z = 0;
    this.centerX = 0;
    this.targetX = 0;

    this.spawnAcc = {};       // 每段怪流的生成累加器
    this.fireAcc = 0;         // 视觉子弹节奏
    this.leakAcc = 0;         // 漏怪累积:每 enemiesPerLoss 只才掉 1 兵(§7 宽容度的唯一旋钮)
    this.shieldT = 0;         // 掉兵后的红闪计时,纯视觉,不免疫伤害
    this.killCount = 0;
    this.leakCount = 0;

    this.time = 0;
    this.state = 'running';   // running | boss | win | fail
    this.events = [];
    this.result = null;
  }

  get progress() { return clamp(this.z / this.level.trackLength, 0, 1); }
  get F() { return firepower(this.stats); }
  get dpsSingle() { return singleTargetDps(this.stats); }

  /** 当前所处的怪流段(可能多段重叠)。 */
  get activeWaves() {
    return (this.level.waves || []).filter(w => this.z >= w.from && this.z <= w.to);
  }

  /** 当前这一刻的火力缺口,给 HUD 做"火力告警"用。 */
  get demand() {
    let need = 0;
    for (const w of this.activeWaves) need += fMin(w);
    return need;
  }

  dragBy(dx) {
    const half = this.track.width / 2;
    this.targetX = clamp(this.targetX + dx, -half, half);
  }

  update(dt) {
    this.events.length = 0;
    if (this.state === 'win' || this.state === 'fail') return;
    this.time += dt;
    if (this.shieldT > 0) this.shieldT -= dt;

    // 跟手平滑(帧率无关)
    const t = 1 - Math.pow(1 - this.tuning.followSmooth, dt * 60);
    this.centerX += (this.targetX - this.centerX) * t;

    if (this.state !== 'boss') {
      this.z += this.tuning.forwardSpeed * dt;
      this.#triggerGates();
      this.#spawnWaves(dt);
    }

    this.#moveEnemies(dt);
    this.#shoot(dt);
    this.#updateBullets(dt);
    this.#contact(dt);
    this.#checkBoss();
    this.#checkEnd();
  }

  // —— 门 ——
  #triggerGates() {
    while (this.gateIndex < this.gates.length && this.gates[this.gateIndex].posZ <= this.z) {
      const gate = this.gates[this.gateIndex++];
      const effect = gate.type === 'pick'
        ? resolvePick(gate, this.centerX, this.track)
        : (inLane(this.centerX, gate.side, this.track) ? gate : null);
      if (!effect) continue;

      const before = { ...this.stats };
      this.stats = applyGate(this.stats, effect);
      for (const k of ['N', 'L', 'R', 'D']) {
        if (this.stats[k] > this.statsPeak[k]) this.statsPeak[k] = this.stats[k];
      }
      this.fPeak = Math.max(this.fPeak, this.F);
      this.events.push({ kind: 'gate', gate, effect, before, after: { ...this.stats } });

      if (this.stats.N <= 0) this.#fail('trap');
    }
  }

  // —— 怪流生成(§3.1 按 λ 只/秒) ——
  #spawnWaves(dt) {
    for (const w of this.activeWaves) {
      const key = `${w.from}_${w.type}`;
      this.spawnAcc[key] = (this.spawnAcc[key] || 0) + w.lambda * dt;
      while (this.spawnAcc[key] >= 1) {
        this.spawnAcc[key] -= 1;
        if (this.enemies.length >= this.tuning.maxEnemies) break;
        const half = this.track.width / 2 - 1;
        this.enemies.push({
          id: ++uid,
          x: (Math.random() * 2 - 1) * half,
          z: this.z + this.tuning.spawnAhead,
          hp: w.hp, maxHp: w.hp,
          type: w.type,
          speed: this.tuning.enemySpeed * (w.speedMul || 1),
        });
      }
    }
  }

  #moveEnemies(dt) {
    for (const e of this.enemies) e.z -= e.speed * dt;
  }

  // —— 射击结算(§2.2)：L 条弹道各锁一个目标,每个目标每秒吃 单目标DPS ——
  #shoot(dt) {
    if (this.bossActive && this.boss) {
      this.boss.hp -= this.dpsSingle * dt;   // BOSS 是单体,L 不起作用
      if (this.boss.hp <= 0) {
        this.events.push({ kind: 'bossDown', boss: this.boss });
        this.bossActive = false;
        this.boss = null;
        this.state = 'running';
      }
      return;
    }
    if (this.enemies.length === 0) return;

    // 最近的 L 只作为当前目标
    this.enemies.sort((a, b) => a.z - b.z);
    const lanes = Math.min(this.stats.L, this.enemies.length);
    const dmg = this.dpsSingle * dt;
    let killed = 0;
    for (let i = 0; i < lanes; i++) {
      const e = this.enemies[i];
      e.hp -= dmg;
      if (e.hp <= 0) {
        e.dead = true;
        killed++;
        this.events.push({ kind: 'kill', x: e.x, z: e.z, type: e.type });
      }
    }
    if (killed) {
      this.enemies = this.enemies.filter(e => !e.dead);
      this.killCount += killed;
    }
  }

  // —— 视觉子弹(纯表现,不参与伤害) ——
  #updateBullets(dt) {
    this.fireAcc += this.stats.R * (this.tuning.bulletRateMul || 1) * dt;
    const lanes = Math.min(this.stats.L, this.tuning.maxBulletLanes);
    while (this.fireAcc >= 1) {
      this.fireAcc -= 1;
      const targets = this.bossActive
        ? [{ x: 0, z: this.z + this.tuning.bossStandZ }]
        : this.enemies.slice(0, lanes);
      for (let i = 0; i < lanes; i++) {
        if (this.bullets.length >= this.tuning.maxBullets) break;
        const tgt = targets[i] || targets[0];
        const spread = (i - (lanes - 1) / 2) * 0.9;
        this.bullets.push({
          x: this.centerX + spread, z: this.z + 1.5,
          tx: tgt ? tgt.x : this.centerX + spread,
          tz: tgt ? tgt.z : this.z + 40,
        });
      }
    }
    const sp = this.tuning.bulletSpeed * dt;
    for (const b of this.bullets) {
      const dz = b.tz - b.z, dx = b.tx - b.x;
      const d = Math.hypot(dx, dz) || 1;
      b.z += (dz / d) * sp;
      b.x += (dx / d) * sp;
      if (d < 1.2 || b.z > this.z + this.tuning.spawnAhead + 8) b.done = true;
    }
    if (this.bullets.some(b => b.done)) this.bullets = this.bullets.filter(b => !b.done);
  }

  // —— 接触掉兵(§7 宽容:掉兵不立死,掉后给无敌) ——
  #contact(dt) {
    const line = this.z + this.tuning.contactZ;
    let hit = 0;
    for (const e of this.enemies) {
      if (e.z <= line) { e.dead = true; hit++; }
    }
    if (hit) {
      this.enemies = this.enemies.filter(e => !e.dead);
      this.leakCount += hit;
      // 掉兵与漏怪数成正比。早期版本用「掉兵后无敌 N 秒」,结果护盾期漏掉的怪全免费,
      // 漏 400 只只掉十几兵 —— 压力被吃干净,故改为累积模型。
      this.leakAcc += hit;
      let loss = 0;
      while (this.leakAcc >= this.tuning.enemiesPerLoss) { this.leakAcc -= this.tuning.enemiesPerLoss; loss++; }
      if (loss) {
        this.stats = clampStats({ ...this.stats, N: this.stats.N - loss });
        this.shieldT = this.tuning.hitFlashS;
        this.events.push({ kind: 'leak', count: hit, loss });
        if (this.stats.N <= 0) this.#fail('overrun');
      }
    }
    // BOSS 压迫:BOSS 战期间持续掉兵,逼玩家靠 DPS 速杀
    if (this.bossActive && this.boss) {
      this.bossDmgAcc = (this.bossDmgAcc || 0) + this.boss.dps * dt;
      while (this.bossDmgAcc >= 1) {
        this.bossDmgAcc -= 1;
        this.stats = clampStats({ ...this.stats, N: this.stats.N - 1 });
        this.events.push({ kind: 'bossHit' });
        if (this.stats.N <= 0) { this.#fail('boss'); return; }
      }
    }
  }

  #checkBoss() {
    if (this.boss && !this.bossActive && this.z >= this.boss.posZ) {
      this.bossActive = true;
      this.state = 'boss';
      this.events.push({ kind: 'bossIn', boss: this.boss });
    }
  }

  #checkEnd() {
    if (this.state === 'fail' || this.state === 'win') return;
    if (this.bossActive) return;
    if (this.z >= this.level.trackLength && !this.boss) this.#win();
  }

  #win() {
    this.state = 'win';
    this.result = {
      win: true, fPeak: this.fPeak, targetF: this.level.targetF,
      ratio: this.fPeak / this.level.targetF,
      stats: { ...this.stats }, kills: this.killCount, leaks: this.leakCount,
      time: +this.time.toFixed(1),
    };
  }

  #fail(reason) {
    this.state = 'fail';
    this.stats = clampStats({ ...this.stats, N: 0 });
    this.result = {
      win: false, reason, fPeak: this.fPeak, targetF: this.level.targetF,
      kills: this.killCount, leaks: this.leakCount, time: +this.time.toFixed(1),
    };
  }
}
