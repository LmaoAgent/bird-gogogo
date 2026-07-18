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

    // 闸门(参考素材里横在路上写着 621 的那道):必须用火力打空才能通过,纯火力检验点
    this.barriers = (level.barriers || []).map(b => ({ ...b, maxHp: b.hp }));
    this.barrierIndex = 0;
    this.barrier = null;

    this.z = 0;
    this.centerX = 0;
    this.targetX = 0;

    // 分离力的邻域网格(见 #separate)。窗口跟着大军走,覆盖接触线到生成点。
    const cell = tuning.gridCell;
    this.gw = Math.ceil((this.track.width + 8) / cell);
    this.gh = Math.ceil((tuning.spawnAhead + 16) / cell);
    this.gHead = new Int32Array(this.gw * this.gh);
    this.gNext = new Int32Array(tuning.maxEnemies);
    this.gCell = new Int32Array(tuning.maxEnemies);

    this.spawnAcc = {};       // 每段怪流的生成累加器
    this.fireAcc = 0;         // 视觉子弹节奏
    this.bulletHits = [];     // 本帧子弹命中点(x,z 交替存),给表现层补命中闪光;纯视觉
    this.leakAcc = 0;         // 漏怪累积:每 enemiesPerLoss 只才掉 1 兵(§7 宽容度的唯一旋钮)
    this.shieldT = 0;         // 掉兵后的红闪计时,纯视觉,不免疫伤害
    this.boostT = 0;          // 突破冲刺:加速前进 + 撞上来的怪只碾不掉兵
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
    this.bulletHits.length = 0;
    if (this.state === 'win' || this.state === 'fail') return;
    this.time += dt;
    if (this.shieldT > 0) this.shieldT -= dt;
    if (this.boostT > 0) this.boostT -= dt;

    // 跟手平滑(帧率无关)
    const t = 1 - Math.pow(1 - this.tuning.followSmooth, dt * 60);
    this.centerX += (this.targetX - this.centerX) * t;

    // 闸门与 BOSS 都会把大军钉在原地,但怪流照常涌来 —— 卡住越久越危险
    if (this.state !== 'boss' && this.state !== 'barrier') {
      const boost = this.boostT > 0 ? this.tuning.breakBoostSpeedMul : 1;
      this.z += this.tuning.forwardSpeed * boost * dt;
      this.#triggerGates();
    }
    if (this.state !== 'boss') this.#spawnWaves(dt);
    this.#checkBarrier();

    this.#moveEnemies(dt);
    this.#separate();
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

  // —— 怪流生成(§3.1 按 λ 排/秒,每排 rowSize 只) ——
  // 参考素材:敌军是铺满赛道的一排排,不是零散个体。按排生成才有"红色海洋"的压迫感。
  #spawnWaves(dt) {
    for (const w of this.activeWaves) {
      const key = `${w.from}_${w.type}`;
      const rowSize = w.rowSize || 1;
      this.spawnAcc[key] = (this.spawnAcc[key] || 0) + w.lambda * dt;
      while (this.spawnAcc[key] >= 1) {
        this.spawnAcc[key] -= 1;
        const half = this.track.width / 2 - 1;
        for (let k = 0; k < rowSize; k++) {
          if (this.enemies.length >= this.tuning.maxEnemies) break;
          const t = rowSize === 1 ? Math.random() * 2 - 1 : (k / (rowSize - 1)) * 2 - 1;
          this.enemies.push({
            id: ++uid,
            x: t * half + (Math.random() - 0.5) * 0.7,      // 轻微抖动,免得排得像尺子
            z: this.z + this.tuning.spawnAhead + (Math.random() - 0.5) * 2.5,
            hp: w.hp, maxHp: w.hp,
            type: w.type,
            speed: this.tuning.enemySpeed * (w.speedMul || 1),
          });
        }
      }
    }
  }

  /** 到达闸门就钉住,火力全部转移到闸门上(§参考素材的 621 闸门)。 */
  #checkBarrier() {
    if (this.barrier || this.state === 'boss') return;
    const b = this.barriers[this.barrierIndex];
    if (b && this.z >= b.posZ - this.tuning.barrierStopZ) {
      this.barrier = b;
      this.state = 'barrier';
      this.events.push({ kind: 'barrierIn', barrier: b });
    }
  }

  /**
   * 突破冲击波 —— 门被打穿的力道沿赛道向前炸开,清掉门后堆积的怪。
   *
   * 没有它的时候:堆在门后的 260 只(maxEnemies 上限)同时恢复前进,0.4 秒内全部撞进大军,
   * 按「每 3 只掉 1 兵」直接扣光兵力。堆得越久死得越惨 —— 惩罚了认真打门的玩家,方向是反的。
   *
   * 伤害随距离线性衰减:门口秒杀、边缘重伤。关键是与 maxHp 挂钩的是**杀伤半径**而不是杀伤总量 ——
   * 堆 20 只还是 260 只,贴门那一片同样被清空,「拖延 = 必死」的正反馈就此断掉(验收③)。
   */
  #breakthrough(b) {
    const { breakWaveRange: range, breakWaveDamage, releaseBatchInterval, releaseBatchSize } = this.tuning;
    const peak = b.maxHp * breakWaveDamage;

    const survivors = [];
    for (const e of this.enemies) {
      const d = Math.max(0, e.z - b.posZ);
      if (d > range) { survivors.push(e); continue; }
      e.hp -= peak * (1 - d / range);
      if (e.hp <= 0) {
        e.dead = true;
        this.events.push({ kind: 'kill', x: e.x, z: e.z, type: e.type, by: 'wave' });
      } else {
        survivors.push(e);
      }
    }
    const before = this.enemies.length;
    this.enemies = this.enemies.filter(e => !e.dead);
    const killed = before - this.enemies.length;
    this.killCount += killed;

    // 冲击波没清掉的(含波及范围外那一堆积压):近的先走,每 releaseBatchInterval 放一批。
    // 这一步不是装饰 —— 把到达速率压到大军啃得动的量级,火力 46% 档的破门损失从 23% 掉到 2%。
    // 冻住的怪照样能被打、被撞,只是不再一起压上来,所以不会变成"免费时间"。
    survivors.sort((p, q) => p.z - q.z);
    survivors.forEach((e, i) => { e.holdT = Math.floor(i / releaseBatchSize) * releaseBatchInterval; });

    this.boostT = this.tuning.breakBoostS;
    this.events.push({ kind: 'breakWave', z: b.posZ, range, killed, held: survivors.length });
  }

  // 闸门立着时把怪拦在门后堆积(素材里那片被拦住的红色海洋),打穿后按批放行 —— 张力全在这一下。
  #moveEnemies(dt) {
    const bz = this.barrier ? this.barrier.posZ : null;
    for (const e of this.enemies) {
      if (e.holdT > 0) { e.holdT -= dt; continue; }   // 突破后分批放行,见 #breakthrough
      const next = e.z - e.speed * dt;
      e.z = bz !== null && next < bz ? bz : next;
    }
  }

  /**
   * 邻接分离(§4.6)：重叠的怪沿连线互推开,挤而不叠 —— 素材里那片铺满赛道的红色海洋。
   *
   * 用位置直接修正(推开重叠量的一半)而不是加速度:门后两百多只全被钉在同一个 z 上,
   * 力式松弛要几十帧才铺得开,玩家看到的是"先穿模再慢慢散";直接改位置一帧就挤实。
   *
   * 邻域查询用固定网格 + 链表桶(gHead 存每格的首个下标,gNext 串起同格其余的),每帧零分配。
   * 300 只约 4000 次距离比较,O(n²) 则是 45000 次。格边长必须 ≥ 2×enemyRadius,
   * 否则相邻 9 格盖不住作用域,会漏判成穿模。
   *
   * 红线:这里只改 x/z。击杀仍由 #shoot 按 F 结算、漏怪仍由 #contact 按 contactZ 判定 ——
   * 分离力是堆叠形态,不是新的判定口径。
   */
  #separate() {
    const n = this.enemies.length;
    if (n < 2) return;
    const { enemyRadius, separationForce, gridCell } = this.tuning;
    const { gw, gh, gHead, gNext, gCell } = this;
    const ox = this.track.width / 2 + 4;   // x 原点左移到赛道外沿,挤到边界的也有格可落
    const oz = this.z - 10;                // z 窗口起点,跟着大军走

    gHead.fill(-1);
    for (let i = 0; i < n; i++) {
      const e = this.enemies[i];
      const cx = clamp((e.x + ox) / gridCell | 0, 0, gw - 1);
      const cz = clamp((e.z - oz) / gridCell | 0, 0, gh - 1);
      const c = cz * gw + cx;
      gCell[i] = c;
      gNext[i] = gHead[c];
      gHead[c] = i;
    }

    const dmin = enemyRadius * 2;
    for (let i = 0; i < n; i++) {
      const a = this.enemies[i];
      const cx = gCell[i] % gw, cz = (gCell[i] / gw) | 0;
      const gx0 = cx > 0 ? cx - 1 : 0, gx1 = cx < gw - 1 ? cx + 1 : gw - 1;
      const gz1 = cz < gh - 1 ? cz + 1 : gh - 1;
      for (let gz = cz > 0 ? cz - 1 : 0; gz <= gz1; gz++) {
        for (let gx = gx0; gx <= gx1; gx++) {
          for (let j = gHead[gz * gw + gx]; j >= 0; j = gNext[j]) {
            if (j <= i) continue;                     // 每对只解一次
            const b = this.enemies[j];
            const dx = b.x - a.x, dz = b.z - a.z;
            const d2 = dx * dx + dz * dz;
            if (d2 >= dmin * dmin) continue;
            if (d2 > 0) {
              const d = Math.sqrt(d2);
              const push = (dmin - d) * 0.5 * separationForce / d;   // 各让一半
              a.x -= dx * push; a.z -= dz * push;
              b.x += dx * push; b.z += dz * push;
            }
            // 同层(dz≈0)的一对,连线是水平的 → 上面那一推全落在 x 上。赛道宽度一饱和就锁死:
            // 挤不开也退不了,只剩穿模(实测门后 90 只叠进同一层)。让排在后面的那只向后让一步,
            // 队伍才会一层层往后长成墙。
            // 靠下标定"谁在后面"两种情形都成立:打门时数组是生成序(先生成的先到门口),
            // 平时上一帧 #shoot 已按 z 升序排过(近的在前),j > i 都意味着 b 在 a 后面。
            if (dz < enemyRadius && dz > -enemyRadius) {
              b.z += (enemyRadius - (dz < 0 ? -dz : dz)) * separationForce;
            }
          }
        }
      }
    }

    // 硬约束放在分离之后:推挤不能把怪挤出赛道,也不能挤穿立着的闸门。
    // 两侧路沿成了墙,堆积才会向后长成一层层的厚墙,而不是从两边漏掉。
    const lim = this.track.width / 2;
    const bz = this.barrier ? this.barrier.posZ : null;
    for (const e of this.enemies) {
      e.x = clamp(e.x, -lim, lim);
      if (bz !== null && e.z < bz) e.z = bz;
    }
  }

  // —— 射击结算(§2.2)：L 条弹道各锁一个目标,每个目标每秒吃 单目标DPS ——
  #shoot(dt) {
    // 闸门是横跨赛道的单一大目标,L 条弹道全打得上 → 吃总火力 F。
    // 打闸门期间不清怪,怪会堆积 —— 火力不够就会被卡在门前淹掉,这就是它作为检验点的意义。
    if (this.barrier) {
      this.barrier.hp -= this.F * dt;
      if (this.barrier.hp <= 0) {
        this.events.push({ kind: 'barrierDown', barrier: this.barrier });
        this.#breakthrough(this.barrier);
        this.barrier = null;
        this.barrierIndex++;
        this.state = 'running';
      }
      return;
    }
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
    // 集火单体(闸门/BOSS)时把弹道视觉铺开 —— 否则 L 小的时候只有两条线打在门上,太寒酸。
    // 纯表现,不影响伤害(伤害始终由 F / 单目标DPS 决定)。
    const focus = this.barrier || this.bossActive;
    const lanes = Math.min(
      focus ? Math.max(this.stats.L, this.tuning.focusLanesMin) : this.stats.L,
      this.tuning.maxBulletLanes,
    );
    // 起点按固定总宽铺开(而不是固定间距):L=2 时也是左右两翼开火,而不是挤在正中一条缝里。
    const fan = this.tuning.bulletFanW * (focus ? this.tuning.focusFanMul : 1);

    // 目标沿纵深铺开:只锁最近那几只的话,弹道全挤在大军脸前 80px 的一段里,寿命 50ms ——
    // 射速再高也只是原地闪,堆不出"流"。取 bulletTargetDepth 之内的前排均匀分配目标,
    // 弹幕才会拉成贯穿画面的一片。深度封顶是因为子弹瞄的是发射瞬间的坐标:打太远怪已经走开,
    // 闪光会落在空地上。
    let hi = 0;
    if (!focus) {
      const zMax = this.z + this.tuning.bulletTargetDepth;   // enemies 已由 #shoot 按 z 升序排好
      while (hi < this.enemies.length && this.enemies[hi].z <= zMax) hi++;
      // 整群都在深度之外时(刚刷出来那一下)也要打最近那只:否则一边看得见怪、一边对着空地开火
      if (hi === 0 && this.enemies.length) hi = 1;
    }
    while (this.fireAcc >= 1) {
      this.fireAcc -= 1;
      for (let i = 0; i < lanes; i++) {
        if (this.bullets.length >= this.tuning.maxBullets) break;
        const x = this.centerX + (lanes > 1 ? (i / (lanes - 1) - 0.5) * fan : 0);
        let tx, tz;
        if (this.barrier) {
          tx = x; tz = this.barrier.posZ;                    // 门横跨赛道,各打各的正前方 → 一整排撞击
        } else if (this.bossActive) {
          // BOSS 是单体,弹道收拢到它身上;留两成散布,免得全打同一个点烧成一坨白斑
          tx = x * 0.2; tz = this.z + this.tuning.bossStandZ;
        } else if (hi > 0) {
          const e = this.enemies[Math.min(hi - 1, (i * hi / lanes) | 0)];
          tx = e.x; tz = e.z;
        } else {
          tx = x; tz = this.z + 40;                          // 场上没怪也照打,免得空窗期画面死掉
        }
        this.bullets.push({ x, z: this.z + 1.5, tx, tz });
      }
    }
    const sp = this.tuning.bulletSpeed * dt;
    for (const b of this.bullets) {
      const dz = b.tz - b.z, dx = b.tx - b.x;
      const d = Math.hypot(dx, dz) || 1;
      b.z += (dz / d) * sp;
      b.x += (dx / d) * sp;
      if (d < 1.2) { b.done = true; this.bulletHits.push(b.tx, b.tz); }   // 命中点给表现层补闪光
      else if (b.z > this.z + this.tuning.spawnAhead + 8) b.done = true;
    }
    if (this.bullets.some(b => b.done)) this.bullets = this.bullets.filter(b => !b.done);
  }

  // —— 接触掉兵(§7 宽容:掉兵不立死,掉后给无敌) ——
  #contact(dt) {
    const line = this.z + this.tuning.contactZ;
    const xs = [];               // 撞击点,给表现层做大军推挤(§V2-3)
    for (const e of this.enemies) {
      if (e.z <= line) { e.dead = true; xs.push(e.x); }
    }
    const hit = xs.length;
    if (hit) {
      this.enemies = this.enemies.filter(e => !e.dead);
      // 突破冲刺期:撞上来的怪被碾碎而不是撞掉兵。打穿门的奖励是"冲出去",不是"被埋住"。
      // 这里是无敌窗口而非全局宽容,所以不会重蹈「护盾期漏怪全免费」的覆辙。
      if (this.boostT > 0) {
        this.killCount += hit;
        this.events.push({ kind: 'trample', count: hit, xs });
      } else {
        this.leakCount += hit;
        // 掉兵与漏怪数成正比。早期版本用「掉兵后无敌 N 秒」,结果护盾期漏掉的怪全免费,
        // 漏 400 只只掉十几兵 —— 压力被吃干净,故改为累积模型。
        this.leakAcc += hit;
        let loss = 0;
        while (this.leakAcc >= this.tuning.enemiesPerLoss) { this.leakAcc -= this.tuning.enemiesPerLoss; loss++; }
        // loss 可能为 0(还没凑够掉兵):照样报事件,撞击手感由表现层决定,红闪飘字仍只在真掉兵时给
        this.events.push({ kind: 'leak', count: hit, loss, xs });
        if (loss) {
          this.stats = clampStats({ ...this.stats, N: this.stats.N - loss });
          this.shieldT = this.tuning.hitFlashS;
          if (this.stats.N <= 0) this.#fail('overrun');
        }
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
