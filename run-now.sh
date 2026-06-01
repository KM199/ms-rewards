#!/bin/bash
# Full MS Rewards run immediately (no random delay) + Telegram.
export SKIP_DELAY=1
exec "$(dirname "$0")/run.sh"
