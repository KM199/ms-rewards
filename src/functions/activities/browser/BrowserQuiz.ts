import type { Page } from 'patchright'
import { Workers } from '../../Workers'
import type { BasePromotion } from '../../../interface/DashboardData'
import type { QuizData } from '../../../interface/QuizData'

export class BrowserQuiz extends Workers {
    private oldBalance: number = this.bot.userData.currentPoints

    public async doBrowserQuiz(promotion: BasePromotion, page: Page): Promise<void> {
        const offerId = promotion.offerId
        this.oldBalance = Number(this.bot.userData.currentPoints ?? 0)
        const destinationUrl = promotion.destinationUrl

        this.bot.logger.info(
            this.bot.isMobile,
            'BROWSER-QUIZ',
            `Starting BrowserQuiz | offerId=${offerId} | title="${promotion.title}" | oldBalance=${this.oldBalance}`
        )

        if (!destinationUrl) {
            this.bot.logger.warn(this.bot.isMobile, 'BROWSER-QUIZ', `No destinationUrl | offerId=${offerId}`)
            return
        }

        try {
            await page.goto(destinationUrl, { waitUntil: 'domcontentloaded', timeout: 30000 })
            await this.waitForQuizSurface(page)

            const isPoll =
                destinationUrl.toLowerCase().includes('pollscenarioid') ||
                promotion.title?.toLowerCase().includes('poll')

            if (isPoll) {
                await this.solvePoll(page, offerId)
            } else {
                await this.solveQuiz(page, offerId, promotion)
            }

            const newBalance = await this.bot.browser.func.getCurrentPoints()
            const gained = newBalance - this.oldBalance

            if (gained > 0) {
                this.bot.userData.currentPoints = newBalance
                this.bot.userData.gainedPoints = (this.bot.userData.gainedPoints ?? 0) + gained
                this.bot.logger.info(
                    this.bot.isMobile,
                    'BROWSER-QUIZ',
                    `Completed BrowserQuiz | offerId=${offerId} | gainedPoints=${gained} | newBalance=${newBalance}`,
                    'green'
                )
            } else {
                this.bot.logger.warn(
                    this.bot.isMobile,
                    'BROWSER-QUIZ',
                    `BrowserQuiz yielded no points | offerId=${offerId}`
                )
            }
        } catch (error) {
            this.bot.logger.error(
                this.bot.isMobile,
                'BROWSER-QUIZ',
                `Error in doBrowserQuiz | offerId=${offerId} | message=${error instanceof Error ? error.message : String(error)}`
            )
        }
    }

    private async solveQuiz(page: Page, offerId: string, promotion: BasePromotion): Promise<void> {
        const maxQ = Math.max(
            promotion.activityProgressMax > 10 ? Math.ceil(promotion.activityProgressMax / 10) : promotion.activityProgressMax,
            1
        )

        for (let q = 0; q < maxQ; q++) {
            const quizData = await page
                .evaluate(() => (window as any).QuizData ?? (window as any)._G?.QuizData ?? null)
                .catch(() => null) as QuizData | null

            if (quizData?.quizRenderSummaryPage) break

            if (quizData?.correctAnswer) {
                this.bot.logger.debug(
                    this.bot.isMobile,
                    'BROWSER-QUIZ',
                    `Q${q + 1} correctAnswer="${quizData.correctAnswer}" | offerId=${offerId}`
                )
                const hit =
                    (await this.clickByDataOption(page, quizData.correctAnswer)) ||
                    (await this.clickByText(page, quizData.correctAnswer)) ||
                    (await this.clickEmbeddedRewardOption(page))
                if (!hit) await this.bruteForce(page, offerId)
            } else {
                this.bot.logger.warn(
                    this.bot.isMobile,
                    'BROWSER-QUIZ',
                    `No QuizData.correctAnswer, brute forcing Q${q + 1} | offerId=${offerId}`
                )
                const answered = await this.bruteForce(page, offerId)
                if (!answered) break
            }

            await this.bot.utils.wait(this.bot.utils.randomDelay(1500, 3000))

            const done = await page
                .evaluate(() => !!(
                    document.querySelector('#quizCompleteContainer') ||
                    document.querySelector('.quizCompleted') ||
                    document.querySelector('[class*="summary"]')
                ))
                .catch(() => false)
            if (done) break
        }
    }

