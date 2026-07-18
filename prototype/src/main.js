// 装配：配置加载 → Game(逻辑) + Renderer(表现) + 拖动输入 → 主循环。
// 核心闭环(交接说明 §6)：出兵 → 吃门 → 撞击判定 → 通关/失败 → 下一关。

import { Game } from './core/game.js';
import { Renderer, W, H, BTN } from './render.js';
import { attachDrag } from './input.js';

const [tuning, levels] = await Promise.all([
  fetch('./config/tuning.json').then(r => r.json()),
  fetch('./config/levels.json').then(r => r.json()),
]);

const canvas = document.getElementById('game');
const renderer = new Renderer(canvas, tuning);

// 开发用：?level=8 直接进第 8 关验证数值
const startLevel = Number(new URLSearchParams(location.search).get('level')) || 1;
let levelIndex = Math.min(Math.max(startLevel, 1), levels.length) - 1;
let game = new Game(tuning, levels[levelIndex]);

attachDrag(canvas, tuning, d => game.dragBy(d));

canvas.addEventListener('click', (e) => {
  if (game.state !== 'win' && game.state !== 'fail') return;
  const r = canvas.getBoundingClientRect();
  const x = (e.clientX - r.left) * (W / r.width);
  const y = (e.clientY - r.top) * (H / r.height);
  if (x < BTN.x || x > BTN.x + BTN.w || y < BTN.y || y > BTN.y + BTN.h) return;

  if (game.state === 'win') levelIndex = (levelIndex + 1) % levels.length;
  game = new Game(tuning, levels[levelIndex]);
});

// 开发调试出口：console 里可读状态、手动 step、跳关(策划调参与自动化验证用)
window.__proto = {
  get game() { return game; },
  tuning, levels,
  goto(lv) { levelIndex = lv - 1; game = new Game(tuning, levels[levelIndex]); },
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
