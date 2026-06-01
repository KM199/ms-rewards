#!/bin/bash
# Start at most one MS Rewards run per calendar day while someone is logged in.
# Runs in the background via run.sh — no keyboard/mouse activity required.
# Install via com.ms-rewards.supervisor.plist.example (StartInterval ~10 min).
#
# Usage:
#   ./scripts/supervisor.sh           # evaluate and maybe start run.sh
#   ./scripts/supervisor.sh --status  # print why it would / wouldn't run
#   ./scripts/supervisor.sh --dry-run # same as --status (no start)

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")/.." && pwd)"
ENV_FILE="$SCRIPT_DIR/.env"
VAR_DIR="$SCRIPT_DIR/var"
STATE_FILE="$VAR_DIR/state.json"
LOCK_FILE="$VAR_DIR/run.lock"

DRY=0
for arg in "$@"; do
    case "$arg" in
        --status | --dry-run) DRY=1 ;;
        -h | --help)
            sed -n '2,8p' "$0"
            exit 0
            ;;
    esac
done

if [ -f "$ENV_FILE" ]; then
    set -a
    # shellcheck disable=SC1090
    source "$ENV_FILE"
    set +a
fi

EARLIEST_HOUR="${SUPERVISOR_EARLIEST_HOUR:-}"
LATEST_HOUR="${SUPERVISOR_LATEST_HOUR:-}"
MIN_UPTIME_SEC="${SUPERVISOR_MIN_UPTIME_SEC:-120}"

log() {
    echo "[supervisor $(date '+%H:%M:%S')] $*"
}

today_local() {
    date +%Y-%m-%d
}

state_completed_today() {
    if [ ! -f "$STATE_FILE" ]; then
        return 1
    fi
    local d
    d=$(grep -o '"lastCompletedDate"[[:space:]]*:[[:space:]]*"[^"]*"' "$STATE_FILE" 2>/dev/null | head -1 | sed 's/.*"\([0-9-]*\)".*/\1/')
    [ "$d" = "$(today_local)" ]
}

console_user() {
    stat -f%Su /dev/console 2>/dev/null || echo ""
}

system_uptime_seconds() {
    if [ "$(uname -s)" = "Darwin" ]; then
        local boot
        boot=$(sysctl -n kern.boottime 2>/dev/null | awk '{gsub(/,/, "", $4); print $4}')
        if [ -n "$boot" ]; then
            echo $(($(date +%s) - boot))
            return
        fi
    fi
    awk '{print int($1)}' /proc/uptime 2>/dev/null || echo 999999
}

within_hour_window() {
    local h
    h=$(date +%H | sed 's/^0//')
    [ -z "$h" ] && h=0
    if [ -n "$EARLIEST_HOUR" ] && [ "$h" -lt "$EARLIEST_HOUR" ]; then
        return 1
    fi
    if [ -n "$LATEST_HOUR" ] && [ "$h" -gt "$LATEST_HOUR" ]; then
        return 1
    fi
    return 0
}

lock_pid() {
    [ -f "$LOCK_FILE" ] || return 1
    tr -d '[:space:]' <"$LOCK_FILE"
}

run_in_progress() {
    local pid
    pid=$(lock_pid) || return 1
    kill -0 "$pid" 2>/dev/null
}

stale_lock() {
    [ -f "$LOCK_FILE" ] || return 1
    ! run_in_progress
}

evaluate() {
    REASON_SKIP=""
    REASON_OK=""

    if [ "$(uname -s)" != "Darwin" ]; then
        REASON_SKIP="macOS only"
        return 1
    fi

    local user
    user=$(console_user)
    if [ -z "$user" ] || [ "$user" = "root" ] || [ "$user" = "loginwindow" ]; then
        REASON_SKIP="no GUI session (console user: ${user:-none})"
        return 1
    fi

    if state_completed_today; then
        REASON_SKIP="already completed today ($(today_local))"
        return 1
    fi

    if run_in_progress; then
        REASON_SKIP="run in progress (pid $(lock_pid))"
        return 1
    fi

    if stale_lock; then
        log "Removing stale lock (pid $(cat "$LOCK_FILE" 2>/dev/null))"
        rm -f "$LOCK_FILE"
    fi

    local uptime
    uptime=$(system_uptime_seconds)
    if [ "$uptime" -lt "$MIN_UPTIME_SEC" ]; then
        REASON_SKIP="system uptime ${uptime}s < ${MIN_UPTIME_SEC}s (just booted)"
        return 1
    fi

    if ! within_hour_window; then
        REASON_SKIP="outside hour window (earliest=${EARLIEST_HOUR:-any} latest=${LATEST_HOUR:-any})"
        return 1
    fi

    REASON_OK="console=$user uptime=${uptime}s — will run in background"
    return 0
}

start_run() {
    mkdir -p "$VAR_DIR"
    local run_log="/tmp/ms-rewards-last.log"
    log "Starting run.sh in background (SKIP_DELAY=1) → $run_log"
    (
        cd "$SCRIPT_DIR"
        export SKIP_DELAY=1
        export MS_REWARDS_TRACK_DAILY=1
        export MS_REWARDS_STATE_DIR="$VAR_DIR"
        exec ./run.sh
    ) >>"$run_log" 2>&1 &
    local pid=$!
    echo "$pid" >"$LOCK_FILE"
    log "Started pid $pid (lock $LOCK_FILE)"
}

mkdir -p "$VAR_DIR"

if evaluate; then
    if [ "$DRY" -eq 1 ]; then
        log "WOULD START: $REASON_OK"
        exit 0
    fi
    start_run
    exit 0
fi

if [ "$DRY" -eq 1 ]; then
    log "SKIP: $REASON_SKIP"
else
    log "Skip: $REASON_SKIP"
fi
exit 0
