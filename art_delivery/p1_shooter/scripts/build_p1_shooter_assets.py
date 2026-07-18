#!/usr/bin/env python3
"""把 image_gen 透明源图整理成可直接导入 Cocos Creator 的射击玩法资源。"""

from __future__ import annotations

import json
import math
import plistlib
import random
from pathlib import Path

from PIL import Image, ImageDraw, ImageEnhance, ImageFont, ImageOps


ROOT = Path(__file__).resolve().parents[1]
PROJECT = ROOT.parents[1]
SOURCE = ROOT / "source" / "alpha"
ASSETS = ROOT / "assets"
ATLASES = ROOT / "atlases"
PREVIEW = ROOT / "preview"
P0_ASSETS = PROJECT / "art_delivery" / "p0" / "assets"

RESAMPLE = Image.Resampling.LANCZOS
FONT_PATH = "/System/Library/Fonts/Hiragino Sans GB.ttc"


def ensure_dirs() -> None:
    for relative in ("fx", "enemies", "gates", "barriers", "obstacles", "barrels"):
        (ASSETS / relative).mkdir(parents=True, exist_ok=True)
    ATLASES.mkdir(parents=True, exist_ok=True)
    PREVIEW.mkdir(parents=True, exist_ok=True)


def alpha_bbox(image: Image.Image, threshold: int = 8):
    alpha = image.convert("RGBA").getchannel("A")
    return alpha.point(lambda value: 255 if value > threshold else 0).getbbox()


def trim_alpha(image: Image.Image, pad: int = 4) -> Image.Image:
    image = image.convert("RGBA")
    bbox = alpha_bbox(image)
    if bbox is None:
        return Image.new("RGBA", (1, 1), (0, 0, 0, 0))
    return image.crop(
        (
            max(0, bbox[0] - pad),
            max(0, bbox[1] - pad),
            min(image.width, bbox[2] + pad),
            min(image.height, bbox[3] + pad),
        )
    )


def fit_canvas(
    image: Image.Image,
    size: tuple[int, int],
    pad: int = 6,
    anchor: str = "center",
) -> Image.Image:
    image = trim_alpha(image)
    max_w = max(1, size[0] - pad * 2)
    max_h = max(1, size[1] - pad * 2)
    scale = min(max_w / image.width, max_h / image.height)
    new_size = (
        max(1, round(image.width * scale)),
        max(1, round(image.height * scale)),
    )
    image = image.resize(new_size, RESAMPLE)
    canvas = Image.new("RGBA", size, (0, 0, 0, 0))
    x = (size[0] - new_size[0]) // 2
    if anchor == "bottom":
        y = size[1] - pad - new_size[1]
    elif anchor == "top":
        y = pad
    else:
        y = (size[1] - new_size[1]) // 2
    canvas.alpha_composite(image, (x, y))
    return canvas


def grid_cell(
    image: Image.Image,
    cols: int,
    rows: int,
    col: int,
    row: int,
) -> Image.Image:
    return image.crop(
        (
            round(col * image.width / cols),
            round(row * image.height / rows),
            round((col + 1) * image.width / cols),
            round((row + 1) * image.height / rows),
        )
    )


def quantize_rgba(image: Image.Image, colors: int = 224) -> Image.Image:
    return image.convert("RGBA").quantize(
        colors=colors,
        method=Image.Quantize.FASTOCTREE,
        dither=Image.Dither.NONE,
    ).convert("RGBA")


def save_png(image: Image.Image, relative: str, colors: int = 224) -> Path:
    path = ASSETS / relative
    path.parent.mkdir(parents=True, exist_ok=True)
    image = quantize_rgba(image, colors)
    image.save(path, "PNG", optimize=True, compress_level=9)
    return path


