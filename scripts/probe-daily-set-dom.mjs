#!/usr/bin/env node
/**
 * Probe daily-set quiz/poll pages: dump DOM hints for selector fixes.
 * Usage: node scripts/probe-daily-set-dom.mjs
 */
import fs from 'fs'
import path from 'path'
import { chromium } from 'patchright'

const projectRoot = path.resolve(import.meta.dirname, '..')
const email = 'billyb696969420@outlook.com'
const sessionPath = path.join(
    projectRoot,
    'dist/browser/sessions',
    email,
    'session_mobile.json'
)

function todayKey() {
    const d = new Date()
    const m = String(d.getMonth() + 1).padStart(2, '0')
    const day = String(d.getDate()).padStart(2, '0')
    return `${m}/${day}/${d.getFullYear()}`
}

function cookieHeader(cookies) {
    return cookies
        .filter(c => /bing\.com|live\.com|microsoft/i.test(c.domain || ''))
        .map(c => `${c.name}=${c.value}`)
        .join('; ')
}

async function fetchDashboard(cookies) {
    const res = await fetch('https://rewards.bing.com/api/getuserinfo?type=1', {
        headers: {
            Cookie: cookieHeader(cookies),
            Referer: 'https://rewards.bing.com/',
            Origin: 'https://rewards.bing.com',
            'User-Agent':
                'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1'
        }
    })
    const json = await res.json()
    return json.dashboard
}

async function probePage(browser, url, title) {
    const context = await browser.newContext({
        viewport: { width: 390, height: 844 },
        isMobile: true,
        userAgent:
            'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1'
    })
    const cookies = JSON.parse(fs.readFileSync(sessionPath, 'utf8'))
    await context.addCookies(cookies)
    const page = await context.newPage()

    console.log('\n===', title, '===')
    console.log('url:', url)

    try {
        await page.goto(url, { waitUntil: 'networkidle', timeout: 45000 })
    } catch {
        await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 45000 })
    }
    await page.waitForTimeout(4000)

    const info = await page.evaluate(() => {
        const quizKeys = []
        for (const k of ['QuizData', '_G']) {
            const v = window[k]
            if (v) quizKeys.push(k)
            if (v?.QuizData) quizKeys.push(`${k}.QuizData`)
        }
        const qd = window.QuizData ?? window._G?.QuizData ?? null

        const candidates = []
        const selList = [
            '.rqOption',
            '[id^="btoption"]',
            '.btOption',
            '#btoption0',
            'button[class*="option"]',
            '[data-option]',
            '[role="button"]',
            'button',
            'a[class*="option"]',
            '[class*="Option"]',
            '[class*="answer"]',
            '[class*="poll"]',
            'input[type="radio"]',
            'label'
        ]
        for (const sel of selList) {
            const nodes = document.querySelectorAll(sel)
            if (nodes.length) {
                candidates.push({
                    sel,
                    count: nodes.length,
                    sample: Array.from(nodes)
                        .slice(0, 3)
                        .map(n => ({
                            tag: n.tagName,
                            id: n.id,
                            className: (n.className || '').toString().slice(0, 80),
                            text: (n.textContent || '').trim().slice(0, 60)
                        }))
                })
            }
        }

        const iframes = Array.from(document.querySelectorAll('iframe')).map(f => ({
            src: (f.src || '').slice(0, 120),
            id: f.id
        }))

        return {
            title: document.title,
            href: location.href,
            quizKeys,
            quizData: qd
                ? {
                      correctAnswer: qd.correctAnswer,
                      quizRenderSummaryPage: qd.quizRenderSummaryPage,
                      keys: Object.keys(qd).slice(0, 20)
                  }
                : null,
            candidates,
            iframes,
            bodySnippet: document.body?.innerText?.slice(0, 400) ?? ''
        }
    })

    console.log(JSON.stringify(info, null, 2))

    const outDir = path.join(projectRoot, 'diagnostics', 'probe-' + todayKey())
    fs.mkdirSync(outDir, { recursive: true })
    const slug = title.replace(/[^a-z0-9]+/gi, '-').slice(0, 40)
    await page.screenshot({ path: path.join(outDir, `${slug}.png`), fullPage: true })

    await context.close()
}

async function main() {
    const cookies = JSON.parse(fs.readFileSync(sessionPath, 'utf8'))
    const dash = await fetchDashboard(cookies)
    const key = todayKey()
    const all = dash.dailySetPromotions?.[key] ?? []
    console.log('dateKey:', key, 'dailySet count:', all.length)
    for (const it of all) {
        console.log(
            '-',
            it.title,
            '| complete=',
            it.complete,
            '| progress=',
            `${it.pointProgress}/${it.pointProgressMax}`,
            '|',
            it.destinationUrl?.slice(0, 100)
        )
    }

    const items = all.filter(x => x.pointProgressMax > 0)

    const browser = await chromium.launch({ headless: true })
    for (const it of items.slice(0, 3)) {
        if (it.destinationUrl) await probePage(browser, it.destinationUrl, it.title)
    }
    await browser.close()
}

main().catch(err => {
    console.error(err)
    process.exit(1)
})
