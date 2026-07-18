#!/bin/bash
# 微信小游戏构建 + 首包体积核对(PRD §9 硬指标:主包 ≤ 4MB)。
#
# 构建参数放 build-wechat.json:平台相关的选项必须写在 packages.wechatgame 下,
# 直接在 --build 字符串里写 "appid=xxx" 是不生效的(实测会被静默忽略)。
# ⚠️ AppID 现在还是 Cocos 的占位号,拿到自己的(人肉待办③)改 build-wechat.json 那一行。
#
# 两条别踩的线:
#   - 不传 buildPath。自定义输出路径会毁掉 asset-db,全部 meta 退化成 importer:"*",
#     美术静默不进包而构建照样报成功。
#   - 别看退出码。构建成功是 36、失败是 34,判成功一律 grep 日志里的 Finished in。
set -e
cd "$(dirname "$0")"

CREATOR=${CREATOR:-/Applications/Cocos/Creator/3.8.8/CocosCreator.app/Contents/MacOS/CocosCreator}
LOG=$(mktemp -t garlicbird-build)

"$CREATOR" --project "$PWD" --build "configPath=$PWD/build-wechat.json" >"$LOG" 2>&1 || true
if ! grep -q "build Task (wechatgame) Finished in" "$LOG"; then
  echo "构建失败,日志:$LOG"
  tail -30 "$LOG"
  exit 1
fi

python3 - <<'EOF'
import json, os

ROOT = 'build/wechatgame'
SUB = {s['name']: s['root'] for s in json.load(open(f'{ROOT}/game.json')).get('subpackages', [])}

sizes = {}
for dirpath, _, files in os.walk(ROOT):
    for f in files:
        p = os.path.join(dirpath, f)
        rel = os.path.relpath(p, ROOT) + ''
        owner = next((n for n, r in SUB.items() if rel.startswith(r)), '主包')
        sizes[owner] = sizes.get(owner, 0) + os.path.getsize(p)

main = sizes.pop('主包', 0)
LIMIT = 4 * 1024 * 1024
for name, n in sorted(sizes.items()):
    print(f'分包 {name:<8} {n:>9,} B  ({n/1048576:.2f} MiB)')
print(f'主包       {main:>9,} B  ({main/1048576:.2f} MiB)   上限 4.00 MiB   '
      + ('✅ 达标' if main <= LIMIT else f'❌ 超 {(main-LIMIT)/1024:.0f} KB'))
EOF