def build_projectile_fx() -> None:
    bullets = Image.open(SOURCE / "bullet_garlic_sheet_alpha.png").convert("RGBA")
    bullet_specs = (
        (0, "small", (24, 36)),
        (1, "medium", (28, 42)),
        (2, "large", (32, 48)),
    )
    for col, label, size in bullet_specs:
        save_png(
            fit_canvas(grid_cell(bullets, 4, 1, col, 0), size, 1, "bottom"),
            f"fx/fx_bullet_garlic_{label}_01.png",
        )

    muzzle = Image.open(SOURCE / "muzzle_spit_sheet_alpha.png").convert("RGBA")
    for col in range(4):
        save_png(
            fit_canvas(grid_cell(muzzle, 4, 1, col, 0), (64, 64), 3),
            f"fx/fx_muzzle_spit_{col + 1:02d}.png",
        )

    hit = Image.open(SOURCE / "hit_spark_sheet_alpha.png").convert("RGBA")
    for col in range(4):
        save_png(
            fit_canvas(grid_cell(hit, 4, 1, col, 0), (64, 64), 3),
            f"fx/fx_hit_spark_{col + 1:02d}.png",
        )


def build_enemy_assets() -> None:
    sheet = Image.open(SOURCE / "enemy_shooter_sheet_alpha.png").convert("RGBA")
    cells = [
        (0, 0, "enemies/enemy_swarm_mold_flow_01.png", (96, 96)),
        (1, 0, "enemies/enemy_swarm_mold_flow_02.png", (96, 96)),
        (2, 0, "enemies/enemy_swarm_die_01.png", (96, 96)),
        (3, 0, "enemies/enemy_swarm_die_02.png", (96, 96)),
        (0, 1, "enemies/enemy_swarm_die_03.png", (96, 96)),
        (1, 1, "enemies/enemy_thick_flow_01.png", (192, 192)),
        (2, 1, "enemies/enemy_thick_flow_02.png", (192, 192)),
        (3, 1, "enemies/enemy_thick_die_01.png", (192, 192)),
        (0, 2, "enemies/enemy_thick_die_02.png", (192, 192)),
        (1, 2, "enemies/enemy_thick_die_03.png", (192, 192)),
        (2, 2, "enemies/enemy_thick_die_04.png", (192, 192)),
    ]
    for col, row, name, size in cells:
        save_png(fit_canvas(grid_cell(sheet, 4, 3, col, row), size, 5, "bottom"), name)


def build_barrier_assets() -> None:
    parts = Image.open(SOURCE / "barrier_parts_sheet_alpha.png").convert("RGBA")
    save_png(
        fit_canvas(grid_cell(parts, 3, 2, 0, 0), (768, 256), 8, "bottom"),
        "barriers/gate_barrier_body_base_01.png",
    )
    save_png(
        fit_canvas(grid_cell(parts, 3, 2, 1, 0), (192, 320), 8, "bottom"),
        "barriers/gate_barrier_pillar_base_01.png",
    )
    save_png(
        fit_canvas(grid_cell(parts, 3, 2, 2, 0), (512, 64), 2),
        "barriers/gate_barrier_stripe_tile_01.png",
    )
    for col in range(3):
        save_png(
            fit_canvas(grid_cell(parts, 3, 2, col, 1), (768, 256), 8),
            f"barriers/gate_barrier_crack_{col + 1:02d}.png",
        )

    break_effects = Image.open(SOURCE / "barrier_break_sheet_alpha.png").convert("RGBA")
    shock_effects = Image.open(SOURCE / "barrier_fx_sheet_alpha.png").convert("RGBA")
    for col in range(6):
        save_png(
            fit_canvas(grid_cell(break_effects, 6, 1, col, 0), (384, 384), 6),
            f"fx/fx_barrier_break_{col + 1:02d}.png",
        )
        save_png(
            fit_canvas(grid_cell(shock_effects, 6, 2, col, 1), (512, 320), 6),
            f"fx/fx_shockwave_{col + 1:02d}.png",
        )


