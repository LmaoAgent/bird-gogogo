// 装配：配置 → Game(逻辑) + Renderer(表现) + 拖动 → 主循环。

import { Game } from './core/game.js';
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

// 调试出口(策划调参/自动化验证):console 里可 __proto.goto(5)、读 __proto.game
window.__proto = {
  get game() { return game; },
  renderer, tuning, levels,
  /** 无头/自动化环境下 rAF 被节流,用它手动推进 n 帧(会同步绘制)。 */
  step(n = 60, laneOf = null) {
    for (let i = 0; i < n; i++) {
      if (laneOf) game.targetX = tuning.track.laneX[laneOf(game)] ?? game.targetX;
      game.update(1 / 60);
      renderer.consume(game);
      renderer.draw(game, 1 / 60);
    }
    return { z: +game.z.toFixed(0), state: game.state, ...game.stats, kills: game.killCount, enemies: game.enemies.length, bullets: game.bullets.length };
  },
  goto(lv) { levelIndex = Math.min(Math.max(lv, 1), levels.length) - 1; game = new Game(tuning, levels[levelIndex]); },
};

let last = performance.now();
function frame(now) {
  const dt = Math.min((now - last) / 1000, 0.05);
  last = now;
  game.update(dt);
  renderer.consume(game);
  renderer.draw(game, dt);
  requestAnimationFrame(frame);
}
requestAnimationFrame(frame);
