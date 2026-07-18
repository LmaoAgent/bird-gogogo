#!/usr/bin/env python3
"""P1 Shooter 美术资源自动验收。失败时返回非零状态。"""

from __future__ import annotations

import json
import math
import re
import sys
from pathlib import Path

from PIL import Image


ROOT = Path(__file__).resolve().parents[1]
ASSETS = ROOT / "assets"
ATLASES = ROOT / "atlases"
PREVIEW = ROOT / "preview"

checks: list[dict] = []


def record(name: str, passed: bool, detail: str) -> None:
    checks.append({"name": name, "passed": bool(passed), "detail": detail})


def required_assets() -> list[str]:
    required = [
        "fx/fx_bullet_garlic_small_01.png",
        "fx/fx_bullet_garlic_medium_01.png",
        "fx/fx_bullet_garlic_large_01.png",
        "barriers/gate_barrier_body_base_01.png",
        "barriers/gate_barrier_pillar_base_01.png",
        "barriers/gate_barrier_stripe_tile_01.png",
        "obstacles/obstacle_spike_base_01.png",
        "barrels/barrel_body_base_01.png",
        "barrels/barrel_crack_01.png",
        "barrels/barrel_crack_02.png",
    ]
    required += [f"fx/fx_muzzle_spit_{index:02d}.png" for index in range(1, 5)]
    required += [f"fx/fx_hit_spark_{index:02d}.png" for index in range(1, 5)]
    required += [f"enemies/enemy_swarm_mold_flow_{index:02d}.png" for index in range(1, 3)]
    required += [f"enemies/enemy_swarm_die_{index:02d}.png" for index in range(1, 4)]
    required += [f"enemies/enemy_thick_flow_{index:02d}.png" for index in range(1, 3)]
    required += [f"enemies/enemy_thick_die_{index:02d}.png" for index in range(1, 5)]
    required += [f"barriers/gate_barrier_crack_{index:02d}.png" for index in range(1, 4)]
    required += [f"fx/fx_barrier_break_{index:02d}.png" for index in range(1, 7)]
    required += [f"fx/fx_shockwave_{index:02d}.png" for index in range(1, 7)]
    required += [
        f"gates/gate_dim_{label}_base_01.png"
        for label in ("troop", "lane", "rate", "damage", "trap")
    ]
    required += [f"obstacles/obstacle_roller_{index:02d}.png" for index in range(1, 3)]
    required += [f"fx/fx_barrel_break_{index:02d}.png" for index in range(1, 5)]
    return required


def check_required() -> None:
    required = required_assets()
    missing = [relative for relative in required if not (ASSETS / relative).is_file()]
    actual = sorted(ASSETS.rglob("*.png"))
    passed = not missing and len(required) == 55 and len(actual) == 55
    detail = f"55/55 张射击玩法资源齐全" if passed else f"缺失 {missing}；实际 {len(actual)} 张"
    record("资源覆盖", passed, detail)


def check_names_and_pngs() -> None:
    pattern = re.compile(r"^[a-z0-9_]+\.png$")
    bad_names = []
    bad_mode = []
    odd_sizes = []
    bad_alpha = []
    for path in sorted(ASSETS.rglob("*.png")):
        if not pattern.fullmatch(path.name):
            bad_names.append(path.name)
        image = Image.open(path)
        if image.mode != "RGBA":
            bad_mode.append(f"{path.name}:{image.mode}")
        if image.width % 2 or image.height % 2:
            odd_sizes.append(f"{path.name}:{image.size}")
        if image.mode == "RGBA":
            minimum, maximum = image.getchannel("A").getextrema()
            if minimum != 0 or maximum < 250:
                bad_alpha.append(f"{path.name}:{(minimum, maximum)}")
    record("命名规范", not bad_names, "全部为小写下划线" if not bad_names else ", ".join(bad_names))
    record("PNG RGBA", not bad_mode, "55 张最终 PNG 均为 RGBA" if not bad_mode else ", ".join(bad_mode))
    record("@2x 偶数尺寸", not odd_sizes, "所有画布宽高为偶数" if not odd_sizes else ", ".join(odd_sizes))
    record("透明通道", not bad_alpha, "所有精灵均含透明与不透明像素" if not bad_alpha else ", ".join(bad_alpha))


