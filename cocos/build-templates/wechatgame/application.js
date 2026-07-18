// 构建模板(Cocos build-templates):构建时覆盖生成的 application.js。
// 与 build-templates/web-mobile/application.js 是同一份改动的两个平台副本,改一个记得改另一个。
//
// 相对引擎默认版本,只加了两处:①DEBUG 开关(FPS 面板 + 日志级别);②init() 里的 rAF 兜底。
//
// 为什么需要 rAF 兜底:Cocos 的资源回调派发链是
//     assetManager 完成回调 → utilities.asyncify() → misc.callInNextTick()
//                           → pal/utils.setTimeoutRAF() → requestAnimationFrame()
// setTimeoutRAF 在非编辑器环境下没有任何非 rAF 兜底(pal/utils.ts:205)。
// 宿主在画面不可见/被遮挡时会把 rAF 降到 ~1Hz 甚至完全停发,于是
// builtinResMgr.loadBuiltinAssets() 的回调永远派发不出去 → game.init() 不 resolve
// → bundle 一个都注册不上 → 黑屏,且全程零报错(promise 只是挂着,没有 reject)。
// 微信小游戏同样吃这一发:切后台、跳授权弹窗、播插屏广告时 rAF 都会停,
// 若恰好卡在启动加载链上就再也醒不过来。
//
// 装在 init() 里够用:setTimeoutRAF 是每次调用现取 requestAnimationFrame(不缓存),
// 而 init() 早于 cc.game.init() 的任何一次资源加载。
// 小游戏里没有独立的 window 对象(web-adapter 把 window 挂成了 GameGlobal),故改打 globalThis。

System.register([], function (_export, _context) {
  "use strict";

  var cc, Application;
  function _typeof(o) { "@babel/helpers - typeof"; return _typeof = "function" == typeof Symbol && "symbol" == typeof Symbol.iterator ? function (o) { return typeof o; } : function (o) { return o && "function" == typeof Symbol && o.constructor === Symbol && o !== Symbol.prototype ? "symbol" : typeof o; }, _typeof(o); }
  function _classCallCheck(instance, Constructor) { if (!(instance instanceof Constructor)) { throw new TypeError("Cannot call a class as a function"); } }
  function _defineProperties(target, props) { for (var i = 0; i < props.length; i++) { var descriptor = props[i]; descriptor.enumerable = descriptor.enumerable || false; descriptor.configurable = true; if ("value" in descriptor) descriptor.writable = true; Object.defineProperty(target, _toPropertyKey(descriptor.key), descriptor); } }
  function _createClass(Constructor, protoProps, staticProps) { if (protoProps) _defineProperties(Constructor.prototype, protoProps); if (staticProps) _defineProperties(Constructor, staticProps); Object.defineProperty(Constructor, "prototype", { writable: false }); return Constructor; }
  function _toPropertyKey(arg) { var key = _toPrimitive(arg, "string"); return typeof key === "symbol" ? key : String(key); }
  function _toPrimitive(input, hint) { if (_typeof(input) !== "object" || input === null) return input; var prim = input[Symbol.toPrimitive]; if (prim !== undefined) { var res = prim.call(input, hint || "default"); if (_typeof(res) !== "object") return res; throw new TypeError("@@toPrimitive must return a primitive value."); } return (hint === "string" ? String : Number)(input); }

  // —— 调试开关(本工程新增) ——
  // 上线必须 false:引擎 FPS 面板画在左下角,正好压住结算页的「下一关」按钮。
  // 调试期改 true 就有帧率面板 + INFO 级日志,改完重新构建即可。
  // (本文件是 build-templates,会覆盖构建器生成的那份,所以构建面板上的同名选项不起作用。)
  var DEBUG = false;

  // —— rAF 兜底(本工程新增,理由见文件头) ——
  var RAF_FALLBACK_MS = 250;   // 画面可见时原生 rAF(~16ms)总是先到,这里不会生效
  function installRafFallback() {
    var g = globalThis;
    var raf = g.requestAnimationFrame;
    if (!raf || g.__ccRafFallback) return;
    g.__ccRafFallback = true;
    g.requestAnimationFrame = function (cb) {
      var fired = false;
      function run(t) {
        if (fired) return;
        fired = true;
        cb(t);
      }
      var id = raf.call(g, run);
      setTimeout(function () { run(performance.now()); }, RAF_FALLBACK_MS);
      return id;
    };
    // window 通常就是 GameGlobal 本身;万一适配层换了实现,这里保证两条取用路径拿到同一个补丁
    if (g.window && g.window !== g) g.window.requestAnimationFrame = g.requestAnimationFrame;
  }

  return {
    setters: [],
    execute: function () {
      _export("Application", Application = /*#__PURE__*/function () {
        function Application() {
          _classCallCheck(this, Application);
          this.settingsPath = 'src/settings.json';
          this.showFPS = DEBUG;
        }
        _createClass(Application, [{
          key: "init",
          value: function init(engine) {
            cc = engine;
            installRafFallback();   // 必须早于 cc.game.init(),否则加载链已经挂住
            cc.game.onPostBaseInitDelegate.add(this.onPostInitBase.bind(this));
            cc.game.onPostSubsystemInitDelegate.add(this.onPostSystemInit.bind(this));
          }
        }, {
          key: "onPostInitBase",
          value: function onPostInitBase() {
            // cc.settings.overrideSettings('assets', 'server', '');
            // do custom logic
          }
        }, {
          key: "onPostSystemInit",
          value: function onPostSystemInit() {
            // do custom logic
          }
        }, {
          key: "start",
          value: function start() {
            return cc.game.init({
              debugMode: DEBUG ? cc.DebugMode.INFO : cc.DebugMode.ERROR,
              settingsPath: this.settingsPath,
              overrideSettings: {
                // assets: {
                //      preloadBundles: [{ bundle: 'main', version: 'xxx' }],
                // }
                profiling: {
                  showFPS: this.showFPS
                }
              }
            }).then(function () {
              return cc.game.run();
            });
          }
        }]);
        return Application;
      }());
    }
  };
});
