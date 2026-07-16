import type { Page } from 'patchright'
import { randomBytes } from 'crypto'
import type { Counters, DashboardData } from '../../../interface/DashboardData'

import { QueryCore } from '../../QueryEngine'
import { Workers } from '../../Workers'
import { formatDurationMs, SearchRateTelemetry } from '../../../util/SearchRateTelemetry'

export class Search extends Workers {
    private bingHome = 'https://bing.com'
    private searchPageURL = ''
    private searchCount = 0
    private telemetry = new SearchRateTelemetry()

    public async doSearch(data: DashboardData, page: Page, isMobile: boolean): Promise<number> {
        const startBalance = Number(this.bot.userData.currentPoints ?? 0)

        this.bot.logger.info(isMobile, 'SEARCH-BING', `Starting Bing searches | currentPoints=${startBalance}`)

        const betweenDelay = this.bot.config.searchSettings.betweenSearchDelay ?? this.bot.config.searchSettings.searchDelay
        this.bot.logger.info(
            isMobile,
            'SEARCH-BING',
            `Between-search delay | min=${betweenDelay.min} | max=${betweenDelay.max} | on-page dwell via searchDelay min=${this.bot.config.searchSettings.searchDelay.min} max=${this.bot.config.searchSettings.searchDelay.max}`
        )

        let totalGainedPoints = 0

        try {
            let searchCounters: Counters = await this.bot.browser.func.getSearchPoints()
            const missingPoints = this.bot.browser.func.missingSearchPoints(searchCounters, isMobile)
            let missingPointsTotal = missingPoints.totalPoints

            this.bot.logger.debug(
                isMobile,
                'SEARCH-BING',
                `Initial search counters | mobile=${missingPoints.mobilePoints} | desktop=${missingPoints.desktopPoints} | edge=${missingPoints.edgePoints}`
            )

            this.bot.logger.info(
                isMobile,
                'SEARCH-BING',
                `Search points remaining | Edge=${missingPoints.edgePoints} | Desktop=${missingPoints.desktopPoints} | Mobile=${missingPoints.mobilePoints}`
            )

            const queryCore = new QueryCore(this.bot)
            const locale = (this.bot.userData.geoLocale ?? 'US').toUpperCase()
            const langCode = (this.bot.userData.langCode ?? 'en').toLowerCase()

            let queries = await queryCore.queryManager({
                shuffle: true,
                related: true,
                langCode,
                geoLocale: locale,
                sourceOrder: ['google', 'wikipedia', 'reddit', 'local']
            })

            queries = [...new Set(queries.map(q => q.trim()).filter(Boolean))]

            this.bot.logger.info(isMobile, 'SEARCH-BING', `Search query pool ready | count=${queries.length}`)

            const targetUrl = this.searchPageURL ? this.searchPageURL : this.bingHome
            await page.goto(targetUrl)
            await page.waitForLoadState('networkidle', { timeout: 10000 }).catch(() => {})
            await this.bot.browser.utils.tryDismissAllMessages(page)

            let stagnantLoop = 0
            const stagnantLoopMax = 10
            let isFirstSearch = true

            for (let i = 0; i < queries.length; i++) {
                const query = queries[i] as string
                const preDelayMs = await this.waitBetweenSearches(isMobile, isFirstSearch)
                isFirstSearch = false

                const outcome = await this.runSearchAttempt(
                    page,
                    query,
                    isMobile,
                    missingPointsTotal,
                    preDelayMs,
                    'main'
                )

                if (outcome.gainedPoints > 0) {
                    stagnantLoop = 0
                    totalGainedPoints += outcome.gainedPoints
                } else {
                    stagnantLoop++
                    this.bot.logger.info(
                        isMobile,
                        'SEARCH-BING',
                        `No points gained ${stagnantLoop}/${stagnantLoopMax} | query="${query}" | remaining=${outcome.remaining}`
                    )
                }

                missingPointsTotal = outcome.remaining

                if (missingPointsTotal === 0) {
                    this.bot.logger.info(
                        isMobile,
                        'SEARCH-BING',
                        'All required search points earned, stopping main search loop'
                    )
                    break
                }

                if (stagnantLoop > stagnantLoopMax) {
                    this.bot.logger.warn(
                        isMobile,
                        'SEARCH-BING',
                        `Search did not gain points for ${stagnantLoopMax} iterations, aborting main search loop`
                    )
                    break
                }

                const remainingQueries = queries.length - (i + 1)
                if (missingPointsTotal > 0 && remainingQueries < 20) {
                    this.bot.logger.warn(
                        isMobile,
                        'SEARCH-BING',
                        `Low query buffer while still missing points, regenerating | remainingQueries=${remainingQueries} | missing=${missingPointsTotal}`
                    )

                    const extra = await queryCore.queryManager({
                        shuffle: true,
                        related: true,
                        langCode,
                        geoLocale: locale,
                        sourceOrder: this.bot.config.searchSettings.queryEngines
                    })

                    const merged = [...queries, ...extra].map(q => q.trim()).filter(Boolean)
                    queries = this.bot.utils.shuffleArray([...new Set(merged)])

                    this.bot.logger.debug(isMobile, 'SEARCH-BING', `Query pool regenerated | count=${queries.length}`)
                }
            }

            if (missingPointsTotal > 0) {
                this.bot.logger.info(
                    isMobile,
                    'SEARCH-BING',
                    `Search completed but still missing points, continuing with regenerated queries | remaining=${missingPointsTotal}`
                )

                let stagnantLoop = 0
                const stagnantLoopMax = 5

                while (missingPointsTotal > 0) {
                    const extra = await queryCore.queryManager({
                        shuffle: true,
                        related: true,
                        langCode,
                        geoLocale: locale,
                        sourceOrder: this.bot.config.searchSettings.queryEngines
                    })

                    queries = this.bot.utils.shuffleArray([
                        ...new Set([...queries, ...extra].map(q => q.trim()).filter(Boolean))
                    ])

                    this.bot.logger.info(
                        isMobile,
                        'SEARCH-BING-EXTRA',
                        `New search query pool generated | count=${queries.length}`
                    )

                    for (const query of queries) {
                        const preDelayMs = await this.waitBetweenSearches(isMobile, isFirstSearch)
                        isFirstSearch = false

                        const outcome = await this.runSearchAttempt(
                            page,
                            query,
                            isMobile,
                            missingPointsTotal,
                            preDelayMs,
                            'extra'
                        )

                        if (outcome.gainedPoints > 0) {
                            stagnantLoop = 0
                            totalGainedPoints += outcome.gainedPoints
                        } else {
                            stagnantLoop++
                            this.bot.logger.info(
                                isMobile,
                                'SEARCH-BING-EXTRA',
                                `No points gained ${stagnantLoop}/${stagnantLoopMax} | query="${query}" | remaining=${outcome.remaining}`
                            )
                        }

                        missingPointsTotal = outcome.remaining

                        if (missingPointsTotal === 0) {
                            this.bot.logger.info(
                                isMobile,
                                'SEARCH-BING-EXTRA',
                                'All required search points earned during extra searches'
                            )
                            break
                        }

                        if (stagnantLoop > stagnantLoopMax) {
                            this.bot.logger.warn(
                                isMobile,
                                'SEARCH-BING-EXTRA',
                                `Search did not gain points for ${stagnantLoopMax} iterations, aborting extra searches`
                            )
                            this.telemetry.logSummary(this.bot, isMobile)
                            return totalGainedPoints
                        }
                    }
                }
            }

            this.telemetry.logSummary(this.bot, isMobile)

            const finalBalance = Number(this.bot.userData.currentPoints ?? startBalance)
            this.bot.logger.info(
                isMobile,
                'SEARCH-BING',
                `Completed Bing searches | startBalance=${startBalance} | newBalance=${finalBalance}`
            )

            return totalGainedPoints
        } catch (error) {
            this.telemetry.logSummary(this.bot, isMobile)
            this.bot.logger.error(
                isMobile,
                'SEARCH-BING',
                `Error in doSearch | message=${error instanceof Error ? error.message : String(error)}`
            )
            return totalGainedPoints
        }
    }

