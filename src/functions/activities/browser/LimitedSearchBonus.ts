import { randomBytes } from 'crypto'
import type { Page } from 'patchright'
import type { AxiosRequestConfig } from 'axios'

import { Workers } from '../../Workers'
import { QueryCore } from '../../QueryEngine'
import type { BasePromotion, DashboardData } from '../../../interface/DashboardData'

/** Limited-time "Search more. Earn more" banner (e.g. 100 extra points/day). */
export class LimitedSearchBonus extends Workers {
    private bingHome = 'https://www.bing.com'

    public static findPromotions(data: DashboardData): BasePromotion[] {
        const all = [
            ...(data.morePromotions ?? []),
            ...(data.morePromotionsWithoutPromotionalItems ?? [])
        ]

        return [
            ...new Map(
                all
                    .filter(p => {
                        if (!p?.offerId || p.complete) return false
                        if (p.pointProgressMax <= 0) return false
                        if (p.pointProgress >= p.pointProgressMax) return false

                        const id = p.offerId.toLowerCase()
                        const title = (p.title ?? '').toLowerCase()
                        return (
                            id.includes('banner_search') ||
                            (p.pointProgressMax >= 100 && title.includes('100 points'))
                        )
                    })
                    .map(p => [p.offerId, p as BasePromotion] as const)
            ).values()
        ]
    }

    public async doLimitedSearchBonuses(data: DashboardData, page: Page): Promise<number> {
        const promotions = LimitedSearchBonus.findPromotions(data)
        if (!promotions.length) {
            this.bot.logger.info(this.bot.isMobile, 'LIMITED-SEARCH-BONUS', 'No active limited search bonus offers')
            return 0
        }

        let totalGained = 0
        for (const promotion of promotions) {
            totalGained += await this.doOnePromotion(promotion, page)
        }
        return totalGained
    }

    private async doOnePromotion(promotion: BasePromotion, page: Page): Promise<number> {
        const offerId = promotion.offerId
        const startBalance = Number(this.bot.userData.currentPoints ?? 0)
        let progress = await this.getOfferProgress(offerId)
        const target = progress.max - progress.progress

        this.bot.logger.info(
            this.bot.isMobile,
            'LIMITED-SEARCH-BONUS',
            `Starting "${promotion.title}" | offerId=${offerId} | progress=${progress.progress}/${progress.max} | remaining=${target}`
        )

        if (target <= 0) return 0

        if (!(await this.activate(promotion))) {
            this.bot.logger.warn(
                this.bot.isMobile,
                'LIMITED-SEARCH-BONUS',
                `Activation failed, continuing with tagged searches | offerId=${offerId}`
            )
        }

        await this.warmupPromotion(page, promotion)

        const tagParams = this.extractSearchTags(promotion.destinationUrl)
        const queryCore = new QueryCore(this.bot)
        const locale = (this.bot.userData.geoLocale ?? 'US').toUpperCase()
        const langCode = (this.bot.userData.langCode ?? 'en').toLowerCase()

        let queries = await queryCore.queryManager({
            shuffle: true,
            related: true,
            langCode,
            geoLocale: locale,
            sourceOrder: this.bot.config.searchSettings.queryEngines
        })
        queries = [...new Set(queries.map(q => q.trim()).filter(Boolean))]

        let stagnant = 0
        const stagnantMax = 40
        const maxAttempts = Math.max(target + 30, 120)

        for (let i = 0; i < maxAttempts && progress.progress < progress.max; i++) {
            const query = queries[i % queries.length]
            if (!query) break

            const balanceBefore = await this.bot.browser.func.getCurrentPoints()
            await this.runTaggedSearch(page, query, tagParams)
            const balanceAfter = await this.bot.browser.func.getCurrentPoints()

            const updated = await this.getOfferProgress(offerId)
            const progressGain = updated.progress - progress.progress
            const balanceGain = Math.max(0, balanceAfter - balanceBefore)

            if (progressGain > 0 || balanceGain > 0) {
                stagnant = 0
                progress = updated
                if (balanceGain > 0) {
                    this.bot.userData.currentPoints = balanceAfter
                }

                this.bot.logger.info(
                    this.bot.isMobile,
                    'LIMITED-SEARCH-BONUS',
                    `Progress +${progressGain} | balance +${balanceGain} | query="${query}" | ${progress.progress}/${progress.max} | total=${balanceAfter}`,
                    'green'
                )
            } else {
                stagnant++
                this.bot.logger.info(
                    this.bot.isMobile,
                    'LIMITED-SEARCH-BONUS',
                    `No progress ${stagnant}/${stagnantMax} | query="${query}" | ${progress.progress}/${progress.max}`
                )
            }

            if (stagnant >= stagnantMax) {
                this.bot.logger.warn(
                    this.bot.isMobile,
                    'LIMITED-SEARCH-BONUS',
                    `Stopping early (no progress) | offerId=${offerId} | ${progress.progress}/${progress.max}`
                )
                break
            }

            if (i > 0 && i % queries.length === 0) {
                const extra = await queryCore.queryManager({
                    shuffle: true,
                    related: true,
                    langCode,
                    geoLocale: locale,
                    sourceOrder: this.bot.config.searchSettings.queryEngines
                })
                queries = [...new Set([...queries, ...extra].map(q => q.trim()).filter(Boolean))]
            }

            await this.bot.utils.wait(this.bot.utils.randomDelay(3000, 8000))
        }

        const finalBalance = await this.bot.browser.func.getCurrentPoints()
        const gained = Math.max(0, finalBalance - startBalance)
        if (gained > 0) {
            this.bot.userData.currentPoints = finalBalance
            this.bot.userData.gainedPoints = (this.bot.userData.gainedPoints ?? 0) + gained
        }

        this.bot.logger.info(
            this.bot.isMobile,
            'LIMITED-SEARCH-BONUS',
            `Finished "${promotion.title}" | progress=${progress.progress}/${progress.max} | balance +${gained}`,
            progress.progress >= progress.max ? 'green' : undefined
        )

        return gained
    }

