# ms-rewards

Automated Microsoft Rewards daily tasks for **macOS** (and other platforms supported by the upstream script). Fork of [TheNetsky/Microsoft-Rewards-Script](https://github.com/TheNetsky/Microsoft-Rewards-Script) **v3.1.4** with fixes and scheduling aimed at reliable unattended daily runs.

> **Disclaimer:** Automating Rewards may violate Microsoft’s terms. Accounts can be limited or banned. Use at your own risk.

## What this fork changes

| Area | Behavior |
|------|----------|
| **Daily set** | Url-reward tiles use the `reportactivity` API first (not legacy in-page quiz selectors). |
| **Resilient flow** | Each major step runs in isolation (`FLOW-STEP`). Login/browser failure stops the account; other failures are logged and the run continues. |
| **Search pacing** | Random wait **before** each Bing search (`betweenSearchDelay`). Short dwell on the results page (`searchDelay`). |
| **Search telemetry** | Logs `SEARCH-BING-TIMING`, `SEARCH-RATE-SUMMARY`, and `SEARCH-RATE-BUCKET` to tune delays vs hit rate. |
| **100 pt banner** | Optional worker `doLimitedSearchBonus` (“No joke: Get 100 points/day”) runs after normal searches. |
| **Parallel searches** | Mobile and desktop use `Promise.allSettled`; one side failing does not kill the other. |
| **Browser** | Headless launch falls back to headed Chromium if the headless binary is missing. |
| **macOS runner** | `run.sh` installs Chromium if needed, preserves login sessions across `npm run build`, optional LaunchAgent plist. |

Upstream Docker/Nix paths still exist; **day-to-day development and scheduling on Mac are documented below.**

## Requirements

- **Node.js ≥ 24**
- **npm**
- Enough disk for Patchright Chromium (~250 MB in `~/Library/Caches/ms-playwright/` on Mac)

## Quick start

```bash
git clone git@github.com:KM199/ms-rewards.git
cd ms-rewards

npm install
npx patchright install chromium

cp src/accounts.example.json src/accounts.json
cp src/config.example.json src/config.json
# Edit both files — never commit them (they are gitignored).

npm run build
./run-now.sh
```

**First run:** logs in via the browser, saves sessions under `dist/browser/sessions/<email>/`. Later runs reuse those cookies when possible.

## How to run

| Command | Use when |
|---------|----------|
| `./run-now.sh` | Manual run immediately (no 0–60 minute random delay). |
| `./run.sh` | Same as LaunchAgent: optional random delay, build, run, log to `/tmp/ms-rewards-last.log`. |
| `npm run start` | Node only (no build, no delay, no session backup in wrapper). |
| `npm run build` | Compile TypeScript to `dist/` after code or config changes. |

`run.sh` also tries to send a Telegram summary if `~/kclaw/scripts/push-ms-rewards-report.js` exists (optional; safe to ignore).

## macOS daily schedule (LaunchAgent)

1. Edit `com.kai.ms-rewards.plist`: set `HOME`, and the full path to `run.sh` on your machine.
2. Install:

```bash
cp com.kai.ms-rewards.plist ~/Library/LaunchAgents/
launchctl unload ~/Library/LaunchAgents/com.kai.ms-rewards.plist 2>/dev/null || true
launchctl load ~/Library/LaunchAgents/com.kai.ms-rewards.plist
```

Default: **8:00 AM** local, then `run.sh` sleeps **0–60 minutes** at random before starting (spreads load ~8:00–9:00).

Logs:

- `/tmp/ms-rewards-last.log` — latest run (also used by `run.sh`)
- `/tmp/ms-rewards-launchagent.log` — LaunchAgent stdout/stderr

## Configuration

Copy `src/config.example.json` → `src/config.json`. Important fields for this fork:

### Workers

All default `true` in the example. Set `false` to skip a task.

| Key | Description |
|-----|-------------|
| `workers.doDailySet` | Daily set tiles (API + browser fallback). |
| `workers.doDesktopSearch` / `doMobileSearch` | Bing search points (separate caps). |
| `workers.doLimitedSearchBonus` | “100 points/day” tagged search offer. |
| `workers.doReadToEarn` | Read-to-earn articles. |
| `workers.doMorePromotions` / `doPunchCards` / … | Other dashboard tasks. |

### Search timing (read this)

| Key | Default (example) | Meaning |
|-----|-------------------|---------|
| `searchSettings.betweenSearchDelay` | `30sec` – `15min` | **Random wait before each search.** Main lever for Bing crediting searches. Too short (~30s–1min) → most searches earn 0 points; ~2–15min between credits is typical. |
| `searchSettings.searchDelay` | `3sec` – `10sec` | Wait on the results page after submitting a query, before reading counters. |
| `searchSettings.parallelSearching` | `true` | Mobile + desktop searches at the same time (faster, more load). |
| `searchSettings.queryEngines` | google, wikipedia, reddit, local | Where search queries are sourced. |

Tune `betweenSearchDelay` using end-of-run lines like:

```text
SEARCH-RATE-SUMMARY | attempts=18 | credited=18 | hitRate=100.0% | avgPreDelay=6m26s
SEARCH-RATE-BUCKET | preDelay=2m-5m | attempts=8 | credited=8 | hitRate=100.0%
```

### Browser

| Key | Notes |
|-----|--------|
| `headless` | `true` for unattended Mac; script retries headed if headless binary is missing. |
| `sessionPath` | Relative to `dist/browser/`; sessions hold cookies (+ optional fingerprints). |

## Accounts

Copy `src/accounts.example.json` → `src/accounts.json`. Flat JSON **array** of accounts:

```json
[
  {
    "email": "you@outlook.com",
    "password": "your_password",
    "totpSecret": "",
    "recoveryEmail": "",
    "geoLocale": "auto",
    "langCode": "en",
    "proxy": { "proxyAxios": false, "url": "", "port": 0, "username": "", "password": "" },
    "saveFingerprint": { "mobile": true, "desktop": true }
  }
]
```

- **`totpSecret`:** TOTP secret for 2FA (optional).
- **`saveFingerprint`:** `true` keeps a stable device profile between runs (recommended on Mac).

## Log tags (troubleshooting)

| Tag | Meaning |
|-----|---------|
| `FLOW-STEP` | `OK` / `FAIL` / `SKIP` per step (login, daily-set, searches, …). |
| `FLOW-SUMMARY` | Failed steps at end of account. |
| `SEARCH-BING-TIMING` | Per search: `preDelay`, `sinceLastCredit`, `credited=yes\|no`, query. |
| `SEARCH-RATE-SUMMARY` | Hit rate and average delay for the search phase. |
| `RUN-END` | Points collected and total runtime. |

## Common issues

| Symptom | What to do |
|---------|------------|
| Run exits in ~3s, “Executable doesn't exist” (chromium_headless_shell) | `npx patchright install chromium` or run `./run.sh` (installs if missing). |
| Searches run but almost no points | Increase `betweenSearchDelay` (e.g. `2min`–`8min`); check `SEARCH-RATE-BUCKET` in logs. |
| Daily set incomplete | Look for `URL-REWARD` / `DAILY-SET` errors; run `node scripts/probe-daily-set-dom.mjs` after `npm run build`. |
| Login loops | Delete `dist/browser/sessions/<email>/` and rerun; check password / `totpSecret`. |
| Run takes many hours | Expected with long `betweenSearchDelay`; reduce max once hit rate is stable. |

## Docker / Nix (upstream)

- **Docker:** see `compose.yaml` and `env.example` (upstream-style config generation).
- **Nix:** `bash scripts/nix/run.sh`

Behavior on Docker has not been re-validated for every fork-specific path; macOS + `run.sh` is the tested setup.

## Project layout

```text
run.sh / run-now.sh     # macOS wrappers
src/                    # TypeScript source
src/config.json         # local config (gitignored)
src/accounts.json       # credentials (gitignored)
dist/                   # compiled output + browser sessions (gitignored)
com.kai.ms-rewards.plist
```

## License

GPL-3.0-or-later (same as upstream). See [LICENSE](LICENSE).

## Upstream

- Original project: https://github.com/TheNetsky/Microsoft-Rewards-Script  
- This repo: https://github.com/KM199/ms-rewards
