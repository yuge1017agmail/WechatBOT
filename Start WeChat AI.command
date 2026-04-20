#!/bin/zsh
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
cd "$SCRIPT_DIR"

if ! command -v node >/dev/null 2>&1; then
  osascript -e 'display dialog "启动失败：未检测到 node，请先安装 Node.js。" buttons {"好"} default button "好" with icon stop'
  echo "启动失败：未检测到 node，请先安装 Node.js。"
  exit 1
fi

exec node --no-warnings --loader ts-node/esm launcher.ts
