# 《蒜鸟冲冲冲》排行榜接入 Spec（微信开放数据域 · 好友 PK）

> 对应 PRD §7。目标：好友异步榜 + **好友 PK**，无自建服务器（纯前端 + 微信托管数据），符合 Plan B。

## 0. 目标拆解
1. **好友榜单**：比历史最高关卡、单局最大兵力，展示"我超过了 X 位好友 / 排名第 N"。
2. **好友 PK**（用户核心诉求）：
   - ① **榜单 PK**（被动比）——榜上高亮自己，看和好友差距。
   - ② **定向挑战 PK**（主动）——分享挑战卡给指定好友 → 打同一关 → 结果对比胜负 → 可回敬。
3. 群同玩榜（可选，P2）。

## 1. 关键机制：微信开放数据域（必须先理解）
微信为保护隐私，**好友数据只能在「开放数据域（Open Data Context）子域」里访问**，主域拿不到好友头像/昵称/分数。

- **主域 ↔ 子域**：主域用 `wx.getOpenDataContext().postMessage(data)` 发指令；子域 `wx.onMessage` 监听。
- **渲染**：子域只能画到**共享画布 sharedCanvas**，主域把它当贴图显示（Cocos 用 `SubContextView` 组件）。
- **可用存储 API**：
  - `wx.setUserCloudStorage({KVDataList})` —— 写**自己**的托管数据（主域即可写）。
  - `wx.getFriendCloudStorage({keyList})` —— 读**好友**数据（**只能在子域**），返回含好友 `avatarUrl/nickname` + `KVDataList`。
  - `wx.getGroupCloudStorage({shareTicket, keyList})` —— 群同玩榜（需 shareTicket）。
- **配置**：`game.json` 配 `"openDataContext": "openData"`，入口 `openData/index.js`。

> 记牢：**好友数据的读取与榜单绘制全在子域**；主域只负责触发、显示 sharedCanvas、写自己的分数、承接点击交互。

## 2. 数据设计（用户托管 KV）
通关刷新纪录时，主域 `wx.setUserCloudStorage` 写：

| key | 含义 | value（字符串，wxgame 格式） |
|---|---|---|
| `max_level` | 历史最高关卡 | `{"wxgame":{"score":37,"update_time":1710000000}}` |
| `max_troop` | 单局最大兵力 | `{"wxgame":{"score":880,"update_time":...}}` |

- 用 `wxgame.score` 约定格式，兼容微信托管排序；子域 `getFriendCloudStorage(['max_level'])` 即可拿到好友该 key 数据。

## 3. 主域 ↔ 子域通信协议（postMessage）
```ts
// 主域 → 子域
{ type: 'render',    board: 'max_level' | 'max_troop' }      // 拉好友榜并绘制
{ type: 'showPK',    friendName, friendScore, myScore, level } // 绘制 PK 对比
{ type: 'refresh' }
```
- 子域收 `render` → `getFriendCloudStorage([board])` → 按 score 排序 → 画榜单到 sharedCanvas → 高亮"我" + 顶部"超过 N 位好友"。
- 主域用 `SubContextView` 显示；列表滚动走 Cocos 开放数据域组件的滚动支持。

## 4. 好友 PK 设计

### 4.1 榜单 PK（被动）
- 榜单页：好友排名（头像/昵称/分数）、高亮自己、顶部"排名第 3 / 击败 85% 好友"。
- 入口：主界面排行榜按钮 + **通关结算页弹条**"本局击败了 X 位好友"（结算时拉一次子域小榜）。

### 4.2 定向挑战 PK（主动 · 核心 PK 体感，无服务器）
轻量异步 PK，全靠分享参数传递 + 本地对比：
1. **发起**：A 通关第 10 关（500 兵）→ 点「挑战好友」→
   ```ts
   wx.shareAppMessage({
     query: 'act=challenge&lv=10&score=500&from=<A昵称>',
     title: 'A 用 500 只蒜鸟碾过了第10关，你敢来 PK 吗？',
     imageUrl: <挑战卡片图>
   })
   ```
2. **接受**：B 从卡片进入 → `wx.getLaunchOptionsSync()` / `onShow` 取 `query` → 解析出 `lv=10, score=500` → 直接进第 10 关，HUD 显示"目标：超过好友的 500"。
3. **对比**：B 结算 → 本地对比"你 620 > 好友 500 → **PK 胜利**" → 提供「回敬挑战」（B 反向分享）。
- **优点**：不需要服务器，P1 即可上。
- **局限**：分享参数可篡改、无双向战绩累计。**完整 PK 战绩/胜负记录需轻服务器（微信云开发 CloudBase）**，标为后置增量。

### 4.3 群同玩榜（P2 可选）
- 从群分享进入带 `shareTicket` → 子域 `getGroupCloudStorage(shareTicket, keyList)` → 群内排名。

## 5. Cocos Creator 集成
- 主场景放 **`SubContextView`** 组件显示 sharedCanvas。
- 子域实现二选一：**(推荐) 独立 Cocos 子域工程**（开放数据域模板，用 Cocos 画榜单 UI）；或 `openData/index.js` 原生 Canvas 手绘（更轻但繁琐）。
- 构建：主工程构建微信小游戏 + 子域单独构建输出到 `openData/`。
- 交互分工：**复杂点击（点好友发起挑战）由主域 UI 承接**，子域只管绘制与滚动。

## 6. 埋点
| 事件 | 字段 |
|---|---|
| `rank_open` | board |
| `challenge_send` | level, score |
| `challenge_accept` | level, friendScore |
| `challenge_result` | level, myScore, friendScore, win(bool) |
- 关注：挑战**发起率 → 接受率 → 回敬率**，这是 PK 裂变的核心漏斗。

## 7. 防作弊与隐私
- 托管数据前端可改；好友榜 + 娱乐性 PK 阶段风险可接受（PRD §7）。
- 头像/昵称由好友托管数据自带，一般无需额外授权；如需展示遵循微信最新隐私接口规范。
- 全服榜或奖励强挂钩 → 必须服务器校验（后置）。

## 8. 任务拆解（P1）
| 编号 | 任务 | 依赖 | 验收 | 人天* |
|---|---|---|---|---|
| R01 | 托管数据写入（max_level / max_troop） | Storage | 通关刷新纪录写入成功 | 0.5 |
| R02 | 子域工程 + SubContextView 显示 | R01 | 子域能把好友榜画到主场景 | 2 |
| R03 | 好友榜渲染（排序 / 高亮我 / 超越提示） | R02 | 榜单正确、自己高亮 | 1.5 |
| R04 | 结算页"击败 X 位好友"弹条 | R03 | 通关后展示 | 0.5 |
| R05 | 定向挑战：分享带 query + 进入解析 | — | 从挑战卡进入对应关、显示目标 | 1 |
| R06 | PK 结果本地对比 UI + 回敬 | R05 | 展示胜负、可回敬 | 1 |
| R07 | 埋点接入 | R03, R06 | 事件齐 | 0.5 |

\* 单人粗估，约 **7 人天**。