def alpha_bbox(path: Path):
    image = Image.open(path).convert("RGBA")
    return image.getchannel("A").point(lambda value: 255 if value > 32 else 0).getbbox()


def check_small_readability() -> None:
    path = ASSETS / "enemies/enemy_swarm_mold_flow_01.png"
    image = Image.open(path).convert("RGBA")
    bbox = alpha_bbox(path)
    assert bbox is not None
    crop = image.crop(bbox)
    width = max(1, round(crop.width * 40 / crop.height))
    tiny = crop.resize((width, 40), Image.Resampling.LANCZOS)
    alpha = tiny.getchannel("A")
    visible = sum(1 for value in alpha.getdata() if value >= 96)
    coverage = visible / (tiny.width * tiny.height)
    passed = tiny.height == 40 and tiny.width >= 22 and coverage >= 0.45
    record("40px 小怪剪影", passed, f"缩放后 {tiny.width}x40，实心覆盖率 {coverage:.2%}")

    bullet_path = ASSETS / "fx/fx_bullet_garlic_small_01.png"
    bullet = Image.open(bullet_path).convert("RGBA")
    bbox = alpha_bbox(bullet_path)
    assert bbox is not None
    crop = bullet.crop(bbox)
    height = max(1, round(crop.height * 24 / crop.width))
    tiny_bullet = crop.resize((24, height), Image.Resampling.LANCZOS)
    visible = sum(1 for value in tiny_bullet.getchannel("A").getdata() if value >= 96)
    coverage = visible / (tiny_bullet.width * tiny_bullet.height)
    passed = tiny_bullet.width == 24 and coverage >= 0.20
    record("24px 子弹辨识", passed, f"缩放后 24x{height}，实心覆盖率 {coverage:.2%}")


def mean_rgb(path: Path) -> tuple[float, float, float]:
    image = Image.open(path).convert("RGBA")
    pixels = [(r, g, b) for r, g, b, a in image.getdata() if a >= 200]
    return tuple(sum(pixel[index] for pixel in pixels) / len(pixels) for index in range(3))


def color_distance(a, b) -> float:
    return math.sqrt(sum((x - y) ** 2 for x, y in zip(a, b)))


