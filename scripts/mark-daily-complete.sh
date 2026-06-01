#!/bin/bash
# Write var/state.json after a successful daily run (called from run.sh).
set -euo pipefail

STATE_DIR="${MS_REWARDS_STATE_DIR:-}"
EXIT_CODE="${1:-0}"

[ -n "$STATE_DIR" ] || exit 0
[ "$EXIT_CODE" -eq 0 ] || exit 0

mkdir -p "$STATE_DIR"
DATE=$(date +%Y-%m-%d)
NOW=$(date -u +"%Y-%m-%dT%H:%M:%SZ")

cat >"$STATE_DIR/state.json" <<EOF
{
  "lastCompletedDate": "$DATE",
  "lastCompletedAt": "$NOW",
  "lastExitCode": 0
}
EOF

rm -f "$STATE_DIR/run.lock"
echo "[state] Marked daily complete for $DATE"
