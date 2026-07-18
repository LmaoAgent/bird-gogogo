# 《蒜鸟的战斗》P0 美术生成提示词

执行模式：Codex 内置 `image_gen`。透明资源先生成在纯色 `#FF00FF` 色键背景上，再本地移除色键并校验 alpha。

## 全局风格锚点

- 微信小游戏竖屏，2D/2.5D 卡通游戏美术。
- 魔性、呆萌、高饱和、粗深色描边、大明暗对比，小屏和百人集群中仍清楚。
- 主角色：蒜白 `#F5F0E6`、蒜紫皮 `#C9B8D6`、嘴橙黄 `#F2A83B`、蒜芽绿 `#8FBF4D`。
- 敌方色：霉烂墨绿 `#4A5D2B`、腐黑 `#2B2420`。
- 原创形象，不复刻任何现有角色；无水印、无品牌标识。

## 生成项目

1. `hero_garlicbird_sheet_source.png`：蒜鸟三视图、4 表情、run/cheer/panic 静态关键帧。
2. `enemy_moldling_sheet_source.png`：霉菌怪 flow/die 帧。
3. `boss_rotgarlic_sheet_source.png`：烂蒜魔王 idle/roar/hit/phase2/die。
4. `scene_marketbridge_background_source.png`：菜市场大桥远景。
5. `scene_marketbridge_track_source.png`：可纵向循环的赛道地面与护栏基底。
6. `scene_marketbridge_props_source.png`：挂蒜串、菜筐、路灯、旗帜道具。
7. `gate_frame_sheet_source.png`：蓝、金、紫、红黑四种可拉伸门框。
8. `fx_gateflash_sheet_source.png`：吃门闪光帧。
9. `fx_impact_sheet_source.png`：蒜末与霉菌爆开帧。
10. `ui_kit_sheet_source.png`：按钮、弹窗、血条、进度条、金币/广告/暂停/关闭/星星图标。
11. `ui_home_source.png`：主界面视觉稿。
12. `ui_hud_source.png`：关卡 HUD 视觉稿。
13. `ui_result_win_source.png`：通关结算视觉稿。
14. `ui_result_fail_source.png`：失败页视觉稿。
15. `brand_logo_source.png`：游戏 Logo。
16. `brand_appicon_source.png`：微信小游戏方形图标。

## 最终提示词集

以下为实际生成时使用的结构化提示词集。除场景整图与方形图标外，透明资源均附加统一约束：`#FF00FF` 纯色色键背景、无地面/阴影/文字/水印、主体不使用色键色、轮廓清晰并留足间距。

### 1. 蒜鸟角色锚点

```text
Use case: stylized-concept
Asset type: production-ready 2D mobile game character turnaround and animation key-pose sprite sheet
Primary request: original Garlic Bird mascot; plump single-clove garlic plus tiny bird; exact 4x3 contact sheet.
Subject: garlic-white bulb with three clove grooves, short orange beak, deadpan circular eyes, tiny green sprout, wings and short legs.
Composition: row 1 front/right/back/three-quarter; row 2 cute blank/panic/smug/speechless; row 3 run/cheer/panic, final cell empty.
Style: high-saturation polished 2D game sprite, thick dark-brown outline, simple cel shading, small-screen readability.
Palette: #F5F0E6, #C9B8D6, #F2A83B, #8FBF4D, #2B2420.
```

### 2. 霉菌怪

```text
Use case: stylized-concept
Asset type: 2D enemy animation sprite sheet
Input: 蒜鸟锚点仅作风格参考。
Subject: squat moss-green mold-spore blob, sour-yellow eyes, comic grumpy mouth, cute and non-gory.
Composition: 4x2; top four loopable flow poses; bottom four die/pop poses.
Palette: #4A5D2B and #2B2420, pale green spores.
```

### 3. 烂蒜魔王

```text
Use case: stylized-concept
Asset type: 2D boss key-pose sprite sheet
Input: 蒜鸟锚点仅作风格参考。
Subject: huge blackened rotten garlic, clove ridges, mold patches, ivory fangs, claw-like arms, yellow-green eyes, mustard-green cracks; comic, non-gory.
Composition: 3x2; idle/roar/hit, phase2/die, final cell empty.
```

