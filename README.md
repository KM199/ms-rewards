# ms-rewards

Automated Microsoft Rewards daily tasks. Fork of [TheNetsky/Microsoft-Rewards-Script](https://github.com/TheNetsky/Microsoft-Rewards-Script) **v3.1.4** with daily-set fixes, fault-tolerant steps, search rate limiting, and a simple **Telegram** summary after each run.

> **Disclaimer:** Automating Rewards may violate Microsoft’s terms. Accounts can be limited or banned. Use at your own risk.

---

## Table of contents

1. [Requirements](#requirements)
2. [Install](#install)
3. [Microsoft account](#microsoft-account)
4. [Config](#config)
5. [First run](#first-run)
6. [Telegram notifications](#telegram-notifications)
7. [Daily schedule (macOS)](#daily-schedule-macos)
8. [Commands reference](#commands-reference)
9. [Fork features](#fork-features)
10. [Troubleshooting](#troubleshooting)

---

## Requirements

| Requirement | Notes |
|-------------|--------|
| **Node.js ≥ 24** | `node -v` |
| **npm** | Comes with Node |
| **Disk** | ~250 MB for Chromium (Patchright) |
| **OS** | macOS tested; Linux/Windows may work with manual scheduling |

---

## Install

```bash
git clone https://github.com/KM199/ms-rewards.git
cd ms-rewards

npm install
npx patchright install chromium

cp src/accounts.example.json src/accounts.json
cp src/config.example.json src/config.json
cp .env.example .env
```

Edit `src/accounts.json` and `src/config.json` (see below).  
Telegram is optional — leave `.env` empty until [step 6](#telegram-notifications).

---

## Microsoft account

1. Use a normal Microsoft account (Outlook, Hotmail, etc.) enrolled in [Microsoft Rewards](https://rewards.microsoft.com).
2. In `src/accounts.json`, set `email` and `password`.
3. **2FA:** If you use an authenticator app, add the **TOTP secret** (the manual setup code from Microsoft, not the 6-digit code) to `totpSecret`.
4. **Recommended:** `"saveFingerprint": { "mobile": true, "desktop": true }` so logins look consistent between runs.

Never commit `accounts.json` — it is gitignored.

---

## Config

`src/config.json` controls what runs and how fast searches happen.

### Workers (on/off)

| Key | What it does |
|-----|----------------|
| `workers.doDailySet` | Daily set tiles |
| `workers.doDesktopSearch` / `doMobileSearch` | PC + mobile Bing search points |
| `workers.doLimitedSearchBonus` | “100 points/day” banner searches |
| `workers.doReadToEarn` | Read articles |
| Other `workers.*` | Punch cards, promotions, check-in, etc. |

### Search timing (important)

| Key | Example default | Meaning |
|-----|-----------------|--------|
| `searchSettings.betweenSearchDelay` | `30sec` – `15min` | **Wait before each search** — main control for Bing crediting queries |
| `searchSettings.searchDelay` | `3sec` – `10sec` | Time on the results page after each query |
| `searchSettings.parallelSearching` | `true` | Mobile + desktop at the same time |

If searches run but points barely move, **increase** `betweenSearchDelay` (e.g. `2min`–`8min`). After a run, check the log for:

```text
SEARCH-RATE-SUMMARY | attempts=18 | credited=18 | hitRate=100.0%
```

### Browser

| Key | Typical value |
|-----|----------------|
| `headless` | `true` for unattended runs; script falls back to a visible browser if headless Chromium is missing |

After any change to `config.json`: `npm run build`.

---

## First run

```bash
npm run build
./run-now.sh
```

- **First time:** Chromium opens (or runs headless), logs into Microsoft, saves cookies under `dist/browser/sessions/<email>/`.
- **Log file:** `/tmp/ms-rewards-last.log`
- A full run can take **1–4+ hours** if search delays are long.

Watch progress:

```bash
tail -f /tmp/ms-rewards-last.log
```

---

## Telegram notifications

After each `./run.sh` or `./run-now.sh`, you can get **one short message** (points earned, balance, runtime, failed steps, errors). No extra services — only the Telegram Bot API.

### How it works today

| Piece | Role |
|-------|------|
| `run.sh` | Runs the bot, then calls `scripts/push-run-report.mjs` |
| `.env` | Stores `TELEGRAM_BOT_TOKEN` and `TELEGRAM_CHAT_ID` (gitignored) |
| `push-run-report.mjs` | Reads `/tmp/ms-rewards-last.log`, sends one message via `fetch` |

**Not required:** Discord, ntfy, or a separate “kclaw” install. (Older setups used `~/kclaw`; `run.sh` still accepts that `.env` as a fallback.)

### Setup (about 5 minutes)

**1. Create a bot**

1. In Telegram, open [@BotFather](https://t.me/BotFather).
2. Send `/newbot`, follow prompts, copy the **HTTP API token**.

**2. Start a chat with your bot**

1. Open the bot’s link from BotFather, tap **Start**.
2. Send any message (e.g. `hi`).

**3. Get your chat id**

```bash
# Put only the bot token in .env for this step:
echo 'TELEGRAM_BOT_TOKEN=123456:ABC...' >> .env

npm run telegram:chat-id
```

Example output:

```text
  987654321  (private: Your Name)
```

**4. Finish `.env`**

```bash
cp .env.example .env
```

```env
TELEGRAM_BOT_TOKEN=123456:ABC-your-token-from-botfather
TELEGRAM_CHAT_ID=987654321
```

**5. Test without a full run**

```bash
# After at least one run (or touch a fake log), test notify:
npm run notify
```

Or run a full job: `./run-now.sh` — you’ll get a message when it finishes.

### Disable Telegram

- Delete `.env`, or  
- Set `TELEGRAM_ENABLED=0` in `.env`, or  
- Leave token/chat id empty (notify script skips quietly).

### Message contents

- Points gained and balance (`RUN-END` / `ACCOUNT-END` lines)
- Runtime
- Failed flow steps (`FLOW-SUMMARY`)
- Search hit rate if logged
- Up to 5 recent `[ERROR]` lines

---

## Daily schedule (macOS)

**1. Copy and edit the LaunchAgent template**

```bash
cp com.ms-rewards.daily.plist.example ~/Library/LaunchAgents/com.YOURNAME.ms-rewards.plist
```

Edit the plist:

- `Label` → unique, e.g. `com.jane.ms-rewards`
- `ProgramArguments` → **full path** to your `run.sh`
- `HOME` → your macOS username path

**2. Load it**

```bash
launchctl bootout gui/$(id -u)/com.YOURNAME.ms-rewards 2>/dev/null || true
launchctl bootstrap gui/$(id -u) ~/Library/LaunchAgents/com.YOURNAME.ms-rewards.plist
```

**Default behavior:** fires at **8:00 AM**, then `run.sh` waits a **random 0–60 minutes** before starting (spreads load).

**Logs**

| File | Contents |
|------|----------|
| `/tmp/ms-rewards-last.log` | Latest run (used for Telegram) |
| `/tmp/ms-rewards-launchagent.log` | launchd stdout/stderr |

**Mac must be awake** at run time — sleep pauses launchd. Use Energy Saver / `caffeinate` if needed.

### Linux / Windows

- Run `./run.sh` from **cron** or **Task Scheduler** at your preferred time.
- Use the same `.env` and log path for Telegram.

---

## Commands reference

| Command | Description |
|---------|-------------|
| `./run-now.sh` | Run now (no morning jitter) + optional Telegram |
| `./run.sh` | Random 0–60 min delay, then run (for launchd) |
| `npm run build` | Compile TypeScript → `dist/` (required after code/config changes) |
| `npm run start` | Run only (no wrapper, no Telegram from `run.sh`) |
| `npm run notify` | Send Telegram from existing log |
| `npm run telegram:chat-id` | List chat ids after messaging your bot |
| `npm run clear-sessions` | Delete saved browser sessions (force re-login) |

Environment:

| Variable | Effect |
|----------|--------|
| `SKIP_DELAY=1` | Skip random morning delay (`run-now.sh` sets this) |

---

## Fork features

| Area | Behavior |
|------|----------|
| **Daily set** | Url-reward tiles use API `reportactivity` first |
| **Resilient flow** | `FLOW-STEP` / `FLOW-SUMMARY` — one failure doesn’t stop the whole run |
| **Search pacing** | `betweenSearchDelay` + telemetry (`SEARCH-RATE-*`) |
| **100 pt banner** | `doLimitedSearchBonus` worker |
| **Parallel searches** | `Promise.allSettled` for mobile + desktop |
| **Browser** | Headless with headed fallback |
| **Sessions** | `run.sh` backs up cookies across `npm run build` |

---

## Troubleshooting

| Symptom | Fix |
|---------|-----|
| Exits in ~3s, Chromium “doesn't exist” | `npx patchright install chromium` or use `./run.sh` |
| Searches run, almost no points | Raise `betweenSearchDelay`; read `SEARCH-RATE-BUCKET` in log |
| No Telegram | Check `.env`, run `npm run telegram:chat-id`, then `npm run notify` |
| Telegram “chat not found” | Wrong `TELEGRAM_CHAT_ID` — message the bot again, re-run chat-id |
| Login loops | Delete `dist/browser/sessions/<email>/`, fix password/`totpSecret`, rerun |
| Daily set incomplete | `npm run build`; check log for `URL-REWARD` / `DAILY-SET` |
| Run many hours | Normal with long search delays; lower max delay once hit rate is stable |

### Log tags

| Tag | Meaning |
|-----|---------|
| `FLOW-STEP` | Per-step OK / FAIL / SKIP |
| `FLOW-SUMMARY` | Failed steps at end of account |
| `SEARCH-BING-TIMING` | Per-search delay and credit yes/no |
| `RUN-END` | Total points and runtime |

---

## Project layout

```text
run.sh / run-now.sh          # Recommended entry points
.env / .env.example          # Telegram (optional)
scripts/push-run-report.mjs  # Post-run Telegram
src/accounts.json            # Credentials (gitignored)
src/config.json              # Settings (gitignored)
dist/                        # Build + browser sessions (gitignored)
com.ms-rewards.daily.plist.example
```

---

## Docker / Nix (upstream)

Upstream supports Docker (`compose.yaml`) and Nix (`scripts/nix/run.sh`). This fork is primarily tested with **macOS + `run.sh`**.

---

## License

GPL-3.0-or-later — see [LICENSE](LICENSE).

## Links

- Fork: https://github.com/KM199/ms-rewards  
- Upstream: https://github.com/TheNetsky/Microsoft-Rewards-Script
