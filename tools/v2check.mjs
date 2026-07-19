// v2 原型数值体检：贪心最优 / 一路不动 / 次优 三种走位跑 6 关。
import { readFileSync } from 'node:fs';
import { pathToFileURL, fileURLToPath } from 'node:url';

const B = fileURLToPath(new URL('../prototype-v2/', import.meta.url));
const { Game } = await import(pathToFileURL(B + 'src/core/game.js').href);
const { applyGate, firepower, fMin } = await import(pathToFileURL(B + 'src/core/rules.js').href);
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
const worst = (gate, s) => {
  if (gate.type === 'pick') {
    let w = gate.options[0].side, wf = Infinity;
    for (const o of gate.options) { const f = firepower(applyGate(s, o)); if (f < wf) { wf = f; w = o.side; } }
    return w;
  }
  return greedy(gate, s);
};
const idle = () => 'center';

function run(level, policy) {
  const g = new Game(tuning, level);
  const dt = 1 / 60;
  for (let i = 0; i < 60 * 150 && g.state !== 'win' && g.state !== 'fail'; i++) {
    const next = g.gates.find(gt => gt.posZ > g.z);
    if (next) g.targetX = tuning.track.laneX[policy(next, g.stats)];
    g.update(dt);
  }
  return g;
}

console.log('关 | 贪心            | 时长  | 峰值F/目标F  ★ | 击杀 漏怪 | 不动 | 次优');
for (const lv of levels) {
  const need = Math.max(...(lv.waves || []).map(fMin), 0);
  const a = run(lv, greedy), b = run(lv, idle), c = run(lv, worst);
  const r = a.result || {};
  const ratio = (r.fPeak || 0) / lv.targetF;
  const star = ratio >= 0.95 ? 3 : ratio >= 0.75 ? 2 : 1;
  console.log(
    `${String(lv.level).padStart(2)} | ${(a.state === 'win' ? '✓通关' : '✗' + (r.reason || 'fail')).padEnd(14)}` +
    ` | ${String((r.time ?? 0).toFixed(0)).padStart(3)}s | ${String(Math.round(r.fPeak || 0)).padStart(5)}/${String(lv.targetF).padEnd(5)} ${a.state === 'win' ? star : 0}★` +
    ` | ${String(r.kills ?? 0).padStart(4)} ${String(r.leaks ?? 0).padStart(4)} | ${b.state === 'win' ? '过(!)' : '败  '} | ${c.state === 'win' ? '过' : '败'}` +
    `   [段F_min峰值 ${need}]`
  );
}