    private async waitBetweenSearches(isMobile: boolean, isFirstSearch: boolean): Promise<number> {
        if (isFirstSearch) return 0

        const settings =
            this.bot.config.searchSettings.betweenSearchDelay ?? this.bot.config.searchSettings.searchDelay
        const delayMs = this.bot.utils.randomDelay(settings.min, settings.max)

        this.bot.logger.info(
            isMobile,
            'SEARCH-BING-TIMING',
            `Waiting ${formatDurationMs(delayMs)} before next search`
        )

        await this.bot.utils.wait(delayMs)
        return delayMs
    }

    private async runSearchAttempt(
        page: Page,
        query: string,
        isMobile: boolean,
        missingBefore: number,
        preDelayMs: number,
        phase: 'main' | 'extra'
    ): Promise<{ gainedPoints: number; remaining: number }> {
        const tag = phase === 'main' ? 'SEARCH-BING' : 'SEARCH-BING-EXTRA'
        const msSinceLastCredit = this.telemetry.msSinceLastCredit()

        const searchCounters = await this.bingSearch(page, query, isMobile)
        const newMissingPoints = this.bot.browser.func.missingSearchPoints(searchCounters, isMobile)
        const remaining = newMissingPoints.totalPoints
        const gainedPoints = Math.max(0, missingBefore - remaining)

        const attempt = {
            preDelayMs,
            credited: gainedPoints > 0,
            points: gainedPoints,
            msSinceLastCredit,
            query,
            remaining,
            phase
        }

        this.telemetry.record(attempt)
        this.telemetry.logAttempt(this.bot, isMobile, tag, attempt)

        if (gainedPoints > 0) {
            const newBalance = Number(this.bot.userData.currentPoints ?? 0) + gainedPoints
            this.bot.userData.currentPoints = newBalance
            this.bot.userData.gainedPoints = (this.bot.userData.gainedPoints ?? 0) + gainedPoints

            this.bot.logger.info(
                isMobile,
                tag,
                `gainedPoints=${gainedPoints} points | query="${query}" | remaining=${remaining}`,
                'green'
            )
        }

        return { gainedPoints, remaining }
    }

