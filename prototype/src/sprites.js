// P0 占位美术 —— 程序绘制到离屏 canvas,渲染时 drawImage 缩放(集群不逐只重画路径)。
// 美术资源到位后,按《美术需求清单》§0 命名替换为图集精灵即可,渲染层调用不变：
//   hero_garlicbird_run / enemy_moldling_flow / boss_rotgarlic_idle
// 配色取自《美术需求清单》§0 主色对立。

export const PALETTE = {
  garlic: '#F5F0E6',
  garlicShade: '#DED5C4',
  skin: '#C9B8D6',
  beak: '#F2A83B',
  sprout: '#8FBF4D',
  ink: '#2B2420',
  mold: '#4A5D2B',
  moldLight: '#6E8542',
  rot: '#2B2420',
  spore: '#B5CC7A',
};

function offscreen(w, h) {
  const c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  return c;
}

/** 蒜鸟：白胖独头蒜身 + 橙嘴 + 蒜芽 + 小翅膀(Q 版 2 头身)。 */
export function makeGarlicBird(S = 128) {
  const c = offscreen(S, S);
  const g = c.getContext('2d');
  const cx = S / 2;
  g.lineJoin = g.lineCap = 'round';
  g.strokeStyle = PALETTE.ink;

  // 腿
  g.strokeStyle = PALETTE.beak;
  g.lineWidth = S * 0.055;
  for (const dx of [-0.11, 0.11]) {
    g.beginPath();
    g.moveTo(cx + S * dx, S * 0.78);
    g.lineTo(cx + S * dx * 1.2, S * 0.92);
    g.stroke();
  }

  // 蒜芽
  g.strokeStyle = PALETTE.sprout;
  g.lineWidth = S * 0.055;
  g.beginPath();
  g.moveTo(cx, S * 0.18);
  g.quadraticCurveTo(cx + S * 0.02, S * 0.09, cx + S * 0.07, S * 0.05);
  g.stroke();

  // 身体(上尖下圆的蒜头)
  g.beginPath();
  g.moveTo(cx, S * 0.14);
  g.bezierCurveTo(cx + S * 0.44, S * 0.36, cx + S * 0.40, S * 0.82, cx, S * 0.82);
  g.bezierCurveTo(cx - S * 0.40, S * 0.82, cx - S * 0.44, S * 0.36, cx, S * 0.14);
  g.closePath();
  g.fillStyle = PALETTE.garlic;
  g.fill();
  g.strokeStyle = PALETTE.ink;
  g.lineWidth = S * 0.045;
  g.stroke();

  // 蒜瓣纹
  g.strokeStyle = PALETTE.garlicShade;
  g.lineWidth = S * 0.025;
  for (const dx of [-0.16, 0.16]) {
    g.beginPath();
    g.moveTo(cx + S * dx * 0.5, S * 0.22);
    g.quadraticCurveTo(cx + S * dx * 1.6, S * 0.5, cx + S * dx * 1.3, S * 0.76);
    g.stroke();
  }

  // 翅膀
  g.fillStyle = PALETTE.garlic;
  g.strokeStyle = PALETTE.ink;
  g.lineWidth = S * 0.035;
  for (const dir of [-1, 1]) {
    g.beginPath();
    g.ellipse(cx + dir * S * 0.38, S * 0.58, S * 0.10, S * 0.14, dir * 0.35, 0, Math.PI * 2);
    g.fill();
    g.stroke();
  }

  // 眼睛(呆萌无语感：大眼白 + 小黑瞳)
  for (const dx of [-0.14, 0.14]) {
    g.beginPath();
    g.arc(cx + S * dx, S * 0.46, S * 0.10, 0, Math.PI * 2);
    g.fillStyle = '#FFFFFF';
    g.fill();
    g.lineWidth = S * 0.03;
    g.strokeStyle = PALETTE.ink;
    g.stroke();
    g.beginPath();
    g.arc(cx + S * dx * 1.05, S * 0.47, S * 0.05, 0, Math.PI * 2);
    g.fillStyle = PALETTE.ink;
    g.fill();
  }

  // 嘴
  g.beginPath();
  g.moveTo(cx - S * 0.06, S * 0.56);
  g.lineTo(cx + S * 0.06, S * 0.56);
  g.lineTo(cx, S * 0.64);
  g.closePath();
  g.fillStyle = PALETTE.beak;
  g.fill();
  g.lineWidth = S * 0.025;
  g.strokeStyle = PALETTE.ink;
  g.stroke();

  return c;
}

