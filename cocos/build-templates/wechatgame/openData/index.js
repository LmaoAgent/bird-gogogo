// 微信开放数据域子域 —— 好友数据的读取与绘制全在这里(排行榜spec §1:主域根本拿不到)。
//
// 为什么是裸 Canvas 而不是独立 Cocos 子域工程(spec §5 给了两个选项):
//   子域只画静态榜单、不吃触摸(复杂交互按红线归主域),再塞一份引擎进包不划算——
//   主包已经顶着微信 4MB 上限(见 memory p0-art-first-package-budget)。
//
// 为什么放在 build-templates/wechatgame/ 而不是 cocos/openData/:
//   这是构建器唯一会自动拷进产物的版本化目录(baidu/wechat 的 copyResFiles 钩子把
//   build-templates/<platform>/ 整个 copySync 进 build/<platform>/),搭配同目录的
//   game.json(openDataContext: "openData")即可零手工步骤上车。放 cocos/openData/
//   就得额外加一步拷贝,反而多一个会忘的环节。
//
// 通信是单向的:主域 postMessage 进来,子域没有回传通道。所以"击败 N 位好友"这种
// 由好友数据算出来的数字也只能由子域自己画出来,主域拿不到那个数(spec §3 同款约束)。

var sharedCanvas = wx.getSharedCanvas();
var ctx = sharedCanvas.getContext('2d');

// 配色照搬主域 UiKit.UI_C,两边观感一致(子域引不到 TS 模块,只能抄一份字面值)
var C = {
  panel: '#F7E9C8',
  edge: '#7A5230',
  textDark: '#3A2E24',
  textSub: '#8A7A66',
  primary: '#F2C33B',
  selfRow: '#FFE9A8',
  row: 'rgba(255,255,255,0.72)',
  shadow: 'rgba(24,18,14,0.18)',
};

var BOARD_NAME = { max_level: '最高关卡', max_troop: '单局兵力' };
var BOARD_UNIT = { max_level: '关', max_troop: '兵' };

/** 榜上最多铺几行。子域不接触摸(红线),所以不做滚动,靠"我"置底保证自己一定看得见。 */
var MAX_ROWS = 8;

/**
 * 结算横幅只画在画布顶部这一条里,其余留透明。
 * 主域 SubContextView 是把整张画布等比铺到节点上的,拿不到"只显示一部分"这种能力,
 * 于是靠透明区域造出一根悬浮条 —— 主域按同一个 200 反解节点尺寸(见 ui/RankCanvas.ts),
 * 改这里就要同步改那边。
 */
var BEAT_BAND = 200;

// 最近一次的数据快照:头像是异步加载的,回来一张就得拿这份快照重画一次
var view = { mode: '', board: 'max_level', myScore: 0, rows: null, beat: 0, next: null };

var avatars = {};      // url -> { img, ok } ,画过的头像不重复下载
var selfInfo = null;   // wx.getUserInfo 拿到的自己,用来在好友列表里认出"我"

// —— 主域指令(spec §3) ——

wx.onMessage(function (msg) {
  if (!msg || typeof msg.type !== 'string') return;
  // SubContextView 每次视窗变化都会发 {type:'engine', event:'viewport'},那是引擎的事,不是我们的协议
  if (msg.type === 'render' || msg.type === 'beat') {
    view.mode = msg.type;
    view.board = msg.board === 'max_troop' ? 'max_troop' : 'max_level';
    view.myScore = toInt(msg.myScore);
    pull();
  } else if (msg.type === 'refresh' && view.mode) {
    pull();
  }
});

function pull() {
  wx.getFriendCloudStorage({
    keyList: [view.board],
    success: function (res) { apply(res && res.data ? res.data : []); },
    // 无好友数据 / 接口报错都走同一条空态,别把画面停在上一榜的残影上
    fail: function () { apply([]); },
  });
}

// —— 榜单计算 ——

function apply(list) {
  var rows = [];
  for (var i = 0; i < list.length; i++) {
    var f = list[i];
    var score = scoreOf(f.KVDataList, view.board);
    if (score <= 0) continue;   // 没打过这个榜的好友不占位置
    rows.push({
      name: f.nickname || '神秘蒜鸟',
      avatar: f.avatarUrl || '',
      openid: f.openid || '',
      score: score,
      me: false,
    });
  }
  rows.sort(function (a, b) { return b.score - a.score; });
  markSelf(rows);

  // "击败 N 位好友"只跟主域给的 myScore 比,不依赖认人认得准不准 —— 认错顶多高亮错行,数字照样对
  var beat = 0;
  var next = null;
  for (var j = 0; j < rows.length; j++) {
    if (rows[j].me) continue;
    if (rows[j].score < view.myScore) beat++;
    else next = rows[j];   // 升序遍历下来,最后一个压着我的就是我的下一个目标
  }

  view.rows = rows;
  view.beat = beat;
  view.next = next;
  draw();
}

