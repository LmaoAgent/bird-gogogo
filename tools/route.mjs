// 参考路线 —— **targetF 口径的唯一定义处**,配平(rebalance)与体检(v2check)共用同一份。
//
// 口径(V7 定死,文档见《玩法数值与关卡设计v2》§8):
//   targetF ≡ 「参考最优路线」在完整关卡(含怪流/闸门/障碍/油桶)上实跑出来的 fPeak。
//   参考最优路线 = 躲开所有障碍 + 打掉所有打得完的桶 + 每道门取火力最大的分支。
//
// 为什么是实战最优而不是纯贪心:
//   1. 星级分母必须是**玩家可达的最好结果**。拿"不躲不打桶"当分母,躲障碍的人 F 反而更高 →
//      ratio 破 100%(V6 实测关 9 = 107%、关 12 = 137%),3★ 变成白送。
//   2. 桶奖励走 applyGate 会进 fPeak,分母不算桶就永远对不上账。
//   3. targetF 是**实跑测出来的**,不是公式估的 —— 所以它天然可达,不会出现"前段够不着"。
//
// 前瞻:门按 posZ 分组、深度 depth 穷举(3^depth),并且**带走位可达性**——
// 换道要时间,`reach()` 用与 game.js 同一条 lerp 算到达时的 centerX,够不着的门不计入收益。
// 没有它的话前瞻会规划出"瞬移才吃得到"的路线,实跑两头落空,比只看下一道门还差。

import { Game } from '../prototype-v2/src/core/game.js';
import { firepower, applyGate, obstacleX, inLane, OBSTACLE_MIN_CLEARANCE } from '../prototype-v2/src/core/rules.js';

/** 换道提前量(纵深单位)。followSmooth 0.15 下 ~0.31s 收敛,9 速 → 2.8;留到 5 是余量。 */
export const MOVE_LEAD_Z = 5;

/** 沿用 game.js 的跟手 lerp:一路对准 toX,走完 dz 纵深后的 centerX。 */
function reach(fromX, toX, dz, tuning) {
  const frames = Math.max(0, dz) / (tuning.forwardSpeed / 60);
  return toX + (fromX - toX) * Math.pow(1 - tuning.followSmooth, frames);
}

/** 未触发的门按 posZ 分组(同一 z 上的并排门算一组,才评得出"左 L×2 / 右 N×0.5"这种同排陷阱)。 */
function nextGroups(g, depth) {
  const out = [];
  for (const gt of g.gates) {
    if (gt.posZ <= g.z) continue;
    const last = out[out.length - 1];
    if (last && Math.abs(last.posZ - gt.posZ) < 1e-6) { last.gates.push(gt); continue; }
    if (out.length >= depth) break;
    out.push({ posZ: gt.posZ, gates: [gt] });
  }
  return out;
}

/** 站在 lane 上(从 fromX 出发,还有 dz 纵深)能吃到这组门里的哪些,施加后的属性。 */
function applyGroup(stats, group, lane, fromX, dz, tuning) {
  const x = reach(fromX, tuning.track.laneX[lane], dz, tuning);
  let s = stats;
  for (const gt of group.gates) {
    const eff = gt.type === 'pick'
      ? gt.options.find(o => o.side === lane && inLane(x, o.side, tuning.track))
      : (gt.side === lane && inLane(x, gt.side, tuning.track) ? gt : null);
    if (eff) s = applyGate(s, eff);
  }
  return s;
}

/** 深度 depth 穷举,返回第一步该走哪条 lane 以及该路线的终局火力。 */
function planGates(g, depth, lanes) {
  const groups = nextGroups(g, depth);
  if (!groups.length) return null;
  const T = g.tuning;
  const walk = (stats, i, fromX, fromZ) => {
    if (i >= groups.length) return { f: firepower(stats), lane: null };
    let bf = -1, bl = lanes[0];
    for (const lane of lanes) {
      const s = applyGroup(stats, groups[i], lane, fromX, groups[i].posZ - fromZ, T);
      const r = walk(s, i + 1, T.track.laneX[lane], groups[i].posZ);
      if (r.f > bf) { bf = r.f; bl = lane; }
    }
    return { f: bf, lane: bl };
  };
  return walk(g.stats, 0, g.centerX, g.z);
}

/** 各 lane 到"穿越时刻的障碍判定区"还剩多少余量。负 = 会撞。 */
function clearanceNow(g, lanes) {
  const T = g.tuning;
  const out = {};
  for (const n of lanes) out[n] = Infinity;
  for (let i = g.obstacleIndex; i < g.obstacles.length; i++) {
    const o = g.obstacles[i];
    const dz = o.posZ - g.z;
    if (dz < 0) continue;
    // 只在"该动手了"的那一小段里躲。放宽这个提前量会让策略提早弃道:关 9 的 roller 在 z160,
    // 提前 9 个纵深就开始躲的话,z155 那道门还没吃就先离开了中路 —— 躲反而比不躲少拿火力。
    if (dz > MOVE_LEAD_Z) break;
    const cx = obstacleX(o, g.time + dz / T.forwardSpeed, T);
    const danger = o.width / 2 + T.obstacleHitHalfW;
    for (const n of lanes) {
      out[n] = Math.min(out[n], Math.abs(T.track.laneX[n] - cx) - danger);
    }
  }
  return out;
}

/** 此刻该不该去对准某个桶:打得完才去,且**压到最后一刻**才离开门的道(离开越早丢门越多)。 */
function barrelDue(g, skip) {
  const T = g.tuning;
  for (let i = g.barrelIndex; i < g.barrels.length; i++) {
    const b = g.barrels[i];
    const dz = b.posZ - g.z;
    if (dz > T.barrelRangeZ) break;
    if (b.dead || dz < 0 || skip.includes(b.id)) continue;
    const needZ = b.hp / Math.max(g.F * T.barrelShare, 1) * T.forwardSpeed;
    if (needZ > dz) continue;                              // 剩下的窗口打不穿了,弃
    if (needZ + MOVE_LEAD_Z >= dz) return b;               // 到点了,现在对准刚好打穿
  }
  return null;
}

