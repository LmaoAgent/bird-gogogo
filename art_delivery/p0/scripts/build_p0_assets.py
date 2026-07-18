#!/usr/bin/env python3
"""把内置 image_gen 原图整理成可导入 Cocos Creator 的 P0 资源包。"""

from __future__ import annotations

import json
import math
import plistlib
from pathlib import Path

from PIL import Image, ImageChops, ImageDraw, ImageFont, ImageOps


ROOT = Path(__file__).resolve().parents[1]
SOURCE = ROOT / "source"
ALPHA = SOURCE / "alpha"
ASSETS = ROOT / "assets"
ATLASES = ROOT / "atlases"
PREVIEW = ROOT / "preview"

RESAMPLE = Image.Resampling.LANCZOS


def ensure_dirs() -> None:
    for path in (ASSETS, ATLASES, PREVIEW):
        path.mkdir(parents=True, exist_ok=True)


def alpha_bbox(image: Image.Image, threshold: int = 4):
    alpha = image.getchannel("A")
    mask = alpha.point(lambda value: 255 if value > threshold else 0)
    return mask.getbbox()


def trim_alpha(image: Image.Image, pad: int = 6) -> Image.Image:
    image = image.convert("RGBA")
    bbox = alpha_bbox(image)
    if bbox is None:
        return Image.new("RGBA", (1, 1), (0, 0, 0, 0))
    left = max(0, bbox[0] - pad)
    top = max(0, bbox[1] - pad)
    right = min(image.width, bbox[2] + pad)
    bottom = min(image.height, bbox[3] + pad)
    return image.crop((left, top, right, bottom))