### 4. 菜市场大桥远景

```text
Use case: stylized-concept
Asset type: portrait mobile-game parallax background
Scene: bright sky, chunky clouds, old market bridge towers, water, market awnings and distant hanging garlic strings; no playable road.
Composition: vertical 9:16, low horizon, symmetric central negative space, safe zones clear.
Style: high-saturation 2D game art with large low-memory shapes.
```

### 5. 循环赛道

```text
Use case: stylized-concept
Asset type: vertically tileable 2D/2.5D race-track texture
Scene: centered straight stone bridge deck, water strips, teal guardrail bases, garlic paving motifs and sparse lavender lane accents.
Composition: vertical 2:3, orthographic-ish top-down, road 70% width, parallel sides, no perspective convergence or focal landmark.
Constraint: top and bottom visually match for infinite vertical repetition.
```

### 6. 场景道具

```text
Use case: stylized-concept
Asset type: transparent-ready environment prop sheet
Composition: 3x2; hanging garlic braid, vegetable crate, market lamp, pennants, pickle jar, garlic basket.
Style: thick outline, simple cel shading, no glass transparency or fine ropes.
```

### 7. 四类门框

```text
Use case: stylized-concept
Asset type: stretchable gate frame sprite sheet
Composition: 2x2; blue bonus, gold reward, purple/rainbow multiplication, red-black hazard.
Constraint: same front-facing proportions, large empty centers for program-rendered numbers, continuous rails and corners for 9-slice.
```

### 8. 吃门特效

```text
Use case: stylized-concept
Asset type: 8-frame effect sheet
Composition: 4x2 chronological radial flash from ignition to fading sparks.
Subject: chunky cyan, mint, white and gold rays, stars and garlic-shaped flash; opaque shapes for additive blending, no haze.
```

### 9. 撞击特效

```text
Use case: stylized-concept
Asset type: 8-frame impact sheet
Composition: 4x2; top garlic crumbs/lavender flakes/orange spikes, bottom moss spores/rot crumbs/yellow-green spikes.
Constraint: playful, non-gory, opaque chunks, no smoke.
```

### 10. UI 组件板

```text
Use case: stylized-concept
Asset type: reusable 2D mobile-game UI component sheet
Components: blue start button, gold reward button, red restart button, cream modal panel, boss bar, progress bar, and coin/ad/pause/close/star/army icons.
Style: thick dark-brown outlines, chunky bevels, crisp small-size rendering.
Constraint: buttons and bars front-facing and stretchable; blank centers; no text.
```

### 11–14. 核心界面

```text
Use case: ui-mockup
Asset type: shippable portrait mobile-game screen, 9:16, 1080x1920 intent.
Home: Vegetable Market Bridge, Garlic Bird hero and crowd, exact text “蒜鸟的战斗” and “开始游戏”, four entry icons.
HUD: crowd running toward blue/red gates and boss, army “128”, progress “1 / 10”, boss bar and pause.
Win: cheering hero, three stars, “通关!”, “+120”, “金币 ×2”, “下一关”.
Fail: panic hero, “失败”, “看广告复活”, “重开”.
Constraint: supplied hero/environment/UI sources define identity and style; large tap targets, safe-area spacing, no extra copy or watermark.
```

### 15. Logo

```text
Use case: logo-brand
Asset type: production-ready title logo
Primary request: exact Chinese wordmark “蒜鸟的战斗” once on a chunky wooden sign, garlic crown and simple leaves.
Style: vector-friendly high-saturation 2D logo, gold face, cream highlight, dark-brown outline.
Constraint: no English, slogan, extra characters, mockup or watermark.
```

### 16. 方形图标

```text
Use case: logo-brand
Asset type: WeChat mini-game square app icon
Subject: centered close-up Garlic Bird filling 75%, deadpan eyes, short orange beak and green sprout; small contrasting boss silhouette behind.
Scene: cyan-blue radial sky burst, rounded safe crop.
Constraint: no text, logo wordmark, buttons, watermark or tiny details.
```
