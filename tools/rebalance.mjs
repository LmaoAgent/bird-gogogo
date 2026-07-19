// 按「最优路线的实际火力曲线」反推怪流强度,替代手工瞎猜。
// 做法:贪心跑一遍记录 F(z),把赛道切成若干段,每段取该段 F 中位数 × 压力系数作为 F_min,
// 再拆成 (λ, hp)。hp 随关卡递增(逼玩家堆 D),λ = F_min / hp。
import { readFileSync, writeFileSync } from 'node:fs';
import { pathToFileURL, fileURLToPath } from 'node:url';

const B = fileURLToPath(new URL('../prototype-v2/', import.meta.url));
const { Game } = await import(pathToFileURL(B + 'src/core/game.js').href);
const { applyGate, firepower } = await import(pathToFileURL(B + 'src/core/rules.js').href);
const tuning = JSON.parse(readFileSync(B + 'config/tuning.json', 'utf8'));
const levels = JSON.parse(readFileSync(B + 'config/levels.json', 'utf8'));

const greedy = (gate, s) => {
  if (gate.type === 'pick') {
    let best = gate.options[0].side, bf = -1;
    for (const o of gate.options) { const f = firepower(applyGate(s, o)); if (f > bf) { bf = f; best = o.side; } }
    return best;
  }
  return firepower(applyGate(s, gate)) > firepower(s) ? gate.side : (gate.side === 'center' ? 'left' : 'center');
};

// 无怪空跑,拿纯净的 F(z) 曲线(有怪会掉兵,污染曲线)
function curve(level) {
  const bare = { ...level, waves: [], boss: null, barriers: [] };
  const g = new Game(tuning, bare);
  const dt = 1 / 60, pts = [];
  for (let i = 0; i < 60 * 120 && g.z < level.trackLength; i++) {
    const next = g.gates.find(gt => gt.posZ > g.z);
    if (next) g.targetX = tuning.track.laneX[greedy(next, g.stats)];
    g.update(dt);
    pts.push({ z: g.z, F: firepower(g.stats), dps: g.stats.N * g.stats.D * g.stats.R });
  }
  return pts;
}

// 每关的压力系数:教学宽松 → 后期收紧
const PRESSURE = { 1: 0.50, 2: 0.72, 3: 0.88, 4: 0.98, 5: 0.95, 6: 1.08 };
// 单怪血:随关卡递增,逼玩家不能只堆弹道
const HP = { 1: 10, 2: 16, 3: 22, 4: 30, 5: 34, 6: 42 };
// 每排几只 —— 素材里敌军是铺满赛道的一排排,不是零散个体
const ROW = { 1: 7, 2: 8, 3: 9, 4: 10, 5: 10, 6: 12 };
const BARRIER_SEC = 2.5;   // 火力达标者撕开闸门的目标耗时

for (const lv of levels) {
  const pts = curve(lv);
  const L = lv.trackLength;
  const segs = lv.boss
    ? [[0.10, 0.42], [0.46, 0.80]]                 // BOSS 关末段留给 BOSS
    : [[0.10, 0.38], [0.42, 0.68], [0.70, 0.98]];
  const k = PRESSURE[lv.level], hp = HP[lv.level];
  const waves = [];
  for (const [a, b] of segs) {
    const from = Math.round(L * a), to = Math.round(L * b);
    const inSeg = pts.filter(p => p.z >= from && p.z <= to).map(p => p.F).sort((x, y) => x - y);
    if (!inSeg.length) continue;
    const med = inSeg[Math.floor(inSeg.length * 0.5)];
    const fMin = med * k;
    const rowSize = ROW[lv.level];
    waves.push({ from, to, lambda: +(fMin / (rowSize * hp)).toFixed(2), rowSize, hp, type: 'moldling' });
  }
  // 中段换成厚皮怪(考验 D)——第 4 关起
  if (lv.level >= 4 && waves.length >= 2) {
    const w = waves[1];
    w.type = 'thick'; w.speedMul = 0.7;
    w.hp = hp * 3; w.lambda = +(w.lambda / 3).toFixed(2);
  }
  lv.waves = waves;
  lv.targetF = Math.round(Math.max(...pts.map(p => p.F)));
  if (lv.boss) {
    // BOSS 血量 = 到达 BOSS 时的单目标 DPS × 目标击杀时长(6秒),给持续输出的压迫感
    const atBoss = pts.filter(p => p.z >= lv.boss.posZ - 5);
    const dps = atBoss.length ? atBoss[0].dps : pts[pts.length - 1].dps;
    lv.boss.hp = Math.round(dps * 4);
  }
  // 闸门血量 = 到达时的总火力 × 目标耗时
  for (const b of (lv.barriers || [])) {
    const at = pts.filter(p => p.z >= b.posZ - tuning.barrierStopZ);
    b.hp = Math.round((at.length ? at[0].F : pts[pts.length - 1].F) * BARRIER_SEC);
  }
  console.log(`关${lv.level}: targetF=${lv.targetF} hp=${hp} k=${k}` +
    (lv.boss ? ` bossHp=${lv.boss.hp}` : '') +
    ((lv.barriers || []).length ? ` 闸门${lv.barriers.map(b => b.hp).join('/')}` : '') +
    ' | ' + waves.map(w => `${w.type === 'thick' ? '厚' : ''}${w.rowSize}只/排×λ${w.lambda}×${w.hp}血=${Math.round(w.lambda * w.rowSize * w.hp)}`).join(' → '));
}

writeFileSync(B + 'config/levels.json', JSON.stringify(levels, null, 2) + '\n');
console.log('\n已写回 levels.json');