    private async waitForQuizSurface(page: Page): Promise<void> {
        const selectors = [
            '.answer_container',
            '.rqOption',
            '[id^="btoption"]',
            '#quizCompleteContainer'
        ]
        for (const sel of selectors) {
            try {
                await page.locator(sel).first().waitFor({ state: 'visible', timeout: 8000 })
                await this.bot.utils.wait(1500)
                return
            } catch {}
        }
        await this.bot.utils.wait(3000)
    }

    private async solvePoll(page: Page, offerId: string): Promise<void> {
        this.bot.logger.info(this.bot.isMobile, 'BROWSER-QUIZ', `Solving poll | offerId=${offerId}`)

        if (await this.clickEmbeddedRewardOption(page)) return

        const selectors = ['#btoption0', '[id^="btoption"]', '.btOption', '.rqOption', 'button[class*="option"]']
        for (const sel of selectors) {
            try {
                const el = page.locator(sel).first()
                if (await el.isVisible({ timeout: 3000 })) {
                    await el.click()
                    await this.bot.utils.wait(2000)
                    return
                }
            } catch {}
        }
        this.bot.logger.warn(this.bot.isMobile, 'BROWSER-QUIZ', `No poll option found | offerId=${offerId}`)
    }

    private async clickByDataOption(page: Page, answer: string): Promise<boolean> {
        try {
            const el = page.locator(`[data-option="${answer}"]`).first()
            if (await el.isVisible({ timeout: 2000 })) {
                await el.click()
                return true
            }
        } catch {}
        return false
    }

    private async clickByText(page: Page, answer: string): Promise<boolean> {
        try {
            const el = page.locator('.rqOption, [class*="option"], .btOption, button')
                .filter({ hasText: answer })
                .first()
            if (await el.isVisible({ timeout: 2000 })) {
                await el.click()
                return true
            }
        } catch {}
        return false
    }

    private async clickEmbeddedRewardOption(page: Page): Promise<boolean> {
        try {
            const container = page.locator('.answer_container').first()
            if (!(await container.isVisible({ timeout: 2000 }))) return false

            const optionLocator = container.locator(
                'button, [role="button"], a, div[class*="option"], div[class*="Option"], span[class*="option"]'
            )
            const count = await optionLocator.count()
            for (let i = 0; i < count; i++) {
                const el = optionLocator.nth(i)
                const text = ((await el.textContent()) ?? '').trim()
                if (!text || text.length > 80) continue
                if (/microsoft rewards|points|\/\d|poll$/i.test(text)) continue

                const before = await this.bot.browser.func.getCurrentPoints()
                await el.click()
                await this.bot.utils.wait(2000)
                const after = await this.bot.browser.func.getCurrentPoints()
                if (after > before) return true
            }
        } catch {}
        return false
    }

    private async bruteForce(page: Page, offerId: string): Promise<boolean> {
        if (await this.clickEmbeddedRewardOption(page)) return true

        const selectors = [
            '.answer_container button',
            '.answer_container [role="button"]',
            '.rqOption',
            '[id^="btoption"]',
            '.btOption',
            '[class*="option"]:not([class*="container"])'
        ]

        for (const sel of selectors) {
            const options = page.locator(sel)
            const count = await options.count().catch(() => 0)
            if (!count) continue

            for (let i = 0; i < count; i++) {
                try {
                    const el = options.nth(i)
                    if (!await el.isVisible({ timeout: 1000 })) continue

                    const before = await this.bot.browser.func.getCurrentPoints()
                    await el.click()
                    await this.bot.utils.wait(1500)
                    const after = await this.bot.browser.func.getCurrentPoints()

                    if (after > before) {
                        this.bot.logger.info(
                            this.bot.isMobile,
                            'BROWSER-QUIZ',
                            `Brute force correct | offerId=${offerId} | option=${i} | gained=${after - before}`
                        )
                        return true
                    }
                } catch {}
            }
            return false
        }
        return false
    }
}