/** 霉菌怪：墨绿孢子团 + 酸黄眼 + 臭脸。 */
export function makeMoldling(S = 128) {
  const c = offscreen(S, S);
  const g = c.getContext('2d');
  const cx = S / 2;
  g.lineJoin = g.lineCap = 'round';

  // 孢子突起
  g.fillStyle = PALETTE.moldLight;
  for (let i = 0; i < 7; i++) {
    const a = (i / 7) * Math.PI * 2;
    g.beginPath();
    g.arc(cx + Math.cos(a) * S * 0.34, S * 0.55 + Math.sin(a) * S * 0.30, S * 0.09, 0, Math.PI * 2);
    g.fill();
  }

  // 身体
  g.beginPath();
  g.ellipse(cx, S * 0.56, S * 0.36, S * 0.33, 0, 0, Math.PI * 2);
  g.fillStyle = PALETTE.mold;
  g.fill();
  g.lineWidth = S * 0.045;
  g.strokeStyle = PALETTE.rot;
  g.stroke();

  // 霉斑
  g.fillStyle = PALETTE.spore;
  for (const [dx, dy, r] of [[-0.18, 0.14, 0.06], [0.20, 0.10, 0.05], [0.02, 0.24, 0.04]]) {
    g.beginPath();
    g.arc(cx + S * dx, S * (0.56 + dy), S * r, 0, Math.PI * 2);
    g.fill();
  }

  // 眼
  for (const dx of [-0.14, 0.14]) {
    g.beginPath();
    g.arc(cx + S * dx, S * 0.48, S * 0.09, 0, Math.PI * 2);
    g.fillStyle = '#E8D84A';
    g.fill();
    g.lineWidth = S * 0.028;
    g.strokeStyle = PALETTE.rot;
    g.stroke();
    g.beginPath();
    g.arc(cx + S * dx, S * 0.49, S * 0.04, 0, Math.PI * 2);
    g.fillStyle = PALETTE.rot;
    g.fill();
  }

  // 臭脸嘴
  g.beginPath();
  g.moveTo(cx - S * 0.10, S * 0.68);
  g.quadraticCurveTo(cx, S * 0.60, cx + S * 0.10, S * 0.68);
  g.lineWidth = S * 0.035;
  g.strokeStyle = PALETTE.rot;
  g.stroke();

  return c;
}

/** 烂蒜魔王：巨型发黑腐烂蒜 + 霉斑 + 獠牙。 */
export function makeRotGarlic(S = 256) {
  const c = offscreen(S, S);
  const g = c.getContext('2d');
  const cx = S / 2;
  g.lineJoin = g.lineCap = 'round';

  // 爪
  g.strokeStyle = PALETTE.mold;
  g.lineWidth = S * 0.05;
  for (const dir of [-1, 1]) {
    g.beginPath();
    g.moveTo(cx + dir * S * 0.30, S * 0.55);
    g.lineTo(cx + dir * S * 0.46, S * 0.66);
    g.stroke();
  }

  // 身体
  g.beginPath();
  g.moveTo(cx, S * 0.10);
  g.bezierCurveTo(cx + S * 0.46, S * 0.34, cx + S * 0.42, S * 0.88, cx, S * 0.88);
  g.bezierCurveTo(cx - S * 0.42, S * 0.88, cx - S * 0.46, S * 0.34, cx, S * 0.10);
  g.closePath();
  g.fillStyle = '#3A3128';
  g.fill();
  g.lineWidth = S * 0.035;
  g.strokeStyle = PALETTE.rot;
  g.stroke();

  // 腐烂裂纹与霉斑
  g.fillStyle = PALETTE.mold;
  for (const [dx, dy, r] of [[-0.20, 0.16, 0.08], [0.22, 0.06, 0.07], [0.04, 0.34, 0.09], [-0.10, -0.06, 0.05]]) {
    g.beginPath();
    g.arc(cx + S * dx, S * (0.50 + dy), S * r, 0, Math.PI * 2);
    g.fill();
  }

  // 眼
  for (const dx of [-0.15, 0.15]) {
    g.beginPath();
    g.ellipse(cx + S * dx, S * 0.44, S * 0.10, S * 0.07, 0, 0, Math.PI * 2);
    g.fillStyle = '#C9D64A';
    g.fill();
    g.lineWidth = S * 0.02;
    g.strokeStyle = PALETTE.rot;
    g.stroke();
    g.beginPath();
    g.arc(cx + S * dx, S * 0.44, S * 0.035, 0, Math.PI * 2);
    g.fillStyle = PALETTE.rot;
    g.fill();
  }

  // 獠牙嘴
  g.beginPath();
  g.moveTo(cx - S * 0.16, S * 0.60);
  g.quadraticCurveTo(cx, S * 0.72, cx + S * 0.16, S * 0.60);
  g.closePath();
  g.fillStyle = PALETTE.rot;
  g.fill();
  g.fillStyle = '#EFE7D2';
  for (const dx of [-0.09, 0.0, 0.09]) {
    g.beginPath();
    g.moveTo(cx + S * dx - S * 0.03, S * 0.62);
    g.lineTo(cx + S * dx + S * 0.03, S * 0.62);
    g.lineTo(cx + S * dx, S * 0.69);
    g.closePath();
    g.fill();
  }

  return c;
}
