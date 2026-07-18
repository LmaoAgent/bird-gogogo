// 装配：配置 → Game(逻辑) + Renderer(表现) + 拖动 → 主循环。

import { Game } from './core/game.js';
import { obstacleClearance, OBSTACLE_MIN_CLEARANCE, barrelCost, rewardDim } from './core/rules.js';
import { Renderer, W, H, BTN, X_SCALE } from './render.js';
import { attachDrag } from './input.js';

const [tuning, levels] = await Promise.all([
  fetch('./config/tuning.json').then(r => r.json()),
  fetch('./config/levels.json').then(r => r.json()),
]);

const canvas = document.getElementById('game');
const renderer = new Renderer(canvas, tuning);

const startLevel = Number(new URLSearchParams(location.search).get('level')) || 1;
let levelIndex = Math.min(Math.max(startLevel, 1), levels.length) - 1;
let game = new Game(tuning, levels[levelIndex]);

attachDrag(canvas, (px) => {
  const rect = canvas.getBoundingClientRect();
  game.dragBy((px * (W / rect.width)) / X_SCALE * tuning.dragSensitivity);
});

canvas.addEventListener('click', (e) => {
  if (game.state !== 'win' && game.state !== 'fail') return;
  const r = canvas.getBoundingClientRect();
  const x = (e.clientX - r.left) * (W / r.width);
  const y = (e.clientY - r.top) * (H / r.height);
  if (x < BTN.x || x > BTN.x + BTN.w || y < BTN.y || y > BTN.y + BTN.h) return;
  if (game.state === 'win') levelIndex = (levelIndex + 1) % levels.length;
  game = new Game(tuning, levels[levelIndex]);
});

// 埋点:core 只负责报事件,上报动作留在装配层 —— core 要保持引擎无关,不认识 console,更不认识上报 SDK。
// 迁 Cocos 时这段换成 Analytics.track(《P0工程骨架》),core 一行不动。
const tracked = [];
function track(game) {
  for (const ev of game.events) {
    const lv = game.level.level;
    if (ev.kind === 'obstacleHit') {
      report('obstacle_hit', { level: lv, type: ev.obstacle.type, lossN: ev.loss });
    } else if (ev.kind === 'barrelHit') {
      // hit 与 break 成对才有意义:hit 是"多少人选择去打"、break 是"多少人打成了",
      // 中间的落差就是分流火力却什么都没换到的那批人 —— 桶配硬了会直接反映在这个比上。
      report('barrel_hit', { level: lv, rewardDim: rewardDim(ev.barrel.reward) });
    } else if (ev.kind === 'barrelBreak') {
      report('barrel_break', { level: lv, rewardDim: rewardDim(ev.reward), gain: +ev.gain.toFixed(3) });
    }
  }
}

function report(evt, params) {
  tracked.push({ evt, ...params });
  console.log(`[track] ${evt}`, params);
}

// 调试出口(策划调参/自动化验证):console 里可 __proto.goto(5)、读 __proto.game
window.__proto = {
  get game() { return game; },
  renderer, tuning, levels, tracked,
  /** 无头/自动化环境下 rAF 被节流,用它手动推进 n 帧(会同步绘制)。 */
  step(n = 60, laneOf = null) {
    for (let i = 0; i < n; i++) {
      if (laneOf) game.targetX = tuning.track.laneX[laneOf(game)] ?? game.targetX;
      game.update(1 / 60);
      track(game);
      renderer.consume(game);
      renderer.draw(game, 1 / 60);
    }
    return { z: +game.z.toFixed(0), state: game.state, ...game.stats, kills: game.killCount, enemies: game.enemies.length, bullets: game.bullets.length };
  },
  goto(lv) { levelIndex = Math.min(Math.max(lv, 1), levels.length) - 1; game = new Game(tuning, levels[levelIndex]); },
  /**
   * 配置体检。两条纪律各管一半:
   * 障碍看「有没有活路」(任一障碍没有 ≥0.5 余量的 lane 就是必中配置);
   * 油桶看「有没有代价」(空场上的桶是白送,闸门停机区里的桶够不着)。
   */
  checkLevels(list = levels) {
    const bad = [];
    for (const lv of list) {
      for (const r of [...obstacleClearance(lv, tuning), ...barrelCost(lv, tuning)]) {
        console.log(`${r.ok ? '  ok  ' : '不合法'} 第 ${lv.level} 关 ${r.msg}`);
        if (!r.ok) bad.push(r.id);
      }
    }
    console.log(bad.length ? `✗ ${bad.length} 项不合法(障碍余量 < ${OBSTACLE_MIN_CLEARANCE} / 桶白送或够不着): ${bad.join(', ')}`
      : `✓ 全部合法`);
    return bad.length === 0;
  },
};

let last = performance.now();
function frame(now) {
  const dt = Math.min((now - last) / 1000, 0.05);
  last = now;
  game.update(dt);
  track(game);
  renderer.consume(game);
  renderer.draw(game, dt);
  requestAnimationFrame(frame);
}
requestAnimationFrame(frame);