def build_dimension_gates() -> None:
    sheet = Image.open(SOURCE / "gate_dimension_sheet_alpha.png").convert("RGBA")
    cells = (
        (0, 0, "troop"),
        (1, 0, "lane"),
        (2, 0, "rate"),
        (0, 1, "damage"),
        (1, 1, "trap"),
    )
    for col, row, label in cells:
        save_png(
            fit_canvas(grid_cell(sheet, 3, 2, col, row), (384, 256), 6, "bottom"),
            f"gates/gate_dim_{label}_base_01.png",
        )


def build_obstacle_and_barrel_assets() -> None:
    sheet = Image.open(SOURCE / "obstacle_barrel_sheet_alpha.png").convert("RGBA")
    cells = (
        (0, 0, "obstacles/obstacle_spike_base_01.png", (384, 256)),
        (1, 0, "obstacles/obstacle_roller_01.png", (384, 256)),
        (2, 0, "obstacles/obstacle_roller_02.png", (384, 256)),
        (0, 1, "barrels/barrel_body_base_01.png", (256, 320)),
        (1, 1, "barrels/barrel_crack_01.png", (256, 320)),
        (2, 1, "barrels/barrel_crack_02.png", (256, 320)),
    )
    for col, row, name, size in cells:
        save_png(fit_canvas(grid_cell(sheet, 3, 2, col, row), size, 6, "bottom"), name)

    break_sheet = Image.open(SOURCE / "barrel_break_sheet_alpha.png").convert("RGBA")
    for col in range(4):
        save_png(
            fit_canvas(grid_cell(break_sheet, 4, 1, col, 0), (384, 384), 6),
            f"fx/fx_barrel_break_{col + 1:02d}.png",
        )


def next_power_of_two(value: int) -> int:
    return 1 << max(0, math.ceil(math.log2(max(1, value))))


def pack_shelves(paths: list[Path], atlas_name: str, max_size: int = 2048, pad: int = 4) -> None:
    items = [(path, Image.open(path).convert("RGBA")) for path in paths]
    items.sort(key=lambda item: (item[1].height, item[1].width), reverse=True)
    positions: dict[Path, tuple[int, int]] = {}
    x = y = row_h = used_w = used_h = 0
    for path, image in items:
        if x and x + image.width + pad > max_size:
            x = 0
            y += row_h + pad
            row_h = 0
        if y + image.height > max_size:
            raise RuntimeError(f"{atlas_name} 超出 {max_size}x{max_size}: {path.name}")
        positions[path] = (x, y)
        used_w = max(used_w, x + image.width)
        used_h = max(used_h, y + image.height)
        x += image.width + pad
        row_h = max(row_h, image.height)

    atlas_w = min(max_size, max(64, next_power_of_two(used_w)))
    atlas_h = min(max_size, max(64, next_power_of_two(used_h)))
    atlas = Image.new("RGBA", (atlas_w, atlas_h), (0, 0, 0, 0))
    frames = {}
    for path, image in items:
        px, py = positions[path]
        atlas.alpha_composite(image, (px, py))
        frames[path.name] = {
            "frame": {"x": px, "y": py, "w": image.width, "h": image.height},
            "rotated": False,
            "trimmed": False,
            "spriteSourceSize": {"x": 0, "y": 0, "w": image.width, "h": image.height},
            "sourceSize": {"w": image.width, "h": image.height},
            "pivot": {"x": 0.5, "y": 0.5},
        }

    png_path = ATLASES / f"{atlas_name}.png"
    quantize_rgba(atlas).save(png_path, "PNG", optimize=True, compress_level=9)
    payload = {
        "frames": frames,
        "meta": {
            "app": "codex-built-in-imagegen+pillow",
            "version": "1.0",
            "image": png_path.name,
            "format": "RGBA8888",
            "size": {"w": atlas.width, "h": atlas.height},
            "scale": "1",
        },
    }
    (ATLASES / f"{atlas_name}.json").write_text(
        json.dumps(payload, ensure_ascii=False, indent=2) + "\n",
        encoding="utf-8",
    )

    plist_frames = {}
    for key, info in frames.items():
        frame = info["frame"]
        plist_frames[key] = {
            "frame": f"{{{{{frame['x']},{frame['y']}}},{{{frame['w']},{frame['h']}}}}}",
            "offset": "{0,0}",
            "rotated": False,
            "sourceColorRect": f"{{{{0,0}},{{{frame['w']},{frame['h']}}}}}",
            "sourceSize": f"{{{frame['w']},{frame['h']}}}",
        }
    with (ATLASES / f"{atlas_name}.plist").open("wb") as handle:
        plistlib.dump(
            {
                "frames": plist_frames,
                "metadata": {
                    "format": 2,
                    "realTextureFileName": png_path.name,
                    "size": f"{{{atlas.width},{atlas.height}}}",
                    "smartupdate": "$TexturePacker:Codex$",
                    "textureFileName": png_path.name,
                },
            },
            handle,
            fmt=plistlib.FMT_XML,
            sort_keys=False,
        )


