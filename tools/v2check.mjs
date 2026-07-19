// v2 数值体检 —— 只读不写,验收看它。rebalance.mjs 配平完跑这个。
//
// 三种走位(红线要求的那三条):
//   最优  = 参考最优路线(躲障碍 + 打得完的桶都打 + 门取火力最大分支),targetF 就是它的 fPeak
//   不动  = 一路不拖,targetX 恒在出生点。教学两关必过,3 关起必须全败
//   次优  = 只吃门,不躲障碍也不打桶(一个只学会"门"的玩家)
// 外加两项专项:
//   躲 vs 不躲 —— 同一条路线只翻转"躲不躲"这一个变量,躲必须更强(否则障碍的设计意义被数值抵消)
//   护栏      —— 障碍零余量(obstacleClearance)与桶收益线(barrelCost)
//
// 所有跑分定种子(见 route.mjs withSeed):不定种子的话怪位抖动能让 fPeak 摆 ±22%,对照全是噪声。

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { makePolicy, runRoute, bestRoute, idle, SEED } from './route.mjs';
import {
  fMin, starRating, obstacleClearance, barrelCost, barrierTime,
  OBSTACLE_MIN_CLEARANCE, BARREL_REWARD_CAP, BARREL_REWARD_FLOOR,
} from '../prototype-v2/src/core/rules.js';

const B = fileURLToPath(new URL('../prototype-v2/', import.meta.url));
const tuning = JSON.parse(readFileSync(B + 'config/tuning.json', 'utf8'));
const levels = JSON.parse(readFileSync(B + 'config/levels.json', 'utf8'));

const TIME_MIN = 30, TIME_MAX = 36;
// 冲击波至少要清掉门口两三排(排距 ≈ 1.2)。低于这个数,打门慢的玩家会被门后那堆原样埋掉 ——
// 「拖延 = 必死」的正反馈就是 V1 要断掉的那条。
const MIN_WAVE_RADIUS = 3;
const SEEDS = [1, 2, 3, 4, 5, 6, 7, 8];      // 噪声带:同配置换种子跑,看漏怪/结局稳不稳
const bad = [];
const fail = (msg) => { bad.push(msg); return '✗'; };

/** 一次跑分的摘要。obstacleHit / breakWave 从事件里捞,冲击波复核要用。 */
function stat(g, targetF) {
  const r = g.result || {};
  return {
    win: g.state === 'win',
    time: r.time ?? +g.time.toFixed(1),
    kills: r.kills ?? g.killCount,
    leaks: r.leaks ?? g.leakCount,
    fPeak: Math.round(g.fPeak),
    star: g.state === 'win' ? starRating(g.fPeak, targetF, tuning.star) : 0,
    z: Math.round(g.z),
    reason: r.reason,
  };
}
function collect(tuning, level, policy, seed = SEED) {
  const hits = [], waves = [];
  const g = runRoute(tuning, level, policy, (gg) => {
    for (const ev of gg.events) {
      if (ev.kind === 'obstacleHit') hits.push({ id: ev.obstacle.id, loss: ev.loss });
      if (ev.kind === 'breakWave') waves.push(ev);
    }
  }, seed);
  return { g, hits, waves, s: stat(g, level.targetF) };
}
const cell = (s) => `${s.win ? '通关' : '败@z' + s.z} ${String(s.time.toFixed(1)).padStart(4)}s 杀${String(s.kills).padStart(4)} 漏${String(s.leaks).padStart(3)} ${s.win ? s.star : 0}★`;

console.log('═══ 体检表:三种走位 ═══   (最优 = 参考最优路线,targetF 就是它的 fPeak → 恒 1.00 = 3★)\n');
console.log('关 | 最优路线                             | 一路不动             | 次优(只吃门)');
console.log('---+--------------------------------------+----------------------+----------------------');

const rows = [];
for (const lv of levels) {
  const route = bestRoute(tuning, lv);
  const opt = collect(tuning, lv, makePolicy(route.opt));
  const noD = collect(tuning, lv, makePolicy({ ...route.opt, dodge: false }));
  const sub = collect(tuning, lv, makePolicy({ depth: route.opt.depth, dodge: false, barrels: 'none' }));
  const idl = collect(tuning, lv, idle);
  rows.push({ lv, route, opt, noD, sub, idl });
  console.log(`${String(lv.level).padStart(2)} | ${cell(opt.s)} F${String(opt.s.fPeak).padStart(5)}/${String(lv.targetF).padEnd(5)}`
    + ` | ${cell(idl.s).padEnd(20)} | ${cell(sub.s)}`);
}

console.log('\n═══ 红线核查 ═══\n');

