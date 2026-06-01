#!/bin/bash
# Daily MS Rewards runner with random delay and Telegram notification.
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
LOG_FILE="/tmp/ms-rewards-last.log"
KCLAW_DIR="$HOME/kclaw"

cd "$SCRIPT_DIR"

# Ensure browser exists (launchd runs headless; fails instantly if missing)
PW_SHELL="$HOME/Library/Caches/ms-playwright/chromium_headless_shell-1200/chrome-headless-shell-mac-x64/chrome-headless-shell"
if [ ! -x "$PW_SHELL" ]; then
    echo "[run.sh] Installing patchright chromium (one-time)..." | tee "$LOG_FILE"
    npx patchright install chromium 2>&1 | tee -a "$LOG_FILE"
fi

# Random delay 0-60 min for scheduled runs; SKIP_DELAY=1 for manual: run-now.sh
if [ "${SKIP_DELAY:-0}" != "1" ]; then
    DELAY=$(( RANDOM % 3600 ))
    echo "[run.sh] Sleeping ${DELAY}s before starting..." | tee "$LOG_FILE"
    sleep "$DELAY"
fi

echo "[run.sh] Starting MS Rewards at $(date)" | tee -a "$LOG_FILE"

# Build compiles dist/ (rimraf wipes dist — preserve login sessions)
SESSION_DIR="$SCRIPT_DIR/dist/browser/sessions"
SESSION_BACKUP="/tmp/ms-rewards-sessions-backup"
if [ -d "$SESSION_DIR" ]; then
    rm -rf "$SESSION_BACKUP"
    cp -R "$SESSION_DIR" "$SESSION_BACKUP"
fi
npm run build 2>&1 | tee -a "$LOG_FILE"
if [ -d "$SESSION_BACKUP" ]; then
    mkdir -p "$SESSION_DIR"
    cp -R "$SESSION_BACKUP/." "$SESSION_DIR/"
fi
npm run start 2>&1 | tee -a "$LOG_FILE"
EXIT_CODE=${PIPESTATUS[0]}

echo "[run.sh] Run finished at $(date) (exit $EXIT_CODE)" | tee -a "$LOG_FILE"

# Send Telegram notification via kclaw (non-fatal)
if [ -f "$KCLAW_DIR/.env" ] && [ -f "$KCLAW_DIR/scripts/push-ms-rewards-report.js" ]; then
    set +e
    node --env-file="$KCLAW_DIR/.env" "$KCLAW_DIR/scripts/push-ms-rewards-report.js" "$LOG_FILE"
    TG_EXIT=$?
    set -e
    if [ "$TG_EXIT" -eq 0 ]; then
        echo "[run.sh] Telegram notification sent"
    else
        echo "[run.sh] Telegram notification failed (exit $TG_EXIT)"
    fi
else
    echo "[run.sh] kclaw not found, skipping Telegram notification"
fi

exit $EXIT_CODE