def check_gate_language() -> None:
    paths = {
        label: ASSETS / f"gates/gate_dim_{label}_base_01.png"
        for label in ("troop", "lane", "rate", "damage", "trap")
    }
    colors = {label: mean_rgb(path) for label, path in paths.items()}
    rules = {
        "troop": colors["troop"][2] > colors["troop"][0] + 25,
        "lane": colors["lane"][0] > colors["lane"][1] + 25 and colors["lane"][2] > colors["lane"][1] + 25,
        "rate": colors["rate"][0] > 150 and colors["rate"][1] > colors["rate"][2] + 35,
        "damage": colors["damage"][0] > colors["damage"][1] + 70 and colors["damage"][0] > colors["damage"][2] + 55,
        "trap": max(colors["trap"]) < 125,
    }
    pair_distances = [
        color_distance(colors[a], colors[b])
        for index, a in enumerate(colors)
        for b in list(colors)[index + 1 :]
    ]
    geometry_ok = True
    geometry_details = []
    for label, path in paths.items():
        image = Image.open(path).convert("RGBA")
        bbox = alpha_bbox(path)
        assert bbox is not None
        width, height = bbox[2] - bbox[0], bbox[3] - bbox[1]
        center_alpha = image.getpixel((image.width // 2, image.height // 2))[3]
        ratio = width / height
        geometry_ok &= ratio > 1.45 and center_alpha > 220
        geometry_details.append(f"{label}:{ratio:.2f}")
    passed = all(rules.values()) and min(pair_distances) > 28 and geometry_ok
    record(
        "维度门颜色与实心低板几何",
        passed,
        f"最小主色距离 {min(pair_distances):.1f}；宽高比 " + ", ".join(geometry_details),
    )


def check_hazard_reward_separation() -> None:
    spike_path = ASSETS / "obstacles/obstacle_spike_base_01.png"
    barrel_path = ASSETS / "barrels/barrel_body_base_01.png"
    spike_box = alpha_bbox(spike_path)
    barrel_box = alpha_bbox(barrel_path)
    assert spike_box and barrel_box
    spike_ratio = (spike_box[2] - spike_box[0]) / (spike_box[3] - spike_box[1])
    barrel_ratio = (barrel_box[2] - barrel_box[0]) / (barrel_box[3] - barrel_box[1])
    distance = color_distance(mean_rgb(spike_path), mean_rgb(barrel_path))
    passed = spike_ratio > 1.45 and barrel_ratio < 1.05 and distance > 75
    record(
        "障碍与油桶一眼区分",
        passed,
        f"尖刺宽高比 {spike_ratio:.2f}，油桶宽高比 {barrel_ratio:.2f}，平均色距离 {distance:.1f}",
    )


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
    expected = {
        "p1_shooter_units_atlas.json",
        "p1_shooter_world_atlas.json",
        "p1_shooter_fx_atlas.json",
    }
    actual = {path.name for path in ATLASES.glob("*.json")}
    if actual != expected:
        problems.append(f"图集集合 {sorted(actual)}")
    for json_path in sorted(ATLASES.glob("*.json")):
        payload = json.loads(json_path.read_text(encoding="utf-8"))
        image_path = ATLASES / payload["meta"]["image"]
        image = Image.open(image_path)
        frames = list(payload["frames"].items())
        for name, item in frames:
            rect = item["frame"]
            if rect["x"] < 0 or rect["y"] < 0 or rect["x"] + rect["w"] > image.width or rect["y"] + rect["h"] > image.height:
                problems.append(f"{json_path.name}:{name} 越界")
        for index, (name_a, item_a) in enumerate(frames):
            for name_b, item_b in frames[index + 1 :]:
                if overlap(item_a["frame"], item_b["frame"]):
                    problems.append(f"{json_path.name}:{name_a}/{name_b} 重叠")
        if not json_path.with_suffix(".plist").is_file():
            problems.append(f"缺少 {json_path.with_suffix('.plist').name}")
        if max(image.size) > 2048:
            problems.append(f"{image_path.name} 超过 2048")
        summaries.append(f"{image_path.name}:{len(frames)} 帧/{image.width}x{image.height}")
    record("图集无溢出与无重叠", not problems, "; ".join(summaries) if not problems else "; ".join(problems))


def check_manifests_and_previews() -> None:
    manifest = json.loads((ROOT / "integration_manifest.json").read_text(encoding="utf-8"))
    manifest_ok = manifest["asset_count"] == 55 and manifest["runtime_scale_reference"]["near_swarm_enemy_height_px"] == 40
    record("integration_manifest", manifest_ok, "动画、九宫格、pivot、实机比例与视觉语言已登记")

    metadata = json.loads((PREVIEW / "preview_metadata.json").read_text(encoding="utf-8"))
    preview_paths = [
        PREVIEW / "p1_shooter_delivery_overview.png",
        PREVIEW / "p1_shooter_gameplay_density_preview.png",
        PREVIEW / "p1_shooter_readability_preview.png",
    ]
    counts_ok = (
        metadata["enemy_swarm_count"] >= 100
        and metadata["bullet_count"] >= 80
        and 14 <= metadata["gates_per_wall"] <= 18
        and metadata["garlicbird_height_px"] > metadata["near_enemy_height_px"]
    )
    previews_ok = all(path.is_file() for path in preview_paths)
    record(
        "真实玩法密排预览",
        counts_ok and previews_ok,
        f"{metadata['enemy_swarm_count']} 怪 / {metadata['bullet_count']} 弹 / 每侧 {metadata['gates_per_wall']} 门 / 蒜鸟 {metadata['garlicbird_height_px']}px > 小怪 {metadata['near_enemy_height_px']}px",
    )


def check_atlas_package_size() -> None:
    paths = sorted(ATLASES.glob("*"))
    total = sum(path.stat().st_size for path in paths if path.is_file())
    record("三套射击图集体积", total < 2 * 1024 * 1024, f"{total} 字节（{total / 1024 / 1024:.2f} MiB）")


def main() -> int:
    check_required()
    check_names_and_pngs()
    check_small_readability()
    check_gate_language()
    check_hazard_reward_separation()
    check_atlases()
    check_manifests_and_previews()
    check_atlas_package_size()
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
