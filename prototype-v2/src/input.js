// 拖动输入 —— 只上报屏幕像素位移,世界坐标换算交给 main.js(它知道画布缩放比)。

export function attachDrag(canvas, onDragPixels) {
  let last = null;
  const posOf = (e) => (e.touches && e.touches[0] ? e.touches[0].clientX : e.clientX);

  const down = (e) => { last = posOf(e); };
  const move = (e) => {
    if (last === null) return;
    const cur = posOf(e);
    onDragPixels(cur - last);
    last = cur;
    if (e.cancelable) e.preventDefault();
  };
  const up = () => { last = null; };

  canvas.addEventListener('mousedown', down);
  window.addEventListener('mousemove', move);
  window.addEventListener('mouseup', up);
  canvas.addEventListener('touchstart', down, { passive: false });
  canvas.addEventListener('touchmove', move, { passive: false });
  window.addEventListener('touchend', up);
}
