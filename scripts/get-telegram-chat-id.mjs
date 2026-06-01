#!/usr/bin/env node
/**
 * Print chat ids from recent messages to your bot (run after you /start the bot).
 *
 *   cp .env.example .env   # add TELEGRAM_BOT_TOKEN only
 *   node --env-file=.env scripts/get-telegram-chat-id.mjs
 */

function env(name, alt) {
    const v = process.env[name] ?? (alt ? process.env[alt] : undefined)
    return v?.trim() || ''
}

const token = env('TELEGRAM_BOT_TOKEN', 'TELEGRAM_TOKEN')
if (!token) {
    console.error('Set TELEGRAM_BOT_TOKEN in .env first (@BotFather → /newbot)')
    process.exit(1)
}

const res = await fetch(`https://api.telegram.org/bot${token}/getUpdates`)
const data = await res.json()

if (!data.ok) {
    console.error('getUpdates failed:', data.description || res.statusText)
    process.exit(1)
}

const chats = new Map()
for (const u of data.result || []) {
    const c = u.message?.chat || u.my_chat_member?.chat
    if (!c?.id) continue
    chats.set(c.id, {
        id: c.id,
        type: c.type,
        title: c.title || [c.first_name, c.last_name].filter(Boolean).join(' ') || c.username || '?',
    })
}

if (chats.size === 0) {
    console.log('No messages yet.')
    console.log('1. Open Telegram, find your bot, tap Start (or send any message).')
    console.log('2. Run this script again.')
    process.exit(0)
}

console.log('Use one of these as TELEGRAM_CHAT_ID in .env:\n')
for (const c of chats.values()) {
    console.log(`  ${c.id}  (${c.type}: ${c.title})`)
}
