# macOS daily automation (KM199 fork)

Fork of [TheNetsky/Microsoft-Rewards-Script](https://github.com/TheNetsky/Microsoft-Rewards-Script) v3.1.4 with daily-run helpers and search rate-limit telemetry.

## Setup

```bash
npm install
cp src/accounts.example.json src/accounts.json
cp src/config.example.json src/config.json
# edit accounts.json + config.json (never commit these)
npx patchright install chromium
npm run build
```

## Run

```bash
./run-now.sh          # immediate (no 0–60 min launch delay)
./run.sh              # same as launchd (random delay optional)
npm run start         # raw node only
```

Logs: `/tmp/ms-rewards-last.log`

## Config highlights (`config.json`)

- `searchSettings.searchDelay` — dwell on results page after each query (default 3–10s)
- `searchSettings.betweenSearchDelay` — random wait **before** each search (default 30s–15min; tune using `SEARCH-RATE-BUCKET` logs)
- `workers.doLimitedSearchBonus` — 100pt “No joke” banner searches

## LaunchAgent (scheduled)

1. Edit `com.kai.ms-rewards.plist` paths (`HOME`, script path).
2. `cp com.kai.ms-rewards.plist ~/Library/LaunchAgents/`
3. `launchctl load ~/Library/LaunchAgents/com.kai.ms-rewards.plist`

Uses `StartCalendarInterval` at 8:00 + random delay inside `run.sh`. For wake/idle-based scheduling, use a supervisor wrapper (not included yet).

## Telemetry log tags

| Tag | Meaning |
|-----|---------|
| `FLOW-STEP` / `FLOW-SUMMARY` | Per-step success/failure; run continues on failure |
| `SEARCH-BING-TIMING` | preDelay, sinceLastCredit, credited yes/no per query |
| `SEARCH-RATE-SUMMARY` | Hit rate and avg delay for the search phase |
| `SEARCH-RATE-BUCKET` | Hit rate by wait-time bucket |

## Secrets

`src/accounts.json` and `src/config.json` are gitignored. Do not commit them.