    private async bingSearch(searchPage: Page, query: string, isMobile: boolean) {
        const maxAttempts = 5
        const refreshThreshold = 10

        this.searchCount++

        if (this.searchCount % refreshThreshold === 0) {
            this.bot.logger.info(
                isMobile,
                'SEARCH-BING',
                `Returning to home page to clear accumulated page context | count=${this.searchCount} | threshold=${refreshThreshold}`
            )

            const cvid = randomBytes(16).toString('hex')
            const url = `${this.bingHome}/search?q=${encodeURIComponent(query)}&PC=U531&FORM=ANNTA1&cvid=${cvid}`

            await searchPage.goto(url)
            await searchPage.waitForLoadState('networkidle', { timeout: 10000 }).catch(() => {})
            await this.bot.browser.utils.tryDismissAllMessages(searchPage)
        }

        for (let i = 0; i < maxAttempts; i++) {
            try {
                const searchBar = '#sb_form_q'
                const searchBox = searchPage.locator(searchBar).first()

                await searchPage.evaluate(() => {
                    window.scrollTo({ left: 0, top: 0, behavior: 'auto' })
                })

                await searchPage.keyboard.press('Home')
                await searchBox.waitFor({ state: 'visible', timeout: 15000 })

                await this.bot.utils.wait(1000)
                await this.bot.browser.utils.ghostClick(searchPage, searchBar, { clickCount: 3 })
                await searchBox.fill('')

                await searchPage.keyboard.type(query, { delay: 50 })
                await searchPage.keyboard.press('Enter')

                await this.bot.utils.wait(3000)

                if (this.bot.config.searchSettings.scrollRandomResults) {
                    await this.bot.utils.wait(2000)
                    await this.randomScroll(searchPage, isMobile)
                }

                if (this.bot.config.searchSettings.clickRandomResults) {
                    await this.bot.utils.wait(2000)
                    await this.clickRandomLink(searchPage, isMobile)
                }

                await this.bot.utils.wait(
                    this.bot.utils.randomDelay(
                        this.bot.config.searchSettings.searchDelay.min,
                        this.bot.config.searchSettings.searchDelay.max
                    )
                )

                return await this.bot.browser.func.getSearchPoints()
            } catch (error) {
                if (i >= maxAttempts - 1) {
                    this.bot.logger.error(
                        isMobile,
                        'SEARCH-BING',
                        `Failed after ${maxAttempts} retries | query="${query}" | message=${error instanceof Error ? error.message : String(error)}`
                    )
                    break
                }

                this.bot.logger.warn(
                    isMobile,
                    'SEARCH-BING',
                    `Retrying search | attempt=${i + 1}/${maxAttempts} | query="${query}"`
                )

                await this.bot.utils.wait(2000)
            }
        }

        return await this.bot.browser.func.getSearchPoints()
    }

    private async randomScroll(page: Page, isMobile: boolean) {
        try {
            const viewportHeight = await page.evaluate(() => window.innerHeight)
            const totalHeight = await page.evaluate(() => document.body.scrollHeight)
            const randomScrollPosition = Math.floor(Math.random() * (totalHeight - viewportHeight))

            await page.evaluate((scrollPos: number) => {
                window.scrollTo({ left: 0, top: scrollPos, behavior: 'auto' })
            }, randomScrollPosition)
        } catch (error) {
            this.bot.logger.error(
                isMobile,
                'SEARCH-RANDOM-SCROLL',
                `An error occurred during random scroll | message=${error instanceof Error ? error.message : String(error)}`
            )
        }
    }

    private async clickRandomLink(page: Page, isMobile: boolean) {
        try {
            const searchPageUrl = page.url()

            await this.bot.browser.utils.ghostClick(page, '#b_results .b_algo h2')
            await this.bot.utils.wait(this.bot.config.searchSettings.searchResultVisitTime)

            if (isMobile) {
                await page.goto(searchPageUrl)
            } else {
                const newTab = await this.bot.browser.utils.getLatestTab(page)
                await this.bot.browser.utils.closeTabs(newTab)
            }
        } catch (error) {
            this.bot.logger.error(
                isMobile,
                'SEARCH-RANDOM-CLICK',
                `An error occurred during random click | message=${error instanceof Error ? error.message : String(error)}`
            )
        }
    }
}