// ① 最优路线全部可过,且 30~36 秒
console.log('① 最优路线:通关 + 单局 30~36 秒');
for (const { lv, opt, route } of rows) {
  const okWin = opt.s.win || fail(`关${lv.level} 最优路线未通关(${opt.s.reason})`);
  const okT = (opt.s.time >= TIME_MIN && opt.s.time <= TIME_MAX) || fail(`关${lv.level} 时长 ${opt.s.time}s 越界`);
  console.log(`   ${okWin === '✗' || okT === '✗' ? '✗' : '✓'} 关${String(lv.level).padStart(2)} ${opt.s.win ? '通关' : '未通关'} ${String(opt.s.time.toFixed(1)).padStart(4)}s`
    + `  ratio ${(opt.s.fPeak / lv.targetF).toFixed(2)} → ${opt.s.star}★  [策略 d${route.opt.depth}${route.opt.barrels === 'late' ? '+桶' : '弃桶'}]`);
}

// ② 一路不动:教学两关必过,3 关起全败
console.log('\n② 一路不动:关 1~2 必过(教学关必过),关 3~12 全败');
for (const { lv, idl } of rows) {
  const want = lv.level <= 2;
  const ok = idl.s.win === want || fail(`关${lv.level} 一路不动 ${idl.s.win ? '通关' : '失败'},应为 ${want ? '通关' : '失败'}`);
  console.log(`   ${ok === '✗' ? '✗' : '✓'} 关${String(lv.level).padStart(2)} ${idl.s.win ? `通关 ${idl.s.time.toFixed(1)}s ${idl.s.star}★` : `败于 z${idl.s.z}(${idl.s.reason})`}`);
}

// ③ 躲 > 不躲(只翻转这一个变量)
console.log('\n③ 专项「躲 > 不躲」:同一条路线只关掉躲避,火力必须掉下来');
for (const { lv, opt, noD } of rows) {
  if (!(lv.obstacles || []).length) { console.log(`   ·  关${String(lv.level).padStart(2)} 无障碍,不适用`); continue; }
  const d = (noD.s.fPeak / opt.s.fPeak - 1) * 100;
  const ok = noD.s.fPeak < opt.s.fPeak || fail(`关${lv.level} 不躲(${noD.s.fPeak})≥ 躲(${opt.s.fPeak}),硬吃仍是优解`);
  console.log(`   ${ok === '✗' ? '✗' : '✓'} 关${String(lv.level).padStart(2)} 躲 ${String(opt.s.fPeak).padStart(5)} → 不躲 ${String(noD.s.fPeak).padStart(5)} (${d >= 0 ? '+' : ''}${d.toFixed(0)}%)`
    + ` 撞 ${noD.hits.length} 次损 ${noD.hits.reduce((s, h) => s + h.loss, 0)} 兵${noD.hits.length ? ' [' + noD.hits.map(h => h.id).join(' ') + ']' : ''}`
    + `${noD.s.win ? '' : ' 且未通关'}`);
}

// ④ 护栏:障碍零余量 + 桶收益线
console.log(`\n④ 护栏:障碍余量 ≥ ${OBSTACLE_MIN_CLEARANCE} / 单桶收益 ${BARREL_REWARD_FLOOR * 100}%~${BARREL_REWARD_CAP * 100}%`);
for (const lv of levels) {
  for (const r of [...obstacleClearance(lv, tuning), ...barrelCost(lv, tuning)]) {
    if (!r.ok) { fail(`关${lv.level} ${r.id} 不合法`); console.log(`   ✗ 关${String(lv.level).padStart(2)} ${r.msg}`); }
  }
}
// 落在终点线外的元素永远遇不上 —— 配置写了、玩家碰不到,比配错还难发现(关 12 的 roller
// 就是赛道从 285 砍到 275 之后悄悄失效的)。门 / 闸门另算:它们**故意**摆在线上当收官检验点。
for (const lv of levels) {
  for (const e of [...(lv.obstacles || []), ...(lv.barrels || [])]) {
    if (e.posZ > lv.trackLength) {
      fail(`关${lv.level} ${e.id} 在 z${e.posZ},赛道只到 ${lv.trackLength} —— 永远遇不上`);
      console.log(`   ✗ 关${String(lv.level).padStart(2)} ${e.id} posZ ${e.posZ} > trackLength ${lv.trackLength}`);
    }
  }
}
const guard = levels.flatMap(lv => [...obstacleClearance(lv, tuning), ...barrelCost(lv, tuning)]);
console.log(`   ${guard.every(r => r.ok) ? '✓' : '✗'} ${guard.filter(r => r.ok).length}/${guard.length} 项合法`
  + `(障碍 ${levels.reduce((s, l) => s + (l.obstacles || []).length, 0)} 个 / 桶 ${levels.reduce((s, l) => s + (l.barrels || []).length, 0)} 个)`);

