#!/bin/bash
set -e
cd "$(dirname "$0")"
export PATH="/usr/local/bin:/opt/homebrew/bin:$PATH"
upgrade_status=0
node scripts/upgrade.mjs || upgrade_status=$?
printf '%s' "按 Enter 關閉。"
IFS= read -r upgrade_close || true
exit "$upgrade_status"
