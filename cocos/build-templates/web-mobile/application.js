// 构建模板(Cocos build-templates):构建时覆盖生成的 application.js。
// 相对引擎默认版本,只在 init() 里多了一段 rAF 兜底,其余逐字保持默认,便于将来跟引擎版本对齐。
//
// 为什么需要:Cocos 的资源回调派发链是
//     assetManager 完成回调 → utilities.asyncify() → misc.callInNextTick()
//                           → pal/utils.setTimeoutRAF() → requestAnimationFrame()
// setTimeoutRAF 在非编辑器环境下没有任何非 rAF 兜底(pal/utils.ts:205)。
// 浏览器在页面不可见/被遮挡时会把 rAF 降到 ~1Hz 甚至完全停发,于是
// builtinResMgr.loadBuiltinAssets() 的回调永远派发不出去 → game.init() 不 resolve
// → bundle 一个都注册不上 → 黑屏,且全程零报错(promise 只是挂着,没有 reject)。
// 编辑器里不暴露是因为 downloader.limited = !EDITOR 且 setTimeoutRAF 在 EDITOR 下走 setTimeout。
//
// 兜底策略:原生 rAF 照常用(页面可见时它总是先到,兜底定时器空转一次即被 fired 挡掉);
// 页面不可见时原生 rAF 不来,由 setTimeout 接管——被浏览器钳到 ~1s 一次,
// CPU 开销可忽略,但保证加载链一定能往前走,不会永久悬挂。

System.register([], function (_export, _context) {
  "use strict";

  var cc, Application;
  function _typeof(o) { "@babel/helpers - typeof"; return _typeof = "function" == typeof Symbol && "symbol" == typeof Symbol.iterator ? function (o) { return typeof o; } : function (o) { return o && "function" == typeof Symbol && o.constructor === Symbol && o !== Symbol.prototype ? "symbol" : typeof o; }, _typeof(o); }
  function _classCallCheck(instance, Constructor) { if (!(instance instanceof Constructor)) { throw new TypeError("Cannot call a class as a function"); } }
  function _defineProperties(target, props) { for (var i = 0; i < props.length; i++) { var descriptor = props[i]; descriptor.enumerable = descriptor.enumerable || false; descriptor.configurable = true; if ("value" in descriptor) descriptor.writable = true; Object.defineProperty(target, _toPropertyKey(descriptor.key), descriptor); } }
  function _createClass(Constructor, protoProps, staticProps) { if (protoProps) _defineProperties(Constructor.prototype, protoProps); if (staticProps) _defineProperties(Constructor, staticProps); Object.defineProperty(Constructor, "prototype", { writable: false }); return Constructor; }
  function _toPropertyKey(arg) { var key = _toPrimitive(arg, "string"); return typeof key === "symbol" ? key : String(key); }
  function _toPrimitive(input, hint) { if (_typeof(input) !== "object" || input === null) return input; var prim = input[Symbol.toPrimitive]; if (prim !== undefined) { var res = prim.call(input, hint || "default"); if (_typeof(res) !== "object") return res; throw new TypeError("@@toPrimitive must return a primitive value."); } return (hint === "string" ? String : Number)(input); }

  // —— rAF 兜底(本工程新增,理由见文件头) ——
  var RAF_FALLBACK_MS = 250;   // 页面可见时原生 rAF(~16ms)总是先到,这里不会生效
  function installRafFallback() {
    var raf = window.requestAnimationFrame;
    if (!raf || window.__ccRafFallback) return;
    window.__ccRafFallback = true;
    window.requestAnimationFrame = function (cb) {
      var fired = false;
      function run(t) {
        if (fired) return;
        fired = true;
        cb(t);
      }
      var id = raf.call(window, run);
      setTimeout(function () { run(performance.now()); }, RAF_FALLBACK_MS);
      return id;
    };
  }

  return {
    setters: [],
    execute: function () {
      _export("Application", Application = /*#__PURE__*/function () {
        function Application() {
          _classCallCheck(this, Application);
          this.settingsPath = 'src/settings.json';
          this.showFPS = true;
        }
        _createClass(Application, [{
          key: "init",
          value: function init(engine) {
            cc = engine;
            installRafFallback();   // 必须early于 cc.game.init(),否则加载链已经挂住
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
              debugMode: true ? cc.DebugMode.INFO : cc.DebugMode.ERROR,
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