// ⑤ 怪流强度与火力的对账:末关不能过剩
console.log('\n⑤ 怪流需求 vs 最优火力(峰值/末段需求 ≈ 1.2~1.6 才有压力;V6 关 12 是 2.5 = 白给)');
for (const { lv, opt } of rows) {
  const need = Math.max(...(lv.waves || []).map(fMin), 0);
  const ratio = opt.s.fPeak / need;
  console.log(`   ${ratio > 2.0 ? '!' : '·'} 关${String(lv.level).padStart(2)} 末段需求 ${String(Math.round(need)).padStart(5)}`
    + ` / 峰值 ${String(opt.s.fPeak).padStart(5)} = ${ratio.toFixed(2)}  漏怪 ${opt.s.leaks}`);
}

// ⑥ 突破冲击波:强度看的是**杀伤半径**(与门血量挂钩),不是杀伤总量 —— 堆 20 只还是 260 只,
//    贴门那一片同样清空,「拖延 = 必死」的正反馈才断得掉。半径 ≤ 0 就是冲击波纯装饰。
console.log(`\n⑥ 冲击波复核:杀伤半径 = ${tuning.breakWaveRange} × (1 − 怪血 / 门血×${tuning.breakWaveDamage}),下限 ${MIN_WAVE_RADIUS}`);
for (const { lv, opt } of rows) {
  if (!(lv.barriers || []).length) continue;
  console.log(`   ${lv.barriers.every(b => radius(lv, b) >= MIN_WAVE_RADIUS) ? '✓' : '✗'} 关${String(lv.level).padStart(2)} ` + lv.barriers.map((b, i) => {
    const w = opt.waves[i], r = radius(lv, b);
    if (r < MIN_WAVE_RADIUS) fail(`关${lv.level} ${b.id} 冲击波杀伤半径 ${r.toFixed(1)} < ${MIN_WAVE_RADIUS},门后堆积清不动`);
    return `${b.id}(hp${b.hp},破门 ${barrierTime(b.hp, opt.s.fPeak).toFixed(1)}s@峰值)`
      + ` 半径 ${r.toFixed(1)}/${tuning.breakWaveRange}` + (w ? ` 清 ${w.killed} 剩 ${w.held}` : ' 未到达');
  }).join(' | '));
}
function radius(lv, b) {
  const hp = Math.max(...(lv.waves || []).filter(w => b.posZ >= w.from && b.posZ <= w.to).map(w => w.hp), 0);
  return tuning.breakWaveRange * (1 - hp / (b.hp * tuning.breakWaveDamage));
}

// ⑦ 噪声带:换种子重跑,结局与漏怪的抖动范围
console.log(`\n⑦ 噪声带(种子 ${SEEDS[0]}~${SEEDS[SEEDS.length - 1]},怪位抖动是随机的,验收看的是"每个种子都过")`);
for (const { lv, route } of rows) {
  const runs = SEEDS.map(s => collect(tuning, lv, makePolicy(route.opt), s).s);
  const leaks = runs.map(r => r.leaks), times = runs.map(r => r.time), wins = runs.filter(r => r.win).length;
  // 不动也扫一遍:关 4 曾经死在 z253/255(离通关差 2 个身位),换个种子就翻过去 —— 红线②
  // 不能挂在这么薄的余量上,所以这里连"死点离终点多远"一起看。
  const idles = SEEDS.map(s => collect(tuning, lv, idle, s).s);
  const iWin = idles.filter(r => r.win).length, want = lv.level <= 2 ? SEEDS.length : 0;
  const ok = (wins === SEEDS.length && iWin === want)
    || fail(`关${lv.level} 种子扫描:最优 ${wins}/${SEEDS.length} 通关、不动 ${iWin}/${SEEDS.length} 通关(应 ${want})`);
  console.log(`   ${ok === '✗' ? '✗' : '✓'} 关${String(lv.level).padStart(2)} 最优 ${wins}/${SEEDS.length} 通关`
    + ` 漏怪 ${Math.min(...leaks)}~${Math.max(...leaks)} 时长 ${Math.min(...times).toFixed(1)}~${Math.max(...times).toFixed(1)}s`
    + ` | 不动 ${iWin}/${SEEDS.length} 通关,${want ? '' : `死点 z${Math.min(...idles.map(r => r.z))}~${Math.max(...idles.map(r => r.z))}/${lv.trackLength}`}`);
}

console.log('\n' + (bad.length ? `✗ ${bad.length} 项不合格:\n  - ` + bad.join('\n  - ') : '✓ 全绿'));
process.exit(bad.length ? 1 : 0);
