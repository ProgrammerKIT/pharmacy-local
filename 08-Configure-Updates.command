#!/bin/bash
set -e
cd "$(dirname "$0")"
export PATH="/usr/local/bin:/opt/homebrew/bin:$PATH"
node scripts/configure-updates.mjs || true
read -r -p "按 Enter 關閉。"
