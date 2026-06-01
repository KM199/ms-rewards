import type { MicrosoftRewardsBot } from '../index'

export interface SearchAttemptRecord {
    preDelayMs: number
    credited: boolean
    points: number
    msSinceLastCredit: number | null
    query: string
    remaining: number
    phase: 'main' | 'extra'
}

/** Bucket pre-search wait times for hit-rate analysis. */
const DELAY_BUCKETS_MS: Array<{ label: string; min: number; max: number }> = [
    { label: '0-30s', min: 0, max: 30_000 },
    { label: '30s-2m', min: 30_000, max: 120_000 },
    { label: '2m-5m', min: 120_000, max: 300_000 },
    { label: '5m-10m', min: 300_000, max: 600_000 },
    { label: '10m-15m', min: 600_000, max: 900_000 },
    { label: '15m+', min: 900_000, max: Number.POSITIVE_INFINITY }
]

export function formatDurationMs(ms: number): string {
    if (ms < 1000) return `${ms}ms`
    const sec = Math.round(ms / 1000)
    if (sec < 60) return `${sec}s`
    const min = Math.floor(sec / 60)
    const remSec = sec % 60
    if (min < 60) return remSec ? `${min}m${remSec}s` : `${min}m`
    const hr = Math.floor(min / 60)
    const remMin = min % 60
    return remMin ? `${hr}h${remMin}m` : `${hr}h`
}

export class SearchRateTelemetry {
    private records: SearchAttemptRecord[] = []
    private lastCreditAt: number | null = null

    record(attempt: SearchAttemptRecord): void {
        this.records.push(attempt)
        if (attempt.credited) {
            this.lastCreditAt = Date.now()
        }
    }

    msSinceLastCredit(): number | null {
        if (this.lastCreditAt === null) return null
        return Date.now() - this.lastCreditAt
    }

    logAttempt(
        bot: MicrosoftRewardsBot,
        isMobile: boolean,
        tag: 'SEARCH-BING' | 'SEARCH-BING-EXTRA',
        attempt: SearchAttemptRecord,
        stagnant?: string
    ): void {
        const sinceCredit =
            attempt.msSinceLastCredit === null ? 'n/a' : formatDurationMs(attempt.msSinceLastCredit)
        const creditLabel = attempt.credited ? `yes +${attempt.points}` : 'no'
        const stagnantPart = stagnant ? ` | stagnant=${stagnant}` : ''

        bot.logger.info(
            isMobile,
            `${tag}-TIMING`,
            `preDelay=${formatDurationMs(attempt.preDelayMs)} | sinceLastCredit=${sinceCredit} | credited=${creditLabel} | remaining=${attempt.remaining}${stagnantPart} | query="${attempt.query}"`
        )
    }

    logSummary(bot: MicrosoftRewardsBot, isMobile: boolean): void {
        if (!this.records.length) return

        const credited = this.records.filter(r => r.credited)
        const totalWaitMs = this.records.reduce((sum, r) => sum + r.preDelayMs, 0)
        const hitRate = ((100 * credited.length) / this.records.length).toFixed(1)
        const points = credited.reduce((sum, r) => sum + r.points, 0)
        const avgDelay =
            this.records.length > 0 ? Math.round(totalWaitMs / this.records.length) : 0
        const avgAttemptsPerCredit =
            credited.length > 0 ? (this.records.length / credited.length).toFixed(1) : 'n/a'

        bot.logger.info(
            isMobile,
            'SEARCH-RATE-SUMMARY',
            `attempts=${this.records.length} | credited=${credited.length} | points=+${points} | hitRate=${hitRate}% | avgPreDelay=${formatDurationMs(avgDelay)} | totalPreDelayWait=${formatDurationMs(totalWaitMs)} | avgAttemptsPerCredit=${avgAttemptsPerCredit}`
        )

        for (const bucket of DELAY_BUCKETS_MS) {
            const inBucket = this.records.filter(r => r.preDelayMs >= bucket.min && r.preDelayMs < bucket.max)
            if (!inBucket.length) continue

            const bucketCredits = inBucket.filter(r => r.credited).length
            const bucketHit = ((100 * bucketCredits) / inBucket.length).toFixed(1)

            bot.logger.info(
                isMobile,
                'SEARCH-RATE-BUCKET',
                `preDelay=${bucket.label} | attempts=${inBucket.length} | credited=${bucketCredits} | hitRate=${bucketHit}%`
            )
        }

        const creditedWithSince = this.records.filter(r => r.credited && r.msSinceLastCredit !== null)
        if (creditedWithSince.length > 1) {
            const gaps = creditedWithSince
                .map(r => r.msSinceLastCredit as number)
                .filter(ms => ms > 0)
            if (gaps.length) {
                const avgGap = Math.round(gaps.reduce((a, b) => a + b, 0) / gaps.length)
                const minGap = Math.min(...gaps)
                const maxGap = Math.max(...gaps)
                bot.logger.info(
                    isMobile,
                    'SEARCH-RATE-SUMMARY',
                    `timeBetweenCredits | avg=${formatDurationMs(avgGap)} | min=${formatDurationMs(minGap)} | max=${formatDurationMs(maxGap)} | samples=${gaps.length}`
                )
            }
        }
    }
}
