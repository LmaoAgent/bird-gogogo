#!/usr/bin/env python3
"""P0 美术资源自动验收。失败时返回非零状态。"""

from __future__ import annotations

import json
import re
import sys
from pathlib import Path

from PIL import Image, ImageChops, ImageStat


ROOT = Path(__file__).resolve().parents[1]
ASSETS = ROOT / "assets"
ATLASES = ROOT / "atlases"

checks: list[dict] = []


def record(name: str, passed: bool, detail: str) -> None:
    checks.append({"name": name, "passed": bool(passed), "detail": detail})


def check_required() -> None:
    required = [
        "characters/hero_garlicbird_run_01.png",
        "characters/hero_garlicbird_cheer_01.png",
        "characters/hero_garlicbird_panic_01.png",
        "enemies/enemy_moldling_flow_01.png",
        "enemies/enemy_moldling_die_04.png",
        "boss/boss_rotgarlic_idle_01.png",
        "boss/boss_rotgarlic_roar_01.png",
        "boss/boss_rotgarlic_hit_01.png",
        "boss/boss_rotgarlic_phase2_01.png",
        "boss/boss_rotgarlic_die_01.png",
        "scene/scene_marketbridge_background_01.png",
        "scene/scene_marketbridge_track_tile_01.png",
        "gates/gate_bonus_blue_base_01.png",
        "gates/gate_reward_gold_base_01.png",
        "gates/gate_multiplier_purple_base_01.png",
        "gates/gate_trap_red_base_01.png",
        "fonts/font_gate_bonus_01.png",
        "fonts/font_gate_bonus_01.fnt",
        "fonts/font_gate_trap_01.png",
        "fonts/font_gate_trap_01.fnt",
        "fx/fx_gateflash_play_08.png",
        "fx/fx_impact_garlic_04.png",
        "fx/fx_impact_mold_04.png",
        "ui/ui_screen_home_base_01.png",
        "ui/ui_screen_hud_base_01.png",
        "ui/ui_bar_boss_base_01.png",
        "ui/ui_screen_result_win_01.png",
        "ui/ui_screen_result_fail_01.png",
        "branding/brand_logo_main_01.png",
        "branding/brand_appicon_wechat_01.png",
    ]
    missing = [path for path in required if not (ASSETS / path).is_file()]
    record("P0 必需资源覆盖", not missing, "缺失: " + ", ".join(missing) if missing else f"{len(required)} 个关键入口均存在")


def check_names() -> None:
    bad = []
    pattern = re.compile(r"^[a-z0-9_]+\.(?:png|fnt)$")
    for path in ASSETS.rglob("*"):
        if path.is_file() and not pattern.fullmatch(path.name):
            bad.append(path.relative_to(ROOT).as_posix())
    record("命名规范", not bad, "全部为小写下划线" if not bad else "不合规: " + ", ".join(bad))


def check_pngs() -> None:
    bad_mode = []
    odd_sizes = []
    empty_alpha = []
    pngs = sorted(ASSETS.rglob("*.png")) + sorted(ATLASES.glob("*.png"))
    for path in pngs:
        image = Image.open(path)
        if image.mode != "RGBA":
            bad_mode.append(f"{path.name}:{image.mode}")
        if image.width % 2 or image.height % 2:
            odd_sizes.append(f"{path.name}:{image.size}")
        if image.mode == "RGBA" and path.parent.name not in {"ui", "scene", "branding"}:
            if image.getchannel("A").getextrema()[0] != 0:
                empty_alpha.append(path.name)
    record("PNG RGBA 模式", not bad_mode, f"{len(pngs)} 张 PNG 均为 RGBA" if not bad_mode else ", ".join(bad_mode))
    record("@2x 偶数像素基准", not odd_sizes, "所有最终 PNG 宽高均为偶数" if not odd_sizes else ", ".join(odd_sizes))
    record("透明通道有效", not empty_alpha, "精灵与图集均含透明像素" if not empty_alpha else "无透明像素: " + ", ".join(empty_alpha))


