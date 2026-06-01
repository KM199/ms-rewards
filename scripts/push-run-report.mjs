#!/usr/bin/env node
/**
 * Send a short Telegram summary after a run (parses /tmp/ms-rewards-last.log or path arg).
 *
 * Env (from .env via run.sh, or exported):
 *   TELEGRAM_BOT_TOKEN  — or TELEGRAM_TOKEN
 *   TELEGRAM_CHAT_ID    — or NOTIFY_CHAT_ID
 *   TELEGRAM_ENABLED=0  — skip
 */

import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

const logPath = resolve(process.argv[2] || '/tmp/ms-rewards-last.log')

function env(name, alt) {
    const v = process.env[name] ?? (alt ? process.env[alt] : undefined)
    return v?.trim() || ''
}

const enabled = env('TELEGRAM_ENABLED') !== '0'
const token = env('TELEGRAM_BOT_TOKEN', 'TELEGRAM_TOKEN')
const chatId = env('TELEGRAM_CHAT_ID', 'NOTIFY_CHAT_ID')

if (!enabled) {
    console.log('[telegram] TELEGRAM_ENABLED=0, skipping')
    process.exit(0)
}

if (!token || !chatId) {
    console.log('[telegram] Skipped — set TELEGRAM_BOT_TOKEN and TELEGRAM_CHAT_ID in .env (see README)')
    process.exit(0)
}

let logText = ''
try {
    logText = readFileSync(logPath, 'utf8')
} catch (err) {
    console.error(`[telegram] Cannot read log ${logPath}:`, err.message)
    process.exit(1)
}

const runEnd = logText.match(
    /\[RUN-END\].*?Total points collected: \+(\d+).*?Old total: (\d+) → New total: (\d+).*?Total runtime: ([\d.]+)min/
)

const accountLines = [
    ...logText.matchAll(
        /\[ACCOUNT-END\].*?Completed account: (\S+) \| Total: \+(\d+) \| Old: (\d+) → New: (\d+)/g
    ),
]

const flowFail = logText.match(/\[FLOW-SUMMARY\].*?failedSteps=([^\s|]+)/)
const searchRate = logText.match(/\[SEARCH-RATE-SUMMARY\][^\n]+/)
const errors = [...logText.matchAll(/\[ERROR\][^\n]+/g)].map((m) => m[0].trim()).slice(0, 5)
const exitLine = logText.match(/\[run\.sh\] Run finished[^\n]*/)

let msg = '🎯 Microsoft Rewards\n'
msg += `📅 ${new Date().toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' })}\n\n`

if (runEnd) {
    const [, gained, oldTotal, newTotal, runtime] = runEnd
    msg += `✅ +${gained} pts\n`
    msg += `📊 ${oldTotal} → ${newTotal}\n`
    msg += `⏱ ${runtime} min\n`
} else if (accountLines.length) {
    const total = accountLines.reduce((s, m) => s + parseInt(m[2], 10), 0)
    const last = accountLines[accountLines.length - 1]
    msg += `✅ +${total} pts (${accountLines.length} account(s))\n`
    msg += `📊 ${last[3]} → ${last[4]}\n`
} else {
    msg += '⚠️ Could not parse points — open the log\n'
}

if (flowFail?.[1] && flowFail[1] !== 'none') {
    msg += `\n⚠️ Failed steps: ${flowFail[1]}\n`
}

if (searchRate) {
    const hit = searchRate[0].match(/hitRate=([\d.]+)%/)
    if (hit) msg += `🔍 Search hit rate: ${hit[1]}%\n`
}

if (errors.length) {
    msg += `\n❌ Errors (${errors.length}):\n`
    for (const e of errors) {
        msg += `• ${e.replace(/^\[[^\]]+\]\s*/, '').slice(0, 120)}\n`
    }
}

if (exitLine) {
    const code = exitLine[0].match(/exit (\d+)/)
    if (code && code[1] !== '0') msg += `\n⚠️ Runner exit code: ${code[1]}\n`
}

msg += `\n📄 Log: ${logPath}`

const url = `https://api.telegram.org/bot${token}/sendMessage`
const body = new URLSearchParams({
    chat_id: chatId,
    text: msg.slice(0, 4096),
    disable_web_page_preview: 'true',
})

const res = await fetch(url, { method: 'POST', body })
const data = await res.json().catch(() => ({}))

if (!res.ok || !data.ok) {
    console.error('[telegram] Send failed:', data.description || res.statusText)
    process.exit(1)
}

console.log(`[telegram] Sent summary to chat ${chatId}`)
