#!/bin/bash
set -e
cd "$(dirname "$0")"
export PATH="/usr/local/bin:/opt/homebrew/bin:$PATH"
node scripts/autostart.mjs --remove
read -r -p "按 Enter 關閉。"