def build_atlases() -> None:
    pack_shelves(sorted((ASSETS / "enemies").glob("*.png")), "p1_shooter_units_atlas")
    pack_shelves(
        sorted((ASSETS / "gates").glob("*.png"))
        + sorted((ASSETS / "barriers").glob("*.png"))
        + sorted((ASSETS / "obstacles").glob("*.png"))
        + sorted((ASSETS / "barrels").glob("*.png")),
        "p1_shooter_world_atlas",
    )
    pack_shelves(sorted((ASSETS / "fx").glob("*.png")), "p1_shooter_fx_atlas")


def sprite_at_height(path: Path, height: int) -> Image.Image:
    image = trim_alpha(Image.open(path).convert("RGBA"), 0)
    width = max(1, round(image.width * height / image.height))
    return image.resize((width, height), RESAMPLE)


def paste_center(canvas: Image.Image, sprite: Image.Image, center_x: int, bottom_y: int) -> None:
    canvas.alpha_composite(sprite, (center_x - sprite.width // 2, bottom_y - sprite.height))


def road_bounds(y: int) -> tuple[int, int]:
    t = max(0.0, min(1.0, (y - 180) / 1550))
    return round(360 - 300 * t), round(720 + 300 * t)


def build_gameplay_preview() -> None:
    background_path = P0_ASSETS / "scene" / "scene_marketbridge_background_01.png"
    background = Image.open(background_path).convert("RGB").resize((1080, 1920), RESAMPLE)
    background = ImageEnhance.Brightness(background).enhance(0.62).convert("RGBA")
    draw = ImageDraw.Draw(background, "RGBA")

    draw.polygon([(360, 170), (720, 170), (1040, 1790), (40, 1790)], fill="#8C8279", outline="#2B2420", width=10)
    draw.polygon([(382, 170), (698, 170), (984, 1790), (96, 1790)], fill="#A99A8A")
    draw.line([(540, 170), (540, 1790)], fill="#D4C4AE", width=4)
    for y in range(250, 1760, 130):
        left, right = road_bounds(y)
        draw.line([(left + 12, y), (right - 12, y)], fill=(255, 255, 255, 22), width=2)

    gate_paths = [
        ASSETS / "gates/gate_dim_troop_base_01.png",
        ASSETS / "gates/gate_dim_lane_base_01.png",
        ASSETS / "gates/gate_dim_rate_base_01.png",
        ASSETS / "gates/gate_dim_damage_base_01.png",
    ]
    gate_count_per_wall = 16
    gate_rows = []
    for index in range(gate_count_per_wall):
        t = index / (gate_count_per_wall - 1)
        y = round(250 + 610 * (t ** 1.35))
        height = round(24 + 48 * t)
        gate_rows.append((y, height, index))
    for y, height, index in gate_rows:
        left, right = road_bounds(y)
        road_w = right - left
        sprite_left = sprite_at_height(gate_paths[index % 4], height)
        sprite_right = sprite_at_height(gate_paths[(index + 2) % 4], height)
        paste_center(background, sprite_left, round(left + road_w * 0.18), y)
        paste_center(background, sprite_right, round(right - road_w * 0.18), y)

    rng = random.Random(20260718)
    enemy_path = ASSETS / "enemies/enemy_swarm_mold_flow_01.png"
    enemy_alt = ASSETS / "enemies/enemy_swarm_mold_flow_02.png"
    enemy_count = 128
    enemies = []
    row_counts = (6, 7, 8, 8, 9, 9, 10, 10, 10, 11, 12, 13, 15)
    row_positions = (395, 442, 489, 536, 583, 630, 677, 724, 771, 818, 865, 912, 968)
    index = 0
    for row, (count, y) in enumerate(zip(row_counts, row_positions)):
        left, right = road_bounds(y)
        road_w = right - left
        swarm_left = left + road_w * 0.27
        swarm_right = right - road_w * 0.27
        height = round(20 + 20 * ((y - row_positions[0]) / (row_positions[-1] - row_positions[0])))
        for col in range(count):
            x = swarm_left + (swarm_right - swarm_left) * (col + 0.5) / count
            x += rng.randint(-3, 3)
            jitter_y = rng.randint(-3, 3)
            enemies.append((y + jitter_y, round(x), height, index))
            index += 1
    for y, x, height, index in sorted(enemies):
        sprite = sprite_at_height(enemy_path if index % 2 == 0 else enemy_alt, height)
        paste_center(background, sprite, x, y)

    thick_path = ASSETS / "enemies/enemy_thick_flow_01.png"
    for x, y, height in ((430, 780, 64), (600, 730, 58), (690, 860, 72)):
        paste_center(background, sprite_at_height(thick_path, height), x, y)

    barrier_path = ASSETS / "barriers/gate_barrier_body_base_01.png"
    barrier = sprite_at_height(barrier_path, 142)
    paste_center(background, barrier, 540, 1120)
    number_font = ImageFont.truetype(FONT_PATH, 82)
    draw = ImageDraw.Draw(background)
    label = "621"
    bbox = draw.textbbox((0, 0), label, font=number_font, stroke_width=7)
    draw.text(
        (540 - (bbox[2] - bbox[0]) // 2, 1000),
        label,
        font=number_font,
        fill="#FFFFFF",
        stroke_width=7,
        stroke_fill="#2B2420",
    )

    bullet_path = ASSETS / "fx/fx_bullet_garlic_small_01.png"
    bullet_count = 80
    bullets = []
    for index in range(bullet_count):
        y = rng.randint(870, 1530)
        left, right = road_bounds(y)
        x = rng.randint(left + 45, right - 45)
        width = rng.randint(10, 18)
        bullets.append((y, x, width, index))
    bullet_source = trim_alpha(Image.open(bullet_path).convert("RGBA"), 0)
    for y, x, width, _ in sorted(bullets):
        height = max(1, round(bullet_source.height * width / bullet_source.width))
        paste_center(background, bullet_source.resize((width, height), RESAMPLE), x, y)

    spike = sprite_at_height(ASSETS / "obstacles/obstacle_spike_base_01.png", 94)
    barrel = sprite_at_height(ASSETS / "barrels/barrel_body_base_01.png", 112)
    paste_center(background, spike, 330, 1325)
    paste_center(background, barrel, 745, 1340)

    hero_path = P0_ASSETS / "characters" / "hero_garlicbird_view_back_01.png"
    hero_count = 24
    heroes = []
    for row, count in enumerate((4, 5, 6, 5, 4)):
        y = 1490 + row * 58
        spacing = 60
        start = 540 - (count - 1) * spacing // 2
        for col in range(count):
            heroes.append((y, start + col * spacing, 52 + row * 2))
    for y, x, height in heroes:
        paste_center(background, sprite_at_height(hero_path, height), x, y)

    overlay = Image.new("RGBA", (1080, 132), (16, 42, 56, 224))
    background.alpha_composite(overlay, (0, 0))
    title_font = ImageFont.truetype(FONT_PATH, 39)
    body_font = ImageFont.truetype(FONT_PATH, 25)
    draw = ImageDraw.Draw(background)
    draw.text((38, 22), "射击玩法实机比例验收", font=title_font, fill="#F5F0E6")
    draw.text(
        (40, 78),
        "128 小怪 · 80 子弹 · 24 蒜鸟 · 每侧 16 门（俯视向下迎敌）",
        font=body_font,
        fill="#F2A83B",
    )
    background.save(PREVIEW / "p1_shooter_gameplay_density_preview.png", "PNG", optimize=True)
    (PREVIEW / "preview_metadata.json").write_text(
        json.dumps(
            {
                "enemy_swarm_count": enemy_count,
                "bullet_count": bullet_count,
                "garlicbird_count": hero_count,
                "gates_per_wall": gate_count_per_wall,
                "near_enemy_height_px": 40,
                "garlicbird_height_px": 52,
                "bullet_width_px_range": [10, 18],
                "camera": "35deg_top_down_player_bottom_enemies_charge_down",
            },
            ensure_ascii=False,
            indent=2,
        ) + "\n",
        encoding="utf-8",
    )


def panel(canvas: Image.Image, box: tuple[int, int, int, int], title: str, paths: list[Path], cols: int) -> None:
    draw = ImageDraw.Draw(canvas)
    x1, y1, x2, y2 = box
    draw.rounded_rectangle(box, radius=18, fill="#173E4F", outline="#2D6072", width=2)
    font = ImageFont.truetype(FONT_PATH, 25)
    draw.text((x1 + 18, y1 + 12), title, font=font, fill="#F2A83B")
    inner_y = y1 + 52
    rows = math.ceil(len(paths) / cols)
    cell_w = (x2 - x1 - 28) // cols
    cell_h = max(1, (y2 - inner_y - 14) // rows)
    for index, path in enumerate(paths):
        image = trim_alpha(Image.open(path).convert("RGBA"), 0)
        thumb = ImageOps.contain(image, (cell_w - 10, cell_h - 10), method=RESAMPLE)
        col, row = index % cols, index // cols
        px = x1 + 14 + col * cell_w + (cell_w - thumb.width) // 2
        py = inner_y + row * cell_h + (cell_h - thumb.height) // 2
        canvas.alpha_composite(thumb, (px, py))


def build_overview_preview() -> None:
    canvas = Image.new("RGBA", (1920, 1080), "#102A38")
    draw = ImageDraw.Draw(canvas)
    title_font = ImageFont.truetype(FONT_PATH, 46)
    draw.text((44, 28), "《蒜鸟冲冲冲》P1 Shooter 美术交付总览", font=title_font, fill="#F5F0E6")
    panel(
        canvas,
        (40, 100, 620, 500),
        "小怪（40px 集群剪影）与厚皮怪",
        sorted((ASSETS / "enemies").glob("*.png")),
        4,
    )
    panel(
        canvas,
        (650, 100, 1880, 420),
        "低矮实心维度门：蓝 / 紫 / 橙 / 红 / 黑红",
        sorted((ASSETS / "gates").glob("*.png")),
        5,
    )
    panel(
        canvas,
        (40, 530, 620, 1035),
        "威胁障碍 vs 奖励油桶",
        sorted((ASSETS / "obstacles").glob("*.png")) + sorted((ASSETS / "barrels").glob("*.png")),
        3,
    )
    panel(
        canvas,
        (650, 450, 1280, 1035),
        "射击、命中与奖励特效",
        sorted((ASSETS / "fx").glob("fx_bullet_*.png"))
        + sorted((ASSETS / "fx").glob("fx_muzzle_*.png"))
        + sorted((ASSETS / "fx").glob("fx_hit_*.png"))
        + sorted((ASSETS / "fx").glob("fx_barrel_*.png")),
        4,
    )
    panel(
        canvas,
        (1310, 450, 1880, 1035),
        "射击闸门与突破高潮",
        sorted((ASSETS / "barriers").glob("*.png"))
        + sorted((ASSETS / "fx").glob("fx_barrier_*.png"))[:3]
        + sorted((ASSETS / "fx").glob("fx_shockwave_*.png"))[:3],
        3,
    )
    canvas.convert("RGB").save(PREVIEW / "p1_shooter_delivery_overview.png", "PNG", optimize=True)


def build_readability_preview() -> None:
    canvas = Image.new("RGBA", (1200, 720), "#102A38")
    draw = ImageDraw.Draw(canvas)
    title = ImageFont.truetype(FONT_PATH, 38)
    label = ImageFont.truetype(FONT_PATH, 24)
    draw.text((36, 24), "小尺寸与远距辨识验收", font=title, fill="#F5F0E6")

    draw.rounded_rectangle((36, 96, 560, 370), radius=16, fill="#8E8378")
    enemy_path = ASSETS / "enemies/enemy_swarm_mold_flow_01.png"
    for row in range(4):
        for col in range(9):
            sprite = sprite_at_height(enemy_path, 40)
            paste_center(canvas, sprite, 72 + col * 54, 155 + row * 52)
    draw.text((52, 328), "小怪固定 40px：圆团 + 亮毛冠形成集群前沿", font=label, fill="#FFFFFF")

    draw.rounded_rectangle((590, 96, 1164, 370), radius=16, fill="#3B3F46")
    bullet = trim_alpha(Image.open(ASSETS / "fx/fx_bullet_garlic_small_01.png").convert("RGBA"), 0)
    for row in range(4):
        for col in range(12):
            width = 24
            height = round(bullet.height * width / bullet.width)
            paste_center(canvas, bullet.resize((width, height), RESAMPLE), 620 + col * 45, 155 + row * 52)
    draw.text((606, 328), "子弹固定 24px 宽：白蒜瓣 + 冷色拖尾", font=label, fill="#FFFFFF")

    draw.rounded_rectangle((36, 402, 1164, 684), radius=16, fill="#173E4F")
    gates = [
        ASSETS / "gates/gate_dim_troop_base_01.png",
        ASSETS / "gates/gate_dim_lane_base_01.png",
        ASSETS / "gates/gate_dim_rate_base_01.png",
        ASSETS / "gates/gate_dim_damage_base_01.png",
    ]
    for index in range(18):
        sprite = sprite_at_height(gates[index % 4], 72)
        paste_center(canvas, sprite, 76 + index * 61, 542)
    spike = sprite_at_height(ASSETS / "obstacles/obstacle_spike_base_01.png", 88)
    barrel = sprite_at_height(ASSETS / "barrels/barrel_body_base_01.png", 116)
    paste_center(canvas, spike, 450, 665)
    paste_center(canvas, barrel, 760, 675)
    draw.text((55, 422), "18 门密排：同形低板，仅靠蓝 / 紫 / 橙 / 红做远距决策", font=label, fill="#F2A83B")
    draw.text((268, 620), "威胁：低矮尖锐 黑红黄", font=label, fill="#FF7068")
    draw.text((810, 620), "奖励：圆润 青蓝白金", font=label, fill="#65E6FF")
    canvas.convert("RGB").save(PREVIEW / "p1_shooter_readability_preview.png", "PNG", optimize=True)


def main() -> None:
    ensure_dirs()
    build_projectile_fx()
    build_enemy_assets()
    build_barrier_assets()
    build_dimension_gates()
    build_obstacle_and_barrel_assets()
    build_atlases()
    build_gameplay_preview()
    build_overview_preview()
    build_readability_preview()


if __name__ == "__main__":
    main()
