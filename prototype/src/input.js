// 单指水平拖动 → 队形中心 X(《玩法数值与关卡设计》§1)。
// 相对增量映射(而非绝对定位),手指抬起再落下不会瞬移大军。

import { W } from './render.js';

/** @param onDrag 回调收到的是世界坐标增量 */
export function attachDrag(canvas, tuning, onDrag) {
  const unitPx = (W * 0.90) / tuning.track.width;
  let dragging = false;
  let lastX = 0;

  const canvasX = (clientX) => {
    const r = canvas.getBoundingClientRect();
    return (clientX - r.left) * (W / r.width);
  };

  const down = (e) => {
    dragging = true;
    lastX = canvasX(e.clientX);
  };

  const move = (e) => {
    if (!dragging) return;
    const x = canvasX(e.clientX);
    onDrag(((x - lastX) / unitPx) * tuning.dragSensitivity);
    lastX = x;
    e.preventDefault();
  };

  const up = () => { dragging = false; };

  canvas.addEventListener('pointerdown', down);
  window.addEventListener('pointermove', move, { passive: false });
  window.addEventListener('pointerup', up);
  window.addEventListener('pointercancel', up);
}