/**
 * 走位策略。
 * @param depth   门的前瞻组数(1 = 只看下一组,即 V6 那个近视贪心)
 * @param dodge   是否躲障碍
 * @param barrels 'late' 打得完就打(压到最后一刻) | 'none' 不主动打桶
 * @param skip    要绕过的桶 id。同一 z 上并排两个桶只来得及打一个,拿它跑"选另一个"的那条路线
 *                —— 没被选中的那个也得测出拾取属性,否则体检会把设计好的二选一当成"够不着"。
 */
export function makePolicy({ depth = 3, dodge = true, barrels = 'late', skip = [] } = {}) {
  let memoKey = null, memoLane = null;
  return function decide(g) {
    const T = g.tuning;
    const lanes = Object.keys(T.track.laneX);

    // 1) 障碍是硬约束:先算出哪些 lane 活得下来
    const clear = dodge ? clearanceNow(g, lanes) : null;
    const safe = clear ? lanes.filter(n => clear[n] >= OBSTACLE_MIN_CLEARANCE) : lanes;
    const pool = safe.length ? safe : [lanes.reduce((a, b) => (clear[a] > clear[b] ? a : b))];

    // 2) 桶:优先级高于门 —— 代价已经被 "aim late" 压到最小,再让门抢走就等于永远不打桶
    if (barrels === 'late') {
      const b = barrelDue(g, skip);
      if (b) {
        const lane = pool.find(n => Math.abs(T.track.laneX[n] - b.x) <= T.barrelAimHalfW);
        if (lane !== undefined) return T.track.laneX[lane];
      }
    }

    // 3) 门:前瞻穷举(缓存到"门口 + 属性"没变的这一段,否则每帧 3^depth 太慢)
    const key = `${g.gateIndex}|${g.stats.N},${g.stats.L},${g.stats.R},${g.stats.D}|${pool.join('')}`;
    if (key !== memoKey) {
      memoKey = key;
      const plan = planGates(g, depth, pool);
      memoLane = plan ? plan.lane : null;
    }
    if (memoLane) return T.track.laneX[memoLane];
    return pool.includes('center') ? T.track.laneX.center : T.track.laneX[pool[0]];
  };
}

/** 一路不动:从不拖动,targetX 恒在出生点(center)。 */
export const idle = () => 0;

/**
 * 定种子跑一局。onFrame 可用来采曲线。
 *
 * 种子不是洁癖:`#spawnWaves` 给每只怪的落点加了随机抖动,漏怪 → 掉兵 → 火力,一路放大到 fPeak。
 * 实测同一份关 3 配置连跑两次,fPeak 在 1242~1602 之间摆(±22%)—— 「躲 vs 不躲」差 10% 的对照
 * 直接被噪声吃掉。换成 mulberry32、跑完还原,配平的每一个结论才是可复跑的(主控复核也看这个)。
 * 只影响工具进程,游戏本体照旧用真随机。
 */
export function withSeed(seed, fn) {
  const real = Math.random;
  let s = seed >>> 0;
  Math.random = () => {
    s = (s + 0x6D2B79F5) >>> 0;
    let t = Math.imul(s ^ (s >>> 15), 1 | s);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
  try { return fn(); } finally { Math.random = real; }
}

export const SEED = 1;

export function runRoute(tuning, level, policy, onFrame = null, seed = SEED) {
  return withSeed(seed, () => {
    const g = new Game(tuning, level);
    const dt = 1 / 60;
    // 上限放到 300 秒:火力烂到极点的走位会卡在闸门上磨很久(关 6 一路不动要 79 秒才撕开终闸),
    // 150 秒截断会把"最终仍然打不过"读成"没有结论",红线②就核不准了。
    for (let i = 0; i < 60 * 300 && g.state !== 'win' && g.state !== 'fail'; i++) {
      g.targetX = policy(g);
      g.update(dt);
      if (onFrame) onFrame(g);
    }
    return g;
  });
}

/**
 * 参考最优路线 = 策略族里**打得过、且 fPeak 最高**的那条。
 *
 * 用策略族而不是单一策略:近视贪心会在"长龙墙 vs 单门 L×2"上选错,深前瞻又可能为了一道大门
 * 放掉整段墙。哪种更强得看关卡,穷举几条再取最大,targetF 才不会被某个策略的盲点压低 ——
 * 分母压低的直接后果就是玩家轻松破 100%(V6 关 12 的 137% 就是这么来的)。
 */
export const ENSEMBLE = [
  { depth: 1, dodge: true, barrels: 'late' },
  { depth: 3, dodge: true, barrels: 'late' },
  { depth: 5, dodge: true, barrels: 'late' },
  { depth: 3, dodge: true, barrels: 'none' },
  { depth: 5, dodge: true, barrels: 'none' },
];

export function bestRoute(tuning, level, ensemble = ENSEMBLE, seed = SEED) {
  let best = null;
  for (const opt of ensemble) {
    const g = runRoute(tuning, level, makePolicy(opt), null, seed);
    const f = g.fPeak;
    if (g.state !== 'win') continue;
    if (!best || f > best.g.fPeak) best = { g, opt };
  }
  if (best) return best;
  // 一条都过不了:退回 fPeak 最高的那条失败路线,让体检表把它标出来
  const g = runRoute(tuning, level, makePolicy(ensemble[1]));
  return { g, opt: ensemble[1] };
}
