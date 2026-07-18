# 《蒜鸟冲冲冲》广告接入 Spec（微信小游戏 · 纯 IAA）

> 对应 PRD §6.1。P0 阶段先接**激励视频 + 插屏**，Banner 不用。奖励发放、频控、埋点全部走配置，便于热更调平衡。

## 0. 前提与准备
- 主体：企业，微信小游戏。广告变现需开通**流量主**并创建**广告位 ID（adUnitId）**；开通标准以**微信最新政策为准**（企业主体门槛较低，通常需完成小游戏发布并达到用户量标准）。
- 联调期用**测试 adUnitId**，上线前替换正式 ID。
- 纯广告不涉及虚拟支付 / 版号。

## 1. 广告类型与 API
| 类型 | 微信 API | 用途 | P0 |
|---|---|---|---|
| 激励视频 | `wx.createRewardedVideoAd` | 主力：复活 / 翻倍 / 增益 / 宝箱 | ✔ 核心 |
| 插屏 | `wx.createInterstitialAd` | 关卡间过场 | ✔ 节流 |
| Banner | `wx.createBannerAd` | 常驻横幅 | ✖ 体验优先，不用 |

## 2. 广告位定义（scene）
| scene | 类型 | 触发时机 | 奖励 | 频控 | 未看完 |
|---|---|---|---|---|---|
| `revive` | 激励 | FAIL 后 | 复活续冲（玩法文档 §7） | 每局 ≤ 2 次 | 不发奖 |
| `double` | 激励 | 通关结算点「翻倍」 | 金币 ×2 | 每次通关 1 次 | 不翻倍 |
| `boost` | 激励 | 开局点「增益」 | +50 起始兵力 / 一次乘法 buff | 每局 1 次 | 不发奖 |
| `freebox` | 激励 | 主界面每日宝箱 | 金币 / 皮肤碎片 | 每日 ≤ 5 次 | 不发奖 |
| `inter_level` | 插屏 | 通关/失败后过场 | — | 每 3 关一次且冷却 ≥ 90s；前 5 关不插 | — |

## 3. 封装设计（AdManager，core 层）
统一封装，隐藏微信 API 细节，上层只认 scene：
```ts
type AdScene = 'revive'|'double'|'boost'|'freebox'|'inter_level'
interface AdResult { ended: boolean; error?: string }

class AdManager {
  init(unitMap: Record<AdScene, string>): void   // 注入各 scene 的 adUnitId
  preloadRewarded(): void                         // 预加载激励视频（实例全局复用）
  canShow(scene: AdScene): boolean                // 频控判断（配置驱动）
  showRewarded(scene: AdScene): Promise<AdResult> // resolve 后判 ended 再发奖
  showInterstitial(scene: AdScene): Promise<void>
}
```

### 3.1 激励视频实现要点（伪代码 + 坑）
```ts
// 全局单例，复用同一实例
rewardedAd = wx.createRewardedVideoAd({ adUnitId })
rewardedAd.onError(e => { markUnavailable(); track('ad_error', {scene, ...e}) })
rewardedAd.onClose(res => {
  if (res && res.isEnded) resolve({ ended: true })   // 看完 → 发奖
  else resolve({ ended: false })                     // 中途退 → 不发奖
})
async show(scene) {
  track('ad_request', {scene})
  try { await rewardedAd.show() }
  catch { await rewardedAd.load(); await rewardedAd.show() }  // 失败重载再 show
  track('ad_show', {scene})
}
```
**坑位清单**：
- **实例全局复用**，不要每次 `new`（微信激励视频建议单例）。
- **只认 `onClose` 的 `isEnded === true` 才发奖**，防跳过白拿。
- **加载失败 / 无填充**：`canShow` 返回 false 时按钮置灰或隐藏，别让玩家点了没反应。
- **预加载**：进游戏即 preload；每次 show 后重新 `load()` 备下一次。
- iOS：纯激励视频不受虚拟支付限制，正常可用。

### 3.2 插屏要点
- 实例复用 + `onError` 容错。
- 频控：LevelManager 结算后询问 `canShow('inter_level')`，满足才 show。
- **不在 FAIL 第一屏立刻插**（挫败叠加）——放在「重开/返回」动作后，或通关正反馈时。

## 4. 频控规则（配置化，可远程热更）
| scene | 规则 |
|---|---|
| revive | 每局 ≤ 2 次 |
| double | 每次通关 1 次机会 |
| boost | 每局 1 次 |
| freebox | 每日 ≤ 5 次 |
| inter_level | 每 3 关一次 且 冷却 ≥ 90s；新手前 5 关不插 |
- 参数存配置表，运营可远程调（平衡 eCPM 与留存）。

## 5. 奖励发放与防作弊
- P0 纯 IAA：奖励**前端发放**（复活 / 金币），可接受。
- 后续若奖励价值高或与排行榜挂钩，加**激励视频服务端回调**（微信 server callback）校验后发奖。P0 不做，**预留接口**。

## 6. 埋点
| 事件 | 字段 |
|---|---|
| `ad_request` | scene, adType, adUnitId |
| `ad_show` | scene, adType |
| `ad_close` | scene, ended(bool) |
| `ad_reward` | scene, rewardType, rewardValue |
| `ad_error` | scene, errCode, errMsg |
- 核心分析：各 scene 的**请求→展示→完成漏斗**、IPU、eCPM、渗透率；`revive` / `double` 的点击率是收入大头。

## 7. 与工程骨架的接线
- `AdManager` 属 core 层，`GameController` / `LevelManager` / UI 经它触发广告。
- **P0 只需**：Result/Fail UI 的「翻倍 / 复活」按钮 → `showRewarded` → 按 `ended` 发奖。
- `boost` / `freebox` / `inter_level` 放 **P1** 补齐。
- 上线前：替换正式 `adUnitId` + 完成流量主开通。
