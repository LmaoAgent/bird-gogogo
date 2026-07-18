# 《蒜鸟冲冲冲》P1 Shooter 美术生成提示词

执行模式：Codex 内置 `image_gen`。没有切换 CLI/API fallback。透明资源先生成在纯色色键背景上，再使用 `remove_chroma_key.py` 本地去背。

## 生成与返工原则

- P0 蒜鸟、霉菌怪、门框与特效源图只作为原创角色身份和 2D 卡通渲染风格参考。
- 用户提供的四张玩法截图只作为镜头、纵深、单位相对尺寸和门墙排列参考；不复刻截图中的士兵、UI、文字或场景。
- 最终游戏镜头固定为玩家在屏幕底部、背面朝上射击；敌群以 35° 左右俯视正面朝屏幕下方奔跑。
- 最终维度门固定为低矮实心数值板，不是拱门、传送门或可穿过的门框。
- 小怪按 40px 高验收，单体只保留“深色圆团 + 亮色毛冠 + 两只脚”的剪影锚点。
- 障碍统一黑 / 红 / 黄、低矮尖锐；奖励桶统一青蓝 / 白 / 金、圆润直立。

## 最终提示词集

### 1. 蒜瓣子弹、命中闪光

```text
Use case: stylized-concept
Asset type: 4x3 production-ready 2D mobile-game projectile/impact sprite sheet.
Row 1: three upward-firing white garlic-clove bullets, small/medium/large, final cell empty.
Row 2: four muzzle-flash placeholders; only their isolated effect regions are retained in post-processing.
Row 3: four chronological white-yellow-cyan hit sparks.
Style: P0 high-saturation 2D cartoon, chunky shapes, very few internal details.
Constraint: 100+ bullets on screen; small bullet readable at 24px width; no text or watermark.
Backdrop: perfectly flat #FF00FF chroma key.
```

### 2. 无角色吐弹特效返工

```text
Use case: stylized-concept
Asset type: exact 4x1 spit-muzzle FX sheet.
Frames: compact white star; narrow white-cyan cone pointing upward; three small droplets; final tiny spark.
Constraint: effects only, no Garlic Bird, character, mouth, weapon or projectile.
Maximum footprint must fit above a 40–56px gameplay Garlic Bird.
Backdrop: perfectly flat #FF00FF chroma key.
```

### 3. 小怪与厚皮怪返工

```text
Use case: stylized-concept
Asset type: exact 4x3 enemy animation sheet.
Gameplay references define only the 35-degree top-down camera, dense enemy carpet charging from track top toward player at bottom, and tiny relative scale.
Tiny swarm: two run-toward-camera poses plus three large-spore death frames; dark compact oval, exaggerated yellow-green crown tuft, two feet, no arms or micro texture.
Thick enemy: 1.8x swarm height and 2.2x width, two run poses and four death frames; broad rotten garlic bulb with three clove lobes and mustard cracks.
Constraint: every living enemy faces screen bottom; swarm remains recognizable at 40px height; no player or floor.
Backdrop: perfectly flat #FF00FF chroma key.
```

### 4. 射击闸门组件

```text
Use case: stylized-concept
Asset type: exact 3x2 shootable barrier component sheet.
Cells: wide low metal body with dark number plate; one compact side pillar; seamless yellow-black top stripe; three progressive isolated crack overlays.
Style: chunky gunmetal, dark outline, industrial threat.
Constraint: horizontal 9-slice body, repeatable stripe, blank number plate, no digits or text.
Backdrop: perfectly flat #FF00FF chroma key.
```

### 5. 射击闸门突破与冲击波

```text
Use case: stylized-concept
Asset type: six barrier-break frames plus six elliptical shockwave frames.
Final barrier-break revision uses the approved low wide rectangular barrier as identity reference.
Sequence: center hit; cracks; jagged hole; left/right halves split; large fragments; fading bolts and sparks.
Constraint: no arch, portal, tall rails, garlic crest, number, text, fireball or smoke.
Shockwave: white-cyan-gold additive elliptical ring expanding toward the player.
Break backdrop: perfectly flat #00FF00 chroma key. Shockwave backdrop: perfectly flat #FF00FF chroma key.
```

### 6. 五类维度门返工

```text
Use case: stylized-concept
Asset type: exact 3x2 dense-row value-gate sprite sheet.
Gameplay references define low solid number boards repeated as a 14–18 piece single-file wall.
Five identical wide opaque panels: troop #3E8FE0, lane #9B5DE5, rate #F49D1A, damage #E5484D, trap #3A2B2B with dark-red bands.
Geometry: width about 1.65x height, thin depth, blank face, short side feet, 35-degree elevated view.
Constraint: never an arch or opening; no icon, number, letter, text or crest; identity must work by color alone.
Backdrop: perfectly flat #FF00FF chroma key.
```

### 7. 障碍与奖励油桶

```text
Use case: stylized-concept
Asset type: exact 3x2 hazard/reward sheet.
Row 1: low wide red-tipped spike obstacle; two black-red-yellow roller poses.
Row 2: intact turquoise reward barrel; two progressive crack states, same scale and silhouette.
Hazards are angular and threatening. Barrel is rounded turquoise with gold hoops and white garlic medallion.
Constraint: palettes and silhouettes must never overlap; no red explosive barrel, skull, flame, text or label.
Backdrop: perfectly flat #FF00FF chroma key.
```

### 8. 奖励桶爆开

```text
Use case: stylized-concept
Asset type: exact 4x1 reward-barrel break sheet.
Frames: bright hit; turquoise/gold shell pieces; gold coins, garlic tokens and green gems spray upward; fading coins and cyan arcs.
Constraint: celebratory reward feedback, no red fire, black smoke, skull or hazard stripe.
Backdrop: perfectly flat #FF00FF chroma key.
```

## 后处理

- 洋红色键素材采用硬色键 + 1px 收边，防止紫 / 红 / 橙维度门被软蒙版误伤。
- 绿色键的横向闸门突破序列采用软蒙版、despill。
- `build_p1_shooter_assets.py` 负责拆帧、统一画布、压色、图集、真实玩法密排预览。
- 第一版拱门和正面站立怪没有进入交付目录。