def fit_canvas(
    image: Image.Image,
    size: tuple[int, int],
    pad: int = 12,
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


def quantize_rgba(image: Image.Image, colors: int) -> Image.Image:
    """限制色表后转回 RGBA，保留交付模式并降低小游戏首包体积。"""
    return image.convert("RGBA").quantize(
        colors=colors,
        method=Image.Quantize.FASTOCTREE,
        dither=Image.Dither.NONE,
    ).convert("RGBA")


def save_png(image: Image.Image, relative: str, colors: int | None = None) -> Path:
    path = ASSETS / relative
    path.parent.mkdir(parents=True, exist_ok=True)
    image = image.convert("RGBA")
    if colors is not None:
        image = quantize_rgba(image, colors)
    image.save(path, "PNG", optimize=True, compress_level=9)
    return path


def grid_cell(image: Image.Image, cols: int, rows: int, col: int, row: int) -> Image.Image:
    box = (
        round(col * image.width / cols),
        round(row * image.height / rows),
        round((col + 1) * image.width / cols),
        round((row + 1) * image.height / rows),
    )
    return image.crop(box)


def build_character_assets() -> None:
    hero = Image.open(ALPHA / "hero_garlicbird_sheet_alpha.png").convert("RGBA")
    hero_cells = [
        (0, 0, "characters/hero_garlicbird_view_front_01.png"),
        (1, 0, "characters/hero_garlicbird_view_side_01.png"),
        (2, 0, "characters/hero_garlicbird_view_back_01.png"),
        (3, 0, "characters/hero_garlicbird_view_threequarter_01.png"),
        (0, 1, "characters/hero_garlicbird_expr_cute_01.png"),
        (1, 1, "characters/hero_garlicbird_expr_panic_01.png"),
        (2, 1, "characters/hero_garlicbird_expr_smug_01.png"),
        (3, 1, "characters/hero_garlicbird_expr_speechless_01.png"),
        (0, 2, "characters/hero_garlicbird_run_01.png"),
        (1, 2, "characters/hero_garlicbird_cheer_01.png"),
        (2, 2, "characters/hero_garlicbird_panic_01.png"),
    ]
    for col, row, name in hero_cells:
        save_png(fit_canvas(grid_cell(hero, 4, 3, col, row), (256, 256), 10, "bottom"), name)

    enemy = Image.open(ALPHA / "enemy_moldling_sheet_alpha.png").convert("RGBA")
    for row, state in enumerate(("flow", "die")):
        for col in range(4):
            name = f"enemies/enemy_moldling_{state}_{col + 1:02d}.png"
            save_png(fit_canvas(grid_cell(enemy, 4, 2, col, row), (192, 192), 8, "bottom"), name)

    boss = Image.open(ALPHA / "boss_rotgarlic_sheet_alpha.png").convert("RGBA")
    boss_cells = [
        (0, 0, "boss/boss_rotgarlic_idle_01.png"),
        (1, 0, "boss/boss_rotgarlic_roar_01.png"),
        (2, 0, "boss/boss_rotgarlic_hit_01.png"),
        (0, 1, "boss/boss_rotgarlic_phase2_01.png"),
        (1, 1, "boss/boss_rotgarlic_die_01.png"),
    ]
    for col, row, name in boss_cells:
        save_png(fit_canvas(grid_cell(boss, 3, 2, col, row), (512, 512), 14, "bottom"), name)


def build_scene_assets() -> None:
    background = Image.open(SOURCE / "scene_marketbridge_background_source.png").convert("RGBA")
    background = ImageOps.fit(background, (1080, 1920), method=RESAMPLE)
    save_png(background, "scene/scene_marketbridge_background_01.png")
    save_png(
        background.resize((540, 960), RESAMPLE),
        "scene/scene_marketbridge_background_runtime_01.png",
        colors=224,
    )

    track = Image.open(SOURCE / "scene_marketbridge_track_source.png").convert("RGBA")
    track = ImageOps.fit(track, (1080, 1620), method=RESAMPLE)
    # 把原图内部连续区域移到平铺边界；原图首尾接缝移至中部后做窄带融合。
    track = ImageChops.offset(track, 0, track.height // 2)
    seam = track.height // 2
    blend_half = 72
    top_sample = track.crop((0, seam - blend_half - 1, track.width, seam - blend_half))
    bottom_sample = track.crop((0, seam + blend_half, track.width, seam + blend_half + 1))
    draw = ImageDraw.Draw(track)
    top_pixels = list(top_sample.getdata())
    bottom_pixels = list(bottom_sample.getdata())
    for y in range(seam - blend_half, seam + blend_half):
        t = (y - (seam - blend_half)) / max(1, blend_half * 2 - 1)
        row = Image.new("RGBA", (track.width, 1))
        row.putdata([
            tuple(round(a * (1 - t) + b * t) for a, b in zip(pa, pb))
            for pa, pb in zip(top_pixels, bottom_pixels)
        ])
        track.paste(row, (0, y))
    save_png(track, "scene/scene_marketbridge_track_tile_01.png")
    save_png(
        track.resize((540, 810), RESAMPLE),
        "scene/scene_marketbridge_track_tile_runtime_01.png",
        colors=224,
    )

    props = Image.open(ALPHA / "scene_marketbridge_props_alpha.png").convert("RGBA")
    names = [
        "scene/scene_prop_garlicstring_base_01.png",
        "scene/scene_prop_vegetablecrate_base_01.png",
        "scene/scene_prop_marketlamp_base_01.png",
        "scene/scene_prop_pennant_base_01.png",
        "scene/scene_prop_picklejar_base_01.png",
        "scene/scene_prop_garlicbasket_base_01.png",
    ]
    for index, name in enumerate(names):
        col, row = index % 3, index // 3
        save_png(fit_canvas(grid_cell(props, 3, 2, col, row), (320, 320), 10, "bottom"), name)


def build_gate_and_fx_assets() -> None:
    gates = Image.open(ALPHA / "gate_frame_sheet_alpha.png").convert("RGBA")
    gate_names = [
        "gates/gate_bonus_blue_base_01.png",
        "gates/gate_reward_gold_base_01.png",
        "gates/gate_multiplier_purple_base_01.png",
        "gates/gate_trap_red_base_01.png",
    ]
    for index, name in enumerate(gate_names):
        col, row = index % 2, index // 2
        save_png(fit_canvas(grid_cell(gates, 2, 2, col, row), (384, 512), 12, "bottom"), name)

    gate_fx = Image.open(ALPHA / "fx_gateflash_sheet_alpha.png").convert("RGBA")
    for index in range(8):
        col, row = index % 4, index // 4
        name = f"fx/fx_gateflash_play_{index + 1:02d}.png"
        save_png(fit_canvas(grid_cell(gate_fx, 4, 2, col, row), (256, 256), 6), name)

    impact = Image.open(ALPHA / "fx_impact_sheet_alpha.png").convert("RGBA")
    for row, state in enumerate(("garlic", "mold")):
        for col in range(4):
            name = f"fx/fx_impact_{state}_{col + 1:02d}.png"
            save_png(fit_canvas(grid_cell(impact, 4, 2, col, row), (256, 256), 6), name)


def crop_region(image: Image.Image, box: tuple[int, int, int, int], size, anchor="center"):
    return fit_canvas(image.crop(box), size, 10, anchor)


def build_ui_assets() -> None:
    kit = Image.open(ALPHA / "ui_kit_sheet_alpha.png").convert("RGBA")
    regions = [
        ((0, 110, 390, 480), (512, 224), "ui/ui_button_start_base_01.png"),
        ((375, 110, 775, 480), (512, 224), "ui/ui_button_reward_base_01.png"),
        ((750, 110, 1148, 480), (512, 224), "ui/ui_button_restart_base_01.png"),
        ((0, 430, 540, 980), (704, 640), "ui/ui_panel_common_base_01.png"),
        ((485, 480, 1148, 745), (768, 176), "ui/ui_bar_boss_base_01.png"),
        ((485, 700, 1148, 960), (768, 160), "ui/ui_bar_progress_base_01.png"),
    ]
    for box, size, name in regions:
        save_png(crop_region(kit, box, size), name)

    icon_names = ("coin", "ad", "pause", "close", "star", "army")
    y1, y2 = 945, 1265
    for index, icon_name in enumerate(icon_names):
        x1 = round(index * kit.width / 6)
        x2 = round((index + 1) * kit.width / 6)
        name = f"ui/ui_icon_{icon_name}_base_01.png"
        save_png(crop_region(kit, (x1, y1, x2, y2), (192, 192)), name)

    screen_map = {
        "ui_home_source.png": "ui/ui_screen_home_base_01.png",
        "ui_hud_source.png": "ui/ui_screen_hud_base_01.png",
        "ui_result_win_source.png": "ui/ui_screen_result_win_01.png",
        "ui_result_fail_source.png": "ui/ui_screen_result_fail_01.png",
    }
    for source_name, asset_name in screen_map.items():
        image = Image.open(SOURCE / source_name).convert("RGBA")
        save_png(ImageOps.fit(image, (1080, 1920), method=RESAMPLE), asset_name)


def draw_bitmap_font(name: str, inner_fill, inner_stroke) -> None:
    glyphs = "0123456789+-×÷"
    cols, rows = 4, 4
    cell = 256
    image = Image.new("RGBA", (cols * cell, rows * cell), (0, 0, 0, 0))
    draw = ImageDraw.Draw(image)
    font_path = "/System/Library/Fonts/Supplemental/Arial Rounded Bold.ttf"
    font = ImageFont.truetype(font_path, 164)
    chars = []
    for index, glyph in enumerate(glyphs):
        col, row = index % cols, index // cols
        x0, y0 = col * cell, row * cell
        bbox = draw.textbbox((0, 0), glyph, font=font, stroke_width=0)
        gw, gh = bbox[2] - bbox[0], bbox[3] - bbox[1]
        x = x0 + (cell - gw) // 2 - bbox[0]
        y = y0 + (cell - gh) // 2 - bbox[1] - 4
        draw.text(
            (x, y), glyph, font=font, fill=inner_stroke,
            stroke_width=15, stroke_fill="#2B2420",
        )
        draw.text(
            (x, y), glyph, font=font, fill=inner_fill,
            stroke_width=7, stroke_fill=inner_stroke,
        )
        chars.append((glyph, x0, y0, cell, cell))
    png_name = f"font_{name}_01.png"
    png_path = save_png(image, f"fonts/{png_name}")
    fnt_path = ASSETS / "fonts" / f"font_{name}_01.fnt"
    lines = [
        f'info face="Arial Rounded Bold" size=164 bold=1 italic=0 charset="" unicode=1 stretchH=100 smooth=1 aa=1 padding=0,0,0,0 spacing=0,0',
        f"common lineHeight=256 base=214 scaleW={image.width} scaleH={image.height} pages=1 packed=0",
        f'page id=0 file="{png_name}"',
        f"chars count={len(chars)}",
    ]
    for glyph, x, y, width, height in chars:
        lines.append(
            f"char id={ord(glyph)} x={x} y={y} width={width} height={height} "
            "xoffset=0 yoffset=0 xadvance=208 page=0 chnl=15"
        )
    fnt_path.write_text("\n".join(lines) + "\n", encoding="utf-8")


def build_branding_assets() -> None:
    logo = Image.open(ALPHA / "brand_logo_alpha.png").convert("RGBA")
    save_png(fit_canvas(logo, (1024, 512), 18), "branding/brand_logo_main_01.png")
    save_png(fit_canvas(logo, (512, 256), 10), "branding/brand_logo_runtime_01.png", colors=192)
    icon = Image.open(SOURCE / "brand_appicon_source.png").convert("RGBA")
    icon = ImageOps.fit(icon, (1024, 1024), method=RESAMPLE)
    save_png(icon, "branding/brand_appicon_wechat_01.png")
    save_png(icon.resize((256, 256), RESAMPLE), "branding/brand_appicon_wechat_preview_01.png")


def next_power_of_two(value: int) -> int:
    return 1 << max(0, math.ceil(math.log2(max(1, value))))


def pack_shelves(paths: list[Path], atlas_name: str, max_size: int = 2048, pad: int = 4):
    items = []
    for path in paths:
        image = Image.open(path).convert("RGBA")
        items.append((path, image))
    items.sort(key=lambda item: (item[1].height, item[1].width), reverse=True)
    positions = {}
    x = y = row_h = 0
    used_w = used_h = 0
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
        key = path.name
        frames[key] = {
            "frame": {"x": px, "y": py, "w": image.width, "h": image.height},
            "rotated": False,
            "trimmed": False,
            "spriteSourceSize": {"x": 0, "y": 0, "w": image.width, "h": image.height},
            "sourceSize": {"w": image.width, "h": image.height},
            "pivot": {"x": 0.5, "y": 0.5},
        }
    png_path = ATLASES / f"{atlas_name}.png"
    atlas = quantize_rgba(atlas, 224)
    atlas.save(png_path, "PNG", optimize=True, compress_level=9)
    json_path = ATLASES / f"{atlas_name}.json"
    json_path.write_text(
        json.dumps(
            {
                "frames": frames,
                "meta": {
                    "app": "codex-built-in-imagegen+pillow",
                    "version": "1.0",
                    "image": png_path.name,
                    "format": "RGBA8888",
                    "size": {"w": atlas.width, "h": atlas.height},
                    "scale": "1",
                },
            },
            ensure_ascii=False,
            indent=2,
        ) + "\n",
        encoding="utf-8",
    )
    plist_frames = {}
    for key, info in frames.items():
        f = info["frame"]
        plist_frames[key] = {
            "frame": f"{{{{{f['x']},{f['y']}}},{{{f['w']},{f['h']}}}}}",
            "offset": "{0,0}",
            "rotated": False,
            "sourceColorRect": f"{{{{0,0}},{{{f['w']},{f['h']}}}}}",
            "sourceSize": f"{{{f['w']},{f['h']}}}",
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
    character_paths = (
        sorted((ASSETS / "characters").glob("*.png"))
        + sorted((ASSETS / "enemies").glob("*.png"))
        + sorted((ASSETS / "boss").glob("*.png"))
    )
    world_paths = (
        sorted((ASSETS / "gates").glob("*.png"))
        + sorted((ASSETS / "fx").glob("*.png"))
        + sorted((ASSETS / "scene").glob("scene_prop_*.png"))
    )
    ui_paths = (
        sorted((ASSETS / "ui").glob("ui_button_*.png"))
        + sorted((ASSETS / "ui").glob("ui_panel_*.png"))
        + sorted((ASSETS / "ui").glob("ui_bar_*.png"))
        + sorted((ASSETS / "ui").glob("ui_icon_*.png"))
    )
    pack_shelves(character_paths, "p0_characters_atlas")
    pack_shelves(world_paths, "p0_world_atlas")
    pack_shelves(ui_paths, "p0_ui_atlas")


def build_preview() -> None:
    canvas = Image.new("RGB", (1920, 1080), "#102A38")
    draw = ImageDraw.Draw(canvas)
    title_font = ImageFont.truetype("/System/Library/Fonts/Hiragino Sans GB.ttc", 50)
    label_font = ImageFont.truetype("/System/Library/Fonts/Hiragino Sans GB.ttc", 27)
    draw.text((48, 30), "《蒜鸟的战斗》P0 美术交付总览", font=title_font, fill="#F5F0E6")

    tiles = [
        ("主界面", ASSETS / "ui/ui_screen_home_base_01.png", (48, 110, 378, 1010)),
        ("关卡 HUD", ASSETS / "ui/ui_screen_hud_base_01.png", (402, 110, 732, 1010)),
        ("蒜鸟状态", ALPHA / "hero_garlicbird_sheet_alpha.png", (760, 110, 1320, 610)),
        ("烂蒜魔王", ALPHA / "boss_rotgarlic_sheet_alpha.png", (1348, 110, 1872, 500)),
        ("门框", ALPHA / "gate_frame_sheet_alpha.png", (760, 640, 1250, 1030)),
        ("结算", ASSETS / "ui/ui_screen_result_win_01.png", (1280, 530, 1560, 1030)),
        ("失败", ASSETS / "ui/ui_screen_result_fail_01.png", (1590, 530, 1870, 1030)),
    ]
    for label, path, box in tiles:
        image = Image.open(path).convert("RGBA")
        target_w, target_h = box[2] - box[0], box[3] - box[1] - 38
        thumb = ImageOps.contain(image, (target_w, target_h), method=RESAMPLE)
        backing = Image.new("RGBA", (target_w, target_h), "#173E4F")
        backing.alpha_composite(thumb, ((target_w - thumb.width) // 2, (target_h - thumb.height) // 2))
        canvas.paste(backing.convert("RGB"), (box[0], box[1]))
        draw.text((box[0], box[3] - 32), label, font=label_font, fill="#F2A83B")
    preview_path = PREVIEW / "p0_delivery_overview.png"
    canvas.save(preview_path, "PNG", optimize=True, compress_level=9)


def build_startup_manifest() -> None:
    paths = (
        sorted(ATLASES.glob("*.png"))
        + sorted(ATLASES.glob("*.json"))
        + sorted(ATLASES.glob("*.plist"))
        + sorted((ASSETS / "fonts").glob("*"))
        + [
            ASSETS / "scene/scene_marketbridge_background_runtime_01.png",
            ASSETS / "scene/scene_marketbridge_track_tile_runtime_01.png",
            ASSETS / "branding/brand_logo_runtime_01.png",
        ]
    )
    entries = []
    total = 0
    for path in paths:
        size = path.stat().st_size
        total += size
        entries.append({"path": path.relative_to(ROOT).as_posix(), "bytes": size})
    payload = {
        "limit_bytes": 4 * 1024 * 1024,
        "total_bytes": total,
        "within_limit": total <= 4 * 1024 * 1024,
        "files": entries,
    }
    (ROOT / "p0_startup_manifest.json").write_text(
        json.dumps(payload, ensure_ascii=False, indent=2) + "\n",
        encoding="utf-8",
    )


def main() -> None:
    ensure_dirs()
    build_character_assets()
    build_scene_assets()
    build_gate_and_fx_assets()
    build_ui_assets()
    draw_bitmap_font("gate_bonus", "#F7FFF0", "#62C94A")
    draw_bitmap_font("gate_trap", "#F0443A", "#FFF1DD")
    build_branding_assets()
    build_atlases()
    build_preview()
    build_startup_manifest()


if __name__ == "__main__":
    main()
