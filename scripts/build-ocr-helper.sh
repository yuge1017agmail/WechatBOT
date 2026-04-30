#!/bin/bash
# 编译 scripts/wechat_ocr.m → bin/wechat_ocr
# 这是一次性步骤；npm install 后会自动跑（见 package.json 的 postinstall）
# 也可以手动跑：bash scripts/build-ocr-helper.sh
set -e

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_DIR="$(cd "${SCRIPT_DIR}/.." && pwd)"

SOURCE="${PROJECT_DIR}/scripts/wechat_ocr.m"
OUTPUT_DIR="${PROJECT_DIR}/bin"
OUTPUT="${OUTPUT_DIR}/wechat_ocr"

if [ ! -f "$SOURCE" ]; then
  echo "❌ OCR 源文件不存在: $SOURCE"
  exit 1
fi

mkdir -p "$OUTPUT_DIR"

# 仅在源文件比产物新、或产物不存在时重新编译
if [ -x "$OUTPUT" ] && [ "$OUTPUT" -nt "$SOURCE" ]; then
  echo "✓ OCR helper 已是最新: $OUTPUT"
  exit 0
fi

echo "→ 编译 OCR helper: $SOURCE → $OUTPUT"
clang -O2 \
  -framework Foundation \
  -framework Vision \
  -framework ImageIO \
  -framework CoreGraphics \
  -o "$OUTPUT" \
  "$SOURCE"

if [ -x "$OUTPUT" ]; then
  echo "✓ 编译成功: $OUTPUT"
else
  echo "❌ 编译失败：未生成可执行文件"
  exit 1
fi