def check_dimensions() -> None:
    expected = {
        "scene/scene_marketbridge_background_01.png": (1080, 1920),
        "ui/ui_screen_home_base_01.png": (1080, 1920),
        "ui/ui_screen_hud_base_01.png": (1080, 1920),
        "ui/ui_screen_result_win_01.png": (1080, 1920),
        "ui/ui_screen_result_fail_01.png": (1080, 1920),
        "branding/brand_appicon_wechat_01.png": (1024, 1024),
    }
    mismatches = []
    for relative, size in expected.items():
        actual = Image.open(ASSETS / relative).size
        if actual != size:
            mismatches.append(f"{relative}={actual}")
    record("设计分辨率与图标尺寸", not mismatches, "竖屏基准 1080x1920，图标 1024x1024" if not mismatches else ", ".join(mismatches))


def overlap(a, b) -> bool:
    return not (
        a["x"] + a["w"] <= b["x"]
        or b["x"] + b["w"] <= a["x"]
        or a["y"] + a["h"] <= b["y"]
        or b["y"] + b["h"] <= a["y"]
    )


def check_atlases() -> None:
    problems = []
    summaries = []
    for json_path in sorted(ATLASES.glob("*.json")):
        payload = json.loads(json_path.read_text(encoding="utf-8"))
        image_path = ATLASES / payload["meta"]["image"]
        image = Image.open(image_path)
        frames = payload["frames"]
        rects = [(name, item["frame"]) for name, item in frames.items()]
        for name, rect in rects:
            if rect["x"] < 0 or rect["y"] < 0 or rect["x"] + rect["w"] > image.width or rect["y"] + rect["h"] > image.height:
                problems.append(f"{json_path.name}:{name} 越界")
        for index, (name_a, rect_a) in enumerate(rects):
            for name_b, rect_b in rects[index + 1 :]:
                if overlap(rect_a, rect_b):
                    problems.append(f"{json_path.name}:{name_a}/{name_b} 重叠")
        plist_path = json_path.with_suffix(".plist")
        if not plist_path.is_file():
            problems.append(f"缺少 {plist_path.name}")
        if max(image.size) > 2048:
            problems.append(f"{image_path.name} 超过 2048")
        summaries.append(f"{image_path.name}:{len(frames)} 帧/{image.width}x{image.height}")
    record("图集无溢出与无重叠", not problems, "; ".join(summaries) if not problems else "; ".join(problems))


def check_track_seam() -> None:
    path = ASSETS / "scene/scene_marketbridge_track_tile_01.png"
    image = Image.open(path).convert("RGB")
    first = image.crop((0, 0, image.width, 1))
    last = image.crop((0, image.height - 1, image.width, image.height))
    diff = ImageStat.Stat(ImageChops.difference(first, last)).mean
    mean = sum(diff) / len(diff)
    record("赛道纵向循环接缝", mean < 3.0, f"首尾行平均 RGB 差值 {mean:.3f}（阈值 < 3.0）")


def check_fonts() -> None:
    expected = {ord(char) for char in "0123456789+-×÷"}
    problems = []
    for name in ("gate_bonus", "gate_trap"):
        path = ASSETS / f"fonts/font_{name}_01.fnt"
        ids = set()
        for line in path.read_text(encoding="utf-8").splitlines():
            if line.startswith("char id="):
                ids.add(int(line.split()[1].split("=")[1]))
        if ids != expected:
            problems.append(f"{name}: {sorted(expected - ids)}")
    record("位图数字字体字形", not problems, "两套字体均含 0-9、+、-、×、÷" if not problems else "; ".join(problems))


def check_startup_size() -> None:
    path = ROOT / "p0_startup_manifest.json"
    manifest = json.loads(path.read_text(encoding="utf-8"))
    total = sum((ROOT / item["path"]).stat().st_size for item in manifest["files"])
    passed = total == manifest["total_bytes"] and total <= manifest["limit_bytes"]
    record("首包体积", passed, f"{total} / {manifest['limit_bytes']} 字节（{total / 1024 / 1024:.2f} MiB）")


def main() -> int:
    check_required()
    check_names()
    check_pngs()
    check_dimensions()
    check_atlases()
    check_track_seam()
    check_fonts()
    check_startup_size()
    passed = all(item["passed"] for item in checks)
    payload = {"passed": passed, "checks": checks}
    (ROOT / "acceptance_report.json").write_text(
        json.dumps(payload, ensure_ascii=False, indent=2) + "\n",
        encoding="utf-8",
    )
    print(json.dumps(payload, ensure_ascii=False, indent=2))
    return 0 if passed else 1


if __name__ == "__main__":
    sys.exit(main())
