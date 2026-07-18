// 微信小游戏分包入口。
//
// 微信要求 game.json 里 subpackages 声明的每个 root 目录下都存在一个 game.js,
// 否则导入即报 code 10009「未找到 ["subpackages"][0]["root"] 对应的 xxx/game.js 文件」。
// 而 Cocos 产出的 assets/art/ 是纯资源包(config.json + import/ + index.js),不含此文件,
// 故由 build-templates 补上 —— 放在模板里而不是直接改产物,下次构建才不会被覆盖掉。
//
// art 分包由 assetManager.loadBundle('art') 驱动(见 game/ArenaView.ts),
// 加载与解析全走 Cocos 自己的 bundle 管线,不经过本文件,所以这里保持空实现即可。