/** wxgame 托管格式(spec §2):value 是 {"wxgame":{"score":37,"update_time":...}} 的字符串。 */
function scoreOf(kvList, key) {
  if (!kvList) return 0;
  for (var i = 0; i < kvList.length; i++) {
    if (kvList[i].key !== key) continue;
    var raw = kvList[i].value;
    if (typeof raw !== 'string') return 0;
    if (/^\d+$/.test(raw)) return parseInt(raw, 10);   // 裸数字:别的版本写脏的,认了
    // 好友托管数据是外部输入且前端可改(spec §7),解析失败按 0 处理而不是让整张榜炸掉
    try {
      var o = JSON.parse(raw);
      return o && o.wxgame ? toInt(o.wxgame.score) : 0;
    } catch (e) {
      return 0;
    }
  }
  return 0;
}

/**
 * 在好友列表里认出"我" —— getFriendCloudStorage 的返回是包含自己的,但没有 isSelf 标记。
 * 三级兜底:openid → 昵称+头像 → 分数等于主域给的 myScore。
 */
function markSelf(rows) {
  var hit = -1;
  for (var i = 0; i < rows.length && hit < 0; i++) {
    if (selfInfo && selfInfo.openId && rows[i].openid === selfInfo.openId) hit = i;
  }
  for (var j = 0; j < rows.length && hit < 0; j++) {
    if (selfInfo && rows[j].name === selfInfo.nickName && rows[j].avatar === selfInfo.avatarUrl) hit = j;
  }
  for (var k = 0; k < rows.length && hit < 0; k++) {
    if (rows[k].score === view.myScore) hit = k;
  }
  if (hit >= 0) rows[hit].me = true;
}

// 自己的昵称/头像取一次就够,拿到后重画一遍把高亮补上
wx.getUserInfo({
  openIdList: ['selfOpenId'],
  success: function (res) {
    if (!res || !res.data || !res.data.length) return;
    selfInfo = res.data[0];
    if (view.rows) { markSelf(view.rows); draw(); }
  },
  fail: function () { /* 拿不到就退到昵称/分数兜底,不影响榜单本身 */ },
});

// —— 绘制 ——

function draw() {
  var W = sharedCanvas.width;
  var H = sharedCanvas.height;
  ctx.clearRect(0, 0, W, H);
  if (view.mode === 'beat') drawBeat(W);
  else if (view.mode === 'render') drawBoard(W, H);
}

/** 排行榜整页(主域 RankScreen 里显示)。 */
function drawBoard(W, H) {
  var pad = 16;
  roundRect(pad, pad, W - pad * 2, H - pad * 2, 28);
  ctx.fillStyle = C.panel;
  ctx.fill();
  ctx.lineWidth = 6;
  ctx.strokeStyle = C.edge;
  ctx.stroke();

  ctx.textAlign = 'center';
  ctx.fillStyle = C.textDark;
  ctx.font = 'bold 40px sans-serif';
  ctx.fillText('好友' + BOARD_NAME[view.board] + '榜', W / 2, 78);

  var rows = view.rows || [];
  ctx.font = '26px sans-serif';
  ctx.fillStyle = C.textSub;
  ctx.fillText(rows.length ? '你超过了 ' + view.beat + ' 位好友' : '还没有好友上榜', W / 2, 124);

  line(pad + 24, 150, W - pad - 24);

  if (!rows.length) {
    ctx.fillStyle = C.textSub;
    ctx.font = '28px sans-serif';
    ctx.fillText('分享给好友,一起卷个高分', W / 2, H / 2);
    return;
  }

  // 我掉出可见行时,末行让位给"我"那一行,保证自己永远在榜上看得见(子域不做滚动)
  var meAt = indexOfMe(rows);
  var visible = Math.min(rows.length, MAX_ROWS);
  var pinSelf = meAt >= visible;
  var listed = pinSelf ? visible - 1 : visible;

  var top = 176;
  var step = 88;
  for (var i = 0; i < listed; i++) drawRow(rows[i], i + 1, pad + 24, top + i * step, W - pad * 2 - 48);

  if (pinSelf) {
    var y = top + listed * step;
    dashLine(pad + 24, y + 22, W - pad - 24);
    drawRow(rows[meAt], meAt + 1, pad + 24, y + 34, W - pad * 2 - 48);
  }
}

