#!/bin/bash
set -e
cd "$(dirname "$0")"
export PATH="/usr/local/bin:/opt/homebrew/bin:$PATH"
if ! command -v node >/dev/null 2>&1; then
  echo "請先安裝 Node.js LTS，並執行 01-Setup.command。"
  read -r -p "按 Enter 關閉。"
  exit 1
fi
node supervisor.mjs