    private async warmupPromotion(page: Page, promotion: BasePromotion): Promise<void> {
        const dest = promotion.destinationUrl
        if (!dest) return

        try {
            const url = dest.startsWith('http') ? dest : `https://${dest}`
            this.bot.logger.info(this.bot.isMobile, 'LIMITED-SEARCH-BONUS', `Warming up via ${url}`)
            await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 30000 })
            await this.bot.utils.wait(4000)
            await this.bot.browser.utils.tryDismissAllMessages(page)
        } catch (error) {
            this.bot.logger.warn(
                this.bot.isMobile,
                'LIMITED-SEARCH-BONUS',
                `Warmup navigation failed: ${error instanceof Error ? error.message : String(error)}`
            )
        }
    }

    private extractSearchTags(destinationUrl?: string): URLSearchParams {
        const params = new URLSearchParams()
        if (!destinationUrl) return params

        try {
            const url = destinationUrl.startsWith('http')
                ? new URL(destinationUrl)
                : new URL(`https://${destinationUrl}`)
            for (const key of ['form', 'OCID', 'PUBL', 'CREA', 'wt.mc_id']) {
                const val = url.searchParams.get(key)
                if (val) params.set(key, val)
            }
        } catch {}

        if (!params.has('form')) params.set('form', 'ML2XQD')
        if (!params.has('OCID')) params.set('OCID', params.get('form') ?? 'ML2XQD')
        return params
    }

    private buildSearchUrl(query: string, tagParams: URLSearchParams): string {
        const params = new URLSearchParams(tagParams)
        params.set('q', query)
        const cvid = randomBytes(16).toString('hex')
        params.set('cvid', cvid)
        return `${this.bingHome}/search?${params.toString()}`
    }

    private async runTaggedSearch(page: Page, query: string, tagParams: URLSearchParams): Promise<void> {
        const url = this.buildSearchUrl(query, tagParams)
        await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 30000 })
        await page.waitForLoadState('networkidle', { timeout: 10000 }).catch(() => {})
        await this.bot.browser.utils.tryDismissAllMessages(page)

        try {
            const searchBar = '#sb_form_q'
            const searchBox = page.locator(searchBar).first()
            if (await searchBox.isVisible({ timeout: 3000 })) {
                await this.bot.browser.utils.ghostClick(page, searchBar, { clickCount: 3 })
                await searchBox.fill('')
                await page.keyboard.type(query, { delay: 40 })
                await page.keyboard.press('Enter')
                await this.bot.utils.wait(2000)
            }
        } catch {}

        await this.bot.utils.wait(this.bot.utils.randomDelay(2000, 4000))
    }

    private async activate(promotion: BasePromotion): Promise<boolean> {
        if (!this.bot.requestToken) return false

        try {
            const cookieHeader = this.bot.browser.func.buildCookieHeader(
                this.bot.cookies.mobile,
                ['bing.com', 'live.com', 'microsoftonline.com']
            )
            const fingerprintHeaders = { ...this.bot.fingerprint.headers }
            delete fingerprintHeaders['Cookie']
            delete fingerprintHeaders['cookie']

            const formData = new URLSearchParams({
                id: promotion.offerId,
                hash: promotion.hash,
                timeZone: String(-new Date().getTimezoneOffset()),
                activityAmount: '1',
                dbs: '0',
                form: '',
                type: '',
                __RequestVerificationToken: this.bot.requestToken
            })

            const request: AxiosRequestConfig = {
                url: 'https://rewards.bing.com/api/reportactivity?X-Requested-With=XMLHttpRequest',
                method: 'POST',
                headers: {
                    ...fingerprintHeaders,
                    Cookie: cookieHeader,
                    Referer: 'https://rewards.bing.com/',
                    Origin: 'https://rewards.bing.com'
                },
                data: formData
            }

            await this.bot.axios.request(request)
            return true
        } catch {
            return false
        }
    }

    private async getOfferProgress(offerId: string): Promise<{ progress: number; max: number; complete: boolean }> {
        const data = await this.bot.browser.func.getDashboardData()
        const all = [...(data.morePromotions ?? []), ...(data.morePromotionsWithoutPromotionalItems ?? [])]
        const p = all.find(x => x.offerId === offerId)
        return {
            progress: p?.pointProgress ?? 0,
            max: p?.pointProgressMax ?? 0,
            complete: p?.complete ?? true
        }
    }
}