/** 结算横幅"本局击败了 X 位好友"。 */
function drawBeat(W) {
  var rows = view.rows || [];
  var h = BEAT_BAND - 24;
  var y = 12;
  var x = 20;
  var w = W - 40;

  roundRect(x, y, w, h, 24);
  ctx.fillStyle = C.panel;
  ctx.fill();
  ctx.lineWidth = 6;
  ctx.strokeStyle = C.edge;
  ctx.stroke();

  ctx.textAlign = 'center';
  if (!rows.length) {
    ctx.fillStyle = C.textSub;
    ctx.font = '30px sans-serif';
    ctx.fillText('还没有好友上榜', W / 2, y + h / 2 + 10);
    return;
  }

  ctx.fillStyle = C.textDark;
  ctx.font = 'bold 40px sans-serif';
  ctx.fillText('本局击败了 ' + view.beat + ' 位好友', W / 2, y + 74);

  ctx.font = '26px sans-serif';
  ctx.fillStyle = C.textSub;
  var tip = view.next
    ? '再多 ' + (view.next.score - view.myScore + 1) + ' ' + BOARD_UNIT[view.board] + '就能超过 ' + clip(view.next.name, 180, '26px sans-serif')
    : '你就是好友里的第一名';
  ctx.fillText(tip, W / 2, y + 130);
}

function drawRow(row, rank, x, y, w) {
  var h = 76;
  roundRect(x, y, w, h, 16);
  ctx.fillStyle = row.me ? C.selfRow : C.row;
  ctx.fill();
  if (row.me) {
    ctx.lineWidth = 4;
    ctx.strokeStyle = C.primary;
    ctx.stroke();
  }

  ctx.textAlign = 'center';
  ctx.fillStyle = rank <= 3 ? C.primary : C.textSub;
  ctx.font = 'bold 30px sans-serif';
  ctx.fillText(String(rank), x + 34, y + 49);

  drawAvatar(row.avatar, x + 62, y + 8, 60);

  ctx.textAlign = 'left';
  ctx.fillStyle = C.textDark;
  ctx.font = (row.me ? 'bold ' : '') + '28px sans-serif';
  var nameW = w - 300;
  ctx.fillText(row.me ? '我' : clip(row.name, nameW, '28px sans-serif'), x + 134, y + 48);

  ctx.textAlign = 'right';
  ctx.font = 'bold 32px sans-serif';
  ctx.fillText(row.score + BOARD_UNIT[view.board], x + w - 20, y + 49);
}

/** 圆形头像。异步下载,回来后重画整屏(一次 draw 很便宜,不值当做局部刷新)。 */
function drawAvatar(url, x, y, size) {
  var slot = url ? avatars[url] : null;
  if (url && !slot) {
    slot = avatars[url] = { img: wx.createImage(), ok: false };
    slot.img.onload = function () { slot.ok = true; draw(); };
    slot.img.onerror = function () { /* 头像挂了就一直留占位圆,不重试 */ };
    slot.img.src = url;
  }

  ctx.save();
  ctx.beginPath();
  ctx.arc(x + size / 2, y + size / 2, size / 2, 0, Math.PI * 2);
  ctx.closePath();
  ctx.clip();
  if (slot && slot.ok) {
    ctx.drawImage(slot.img, x, y, size, size);
  } else {
    ctx.fillStyle = C.edge;
    ctx.fillRect(x, y, size, size);
  }
  ctx.restore();
}

// —— 小工具 ——

function indexOfMe(rows) {
  for (var i = 0; i < rows.length; i++) if (rows[i].me) return i;
  return -1;
}

function toInt(v) {
  var n = Math.floor(Number(v));
  return isFinite(n) && n > 0 ? n : 0;
}

/** 昵称按像素宽度截断,超出补省略号(微信昵称可以很长,画出去就糊在分数上了)。 */
function clip(text, maxW, font) {
  ctx.font = font;
  if (ctx.measureText(text).width <= maxW) return text;
  for (var n = text.length - 1; n > 0; n--) {
    var s = text.slice(0, n) + '…';
    if (ctx.measureText(s).width <= maxW) return s;
  }
  return '…';
}

function roundRect(x, y, w, h, r) {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + w, y, x + w, y + h, r);
  ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r);
  ctx.arcTo(x, y, x + w, y, r);
  ctx.closePath();
}

function line(x1, y, x2) {
  ctx.beginPath();
  ctx.moveTo(x1, y);
  ctx.lineTo(x2, y);
  ctx.lineWidth = 2;
  ctx.strokeStyle = C.shadow;
  ctx.stroke();
}

function dashLine(x1, y, x2) {
  for (var x = x1; x < x2; x += 18) line(x, y, Math.min(x + 10, x2));
}
