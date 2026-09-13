#!/bin/bash
set -e
cd "$(dirname "$0")"
export PATH="/usr/local/bin:/opt/homebrew/bin:$PATH"
echo "若 02-Start 的視窗仍開著，請先在該視窗按 Control+C。"
read -r -p "按 Enter 設定每次登入 Mac 時自動啟動本機服務。"
node scripts/autostart.mjs
read -r -p "按 Enter 關閉。"
