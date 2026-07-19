// 按「参考最优路线的实际火力曲线」反推怪流强度,替代手工瞎猜。
// 手配的线性怪流对不上乘性增长的火力 —— 门是 ×2/×1.5 的,怪流按 +N 手配必然前段够不着、后段白送。
//
// 三条曲线各管一段,别混:
//   ① 基准曲线 bareCurve  —— 只留门的空跑,用来定**怪流 / 闸门 / BOSS / 桶的血量**。
//      必须把 waves/boss/barriers/**obstacles/barrels** 全摘掉(V7 修 #2):
//      障碍掉 18% 兵、桶给奖励又分火力,留着它们等于拿"被配平对象改过的火力"去配平自己,基准被污染。
//   ② 实战曲线(完整关卡跑参考最优路线) —— 用来定 **targetF** 与桶的**拾取时属性**。
//      口径见 route.mjs 顶部;一句话:targetF 是实跑测出来的峰值,不是公式估的。
//   ③ 体检 v2check.mjs  —— 只读不写,验收看它。

import { readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { makePolicy, runRoute, bestRoute, ENSEMBLE } from './route.mjs';
import { rewardGain, starRating, BARREL_REWARD_CAP, BARREL_REWARD_FLOOR } from '../prototype-v2/src/core/rules.js';

const B = fileURLToPath(new URL('../prototype-v2/', import.meta.url));
const tuning = JSON.parse(readFileSync(B + 'config/tuning.json', 'utf8'));
const levels = JSON.parse(readFileSync(B + 'config/levels.json', 'utf8'));

// —— 配平旋钮(这一屏就是全部;改完跑 v2check 验收) ——

/**
 * 压力 = 「按设计火力打完这一段,预期掉多少兵」。
 *
 * 不要用 k×中位火力当 F_min(V6 那版的做法):漏兵速率 = (k−1)·F/(enemiesPerLoss·hp),
 * 同一个 k 在不同 hp / 段长上差出几倍 —— k=1.24 在关 9 一段就要掉 65% 兵(实测漏 342 只、最优路线直接暴毙),
 * 而同样的 1.24 在关 1 只是挠痒。改成**按掉兵预算闭环校准**:横向可比,而且"压力"本来就是这个意思。
 *
 *   开环起点  F_min = 基准曲线该段中位火力 × RELAX
 *   闭环校准  实跑 → 掉兵比预算多就压 λ、少就抬 λ,直到落进预算带
 *
 * 为什么非闭环不可:基准曲线是**上界** —— 它没有漏怪掉兵、也没有为躲障碍丢掉的门。
 * 拿它的中位当"刚好不漏"的线,实跑必然漏成倍(关 11 开环预算 30 只、实测 415 只,4/8 个种子直接暴毙)。
 *
 * RELAX 只给教学两关:红线要求「一路不动」也能过教学关,而不动的人只吃得到中路墙,
 * 火力停在参考路线的三分之一,F_min 不压到那条线以下就是开局劝退。3 关起恒 1.0,交给闭环。
 */
const RELAX = { 1: 0.30, 2: 0.42 };
/**
 * 全关掉兵预算,按**全程中位兵力的百分比**记 —— 这条就是"教学宽松→后期收紧"的那根曲线。
 * 用占比而不是绝对只数:一路打下来大军从 60 涨到 180,同样"掉 20 兵"在关 3 是伤筋动骨、在关 12 是挠痒。
 */
const LOSS_PCT = {
  1: 0, 2: 0, 3: 0.03, 4: 0.04, 5: 0.05, 6: 0.06,
  7: 0.07, 8: 0.08, 9: 0.09, 10: 0.10, 11: 0.12, 12: 0.15,
};
// 单怪血:随关卡递增,逼玩家不能只堆弹道(L 多打得广,D 低就是打不动)
const HP = { 1: 10, 2: 16, 3: 22, 4: 30, 5: 34, 6: 42, 7: 46, 8: 50, 9: 54, 10: 58, 11: 62, 12: 66 };
// 每排几只 —— 素材里敌军是铺满赛道的一排排,不是零散个体
const ROW = { 1: 7, 2: 8, 3: 9, 4: 10, 5: 10, 6: 12, 7: 12, 8: 12, 9: 12, 10: 12, 11: 13, 12: 14 };

/**
 * 闸门目标耗时(秒):火力达标者撕开它要几秒。血量 = 到达时火力 × 这个数。
 * 教学两关取小值:不动者的火力只有参考路线的 1/2 ~ 1/3,同样的血量卡在门前的时间是几倍,
 * 门后堆的怪会把「教学关必过」直接吃掉。
 */
const BARRIER_SEC = { 1: 1.8, 2: 1.8, default: 2.6 };
const BOSS_SEC = { 5: 3.5, 10: 3.8 };     // BOSS 血量 = 到达时**单目标 DPS** × 这个数(L 在单体面前不起作用)
const BARREL_SEC = 1.1;                   // 桶血量 = 到达时火力 × barrelShare × 这个数(= 分神多久打得穿)

const secOf = (lv) => BARRIER_SEC[lv.level] ?? BARRIER_SEC.default;

// —— ① 基准曲线:只留门的空跑 ——

function bareCurve(level) {
  const bare = { ...level, waves: [], boss: null, barriers: [], obstacles: [], barrels: [] };
  let best = null;
  for (const depth of [1, 3, 5]) {
    const pts = [];
    const g = runRoute(tuning, bare, makePolicy({ depth, dodge: false, barrels: 'none' }),
      (gg) => pts.push({ z: gg.z, F: gg.F, dps: gg.dpsSingle, N: gg.stats.N }));
    // 掉兵预算的基数取**全程中位兵力**,不取峰值:末尾一道 N×2 能把峰值抬到 358,
    // 而整关九成时间是在 120 上下打的,拿峰值当基数等于凭空把预算翻三倍。
    if (!best || g.fPeak > best.fPeak) {
      const ns = pts.map(p => p.N).sort((a, b) => a - b);
      best = { fPeak: g.fPeak, pts, nTypical: ns[Math.floor(ns.length / 2)] };
    }
  }
  return best;
}

/** 曲线上 z 处的值(取第一个到达点;越界取末点)。 */
const at = (pts, z, key) => (pts.find(p => p.z >= z) ?? pts[pts.length - 1])[key];

// —— ② 桶奖励回填到收益区间 ——

/** `add` 类奖励的收益率 = value/dim,与拾取时该维多大成反比 → 只能按实跑快照回推。 */
function tuneAdd(stats, r) {
  const step = r.dim === 'N' || r.dim === 'L' ? 1 : 0.1;
  let best = null;
  for (let v = step; v <= stats[r.dim] * 0.6 + step; v += step) {
    const value = +v.toFixed(1);
    const gain = rewardGain(stats, { ...r, value });
    if (gain > BARREL_REWARD_CAP) break;
    if (gain >= BARREL_REWARD_FLOOR) best = { value, gain };
  }
  return best;
}

// —— 主流程 ——

const log = [];
for (const lv of levels) {
  const { pts, nTypical } = bareCurve(lv);
  const L = lv.trackLength;
  const segs = lv.boss
    ? [[0.10, 0.42], [0.46, 0.80]]                 // BOSS 关末段留给 BOSS
    : [[0.10, 0.38], [0.42, 0.68], [0.70, 0.98]];
  const relax = RELAX[lv.level] ?? 1, hp = HP[lv.level], rowSize = ROW[lv.level];

  const waves = [];
  for (const [a, b] of segs) {
    const from = Math.round(L * a), to = Math.round(L * b);
    const inSeg = pts.filter(p => p.z >= from && p.z <= to).map(p => p.F).sort((x, y) => x - y);
    if (!inSeg.length) continue;
    const med = inSeg[Math.floor(inSeg.length * 0.5)];
    waves.push({ from, to, lambda: +(med * relax / (rowSize * hp)).toFixed(2), rowSize, hp, type: 'moldling' });
  }
  // 中段换成厚皮怪(考验 D)——第 4 关起
  if (lv.level >= 4 && waves.length >= 2) {
    const w = waves[1];
    w.type = 'thick'; w.speedMul = 0.7;
    w.hp = hp * 3; w.lambda = +(w.lambda / 3).toFixed(2);
  }
  lv.waves = waves;

  for (const b of (lv.barriers || [])) b.hp = Math.round(at(pts, b.posZ - tuning.barrierStopZ, 'F') * secOf(lv));
  if (lv.boss) lv.boss.hp = Math.round(at(pts, lv.boss.posZ, 'dps') * BOSS_SEC[lv.level]);
  for (const b of (lv.barrels || [])) {
    b.hp = Math.round(at(pts, b.posZ, 'F') * tuning.barrelShare * BARREL_SEC);
    delete b.pickStats;                            // 上一轮的快照作废,这一轮实跑重取
  }

  // 闭环校准:整段 λ 乘一个系数,二分找到「掉兵刚好不超预算」的那个。
  //
  // 用二分不用比例控制器:漏怪→掉兵→火力→更漏怪 是正反馈,leaks(λ) 又陡又带悬崖,
  // 比例控制器一步能跳 3.4 倍(实测在 0 只和 431 只之间反复横跳,14 轮都收不住)。
  // 二分只要 leaks 对 λ 单调就必然收敛 —— 而它就是单调的(生成得多必然漏得多)。
  // 打不过 = 太难,记 +∞ 往下走。三个种子取中位,免得被某一次的怪位运气带偏。
  const budget = Math.round(LOSS_PCT[lv.level] * nTypical * tuning.enemiesPerLoss);
  let cal = 0;
  if (budget > 0) {
    const base = waves.map(w => w.lambda);
    // 每一步都重挑最优路线,不锁死在校准开始时那条:λ 一变,策略族里谁最强也会变
    // (关 12 校准完最优路线从"打桶"翻成"弃桶"),锁死就会照着一条已经不是最优的路线去配平。
    const measure = (s) => {
      waves.forEach((w, i) => { w.lambda = +(base[i] * s).toFixed(3); });
      return [1, 2, 3]
        .map(sd => { const r = bestRoute(tuning, lv, ENSEMBLE, sd); return r.g.state === 'win' ? r.g.leakCount : Infinity; })
        .sort((a, b) => a - b)[1];
    };
    let lo = 0.15, hi = 3.0;
    for (; cal < 12; cal++) {
      const mid = (lo + hi) / 2;
      if (measure(mid) > budget) hi = mid; else lo = mid;
    }
    measure(lo);                                   // 收在"不超预算"的那一侧
  }

  // ② 实战曲线:跑参考最优路线 → 桶的拾取快照 → 回填奖励 → 再跑(奖励会改属性,两遍收敛)
  let route = null;
  for (let pass = 0; pass < 3; pass++) {
    route = bestRoute(tuning, lv);
    const picked = {};
    const snap = (g) => { for (const ev of g.events) if (ev.kind === 'barrelBreak') picked[ev.barrel.id] = ev.before; };
    // 快照恒用"会打桶"的那条路线:问的是「拾取这个桶时属性多少」,本来就以打它为前提。
    // 最优路线弃桶时也要有快照,否则 barrelCost 判不了收益,反过来说"这桶不合法"。
    const take = { ...route.opt, barrels: 'late' };
    runRoute(tuning, lv, makePolicy(take), snap);
    // 同 z 并排的两个桶只来得及打一个:没被选中的那个,跑一条"选它"的路线补测拾取属性,
    // 否则设计好的二选一会被体检当成"够不着"。
    for (const b of (lv.barrels || [])) {
      if (picked[b.id]) continue;
      const sibs = lv.barrels.filter(x => x.id !== b.id && Math.abs(x.posZ - b.posZ) < 1e-6).map(x => x.id);
      if (sibs.length) runRoute(tuning, lv, makePolicy({ ...take, skip: sibs }), snap);
    }
    let changed = false;
    for (const b of (lv.barrels || [])) {
      const s = picked[b.id];
      if (!s) continue;                            // 这个桶最优路线没打(打不完/被弃),交给体检报不合法
      if (JSON.stringify(b.pickStats) !== JSON.stringify(s)) { b.pickStats = s; changed = true; }
      if (b.reward.op !== 'add') continue;
      const t = tuneAdd(s, b.reward);
      if (t && b.reward.value !== t.value) { b.reward.value = t.value; changed = true; }
    }
    if (!changed) break;
  }

  // ③ targetF ≡ 参考最优路线实跑的 fPeak(口径见 route.mjs)
  lv.targetF = Math.round(route.g.fPeak);

  const idle = runRoute(tuning, lv, () => 0);
  const noDodge = runRoute(tuning, lv, makePolicy({ ...route.opt, dodge: false }));
  const sub = runRoute(tuning, lv, makePolicy({ depth: route.opt.depth, dodge: false, barrels: 'none' }));
  const r = route.g.result || {};
  lv.measured = `最优 d${route.opt.depth}${route.opt.barrels === 'late' ? '+桶' : '(弃桶)'}: `
    + `${route.g.state === 'win' ? '通关' : '败于' + r.reason} fPeak ${Math.round(route.g.fPeak)} / ${(r.time ?? 0).toFixed(1)}s / `
    + `杀 ${r.kills ?? 0} 漏 ${r.leaks ?? 0} / ${starRating(route.g.fPeak, lv.targetF, tuning.star)}★`
    + ` | 不躲障碍 ${Math.round(noDodge.fPeak)}(${((noDodge.fPeak / route.g.fPeak - 1) * 100).toFixed(0)}%)`
    + ` | 次优(只吃门) ${sub.state === 'win' ? '通关' : '败'} ${Math.round(sub.fPeak)}=${starRating(sub.fPeak, lv.targetF, tuning.star)}★`
    + ` | 一路不动 ${idle.state === 'win' ? '通关' : `败于 z${Math.round(idle.z)}`}`;

  log.push(`关${String(lv.level).padStart(2)} targetF=${String(lv.targetF).padEnd(5)} 掉兵预算${(LOSS_PCT[lv.level] * 100).toFixed(0)}%×${nTypical}兵=漏${budget}只(校准${cal}轮) hp=${hp} row=${rowSize}`
    + (lv.boss ? ` bossHp=${lv.boss.hp}` : '')
    + ((lv.barriers || []).length ? ` 闸门${lv.barriers.map(b => b.hp).join('/')}` : '')
    + '\n     怪流 ' + waves.map(w => `${w.type === 'thick' ? '厚' : ''}${w.rowSize}只/排×λ${w.lambda}×${w.hp}血=${Math.round(w.lambda * w.rowSize * w.hp)}`).join(' → ')
    + ((lv.barrels || []).length ? '\n     油桶 ' + lv.barrels.map(b =>
      `${b.id}(hp${b.hp}→${b.reward.buff || b.reward.dim + (b.reward.op === 'mul' ? '×' : '+') + b.reward.value})`
      + (b.reward.buff ? ' 限时buff不进fPeak'
        : b.pickStats ? ` 拾取N=${b.pickStats.N} 收益${(rewardGain(b.pickStats, b.reward) * 100).toFixed(1)}%` : ' **未拾取**')).join(' ') : '')
    + '\n     ' + lv.measured);
}

console.log(log.join('\n'));
writeFileSync(B + 'config/levels.json', JSON.stringify(levels, null, 2) + '\n');
console.log('\n已写回 levels.json —— 验收跑 node tools/v2check.mjs');
