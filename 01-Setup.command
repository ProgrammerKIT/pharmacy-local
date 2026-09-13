#!/bin/bash
set -e
cd "$(dirname "$0")"
export PATH="/usr/local/bin:/opt/homebrew/bin:$PATH"
if ! command -v node >/dev/null 2>&1; then
  echo "請先從 https://nodejs.org/en/download 安裝免費 Node.js LTS（22 或更新版本）。"
  read -r -p "按 Enter 關閉。"
  exit 1
fi
node scripts/setup.mjs || true
read -r -p "按 Enter 關閉。"
