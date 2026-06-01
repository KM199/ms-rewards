import type { MicrosoftRewardsBot } from '../index'

export type FlowStepStatus = 'ok' | 'failed' | 'skipped'

export interface FlowStepResult {
    name: string
    status: FlowStepStatus
    durationMs: number
    error?: string
}

export interface MainFlowResult {
    initialPoints: number
    collectedPoints: number
    steps: FlowStepResult[]
    criticalFailure?: string
}

/** Run one flow segment; log and continue the overall run on failure. */
export async function runFlowStep(
    bot: MicrosoftRewardsBot,
    name: string,
    fn: () => Promise<void>,
    results: FlowStepResult[],
    options?: { skip?: boolean; skipReason?: string }
): Promise<boolean> {
    if (options?.skip) {
        results.push({
            name,
            status: 'skipped',
            durationMs: 0,
            error: options.skipReason
        })
        bot.logger.info(
            'main',
            'FLOW-STEP',
            `SKIP ${name}${options.skipReason ? ` (${options.skipReason})` : ''}`
        )
        return false
    }

    const start = Date.now()
    try {
        await fn()
        const durationMs = Date.now() - start
        results.push({ name, status: 'ok', durationMs })
        bot.logger.info('main', 'FLOW-STEP', `OK ${name} (${(durationMs / 1000).toFixed(1)}s)`, 'green')
        return true
    } catch (error) {
        const durationMs = Date.now() - start
        const msg = error instanceof Error ? error.message : String(error)
        results.push({ name, status: 'failed', error: msg, durationMs })
        bot.logger.error('main', 'FLOW-STEP', `FAIL ${name}: ${msg}`)
        if (error instanceof Error && error.stack) {
            bot.logger.debug('main', 'FLOW-STEP', error.stack)
        }
        return false
    }
}

export function logFlowSummary(bot: MicrosoftRewardsBot, steps: FlowStepResult[]): void {
    const ok = steps.filter(s => s.status === 'ok').map(s => s.name)
    const failed = steps.filter(s => s.status === 'failed')
    const skipped = steps.filter(s => s.status === 'skipped').map(s => s.name)

    if (failed.length === 0) {
        bot.logger.info(
            'main',
            'FLOW-SUMMARY',
            `All steps OK (${ok.length})${skipped.length ? ` | skipped: ${skipped.join(', ')}` : ''}`,
            'green'
        )
        return
    }

    const failDetail = failed.map(f => `${f.name}: ${f.error ?? 'unknown'}`).join('; ')
    bot.logger.warn(
        'main',
        'FLOW-SUMMARY',
        `${ok.length} OK, ${failed.length} failed, ${skipped.length} skipped | ${failDetail}`
    )
}

export function formatFailedSteps(steps: FlowStepResult[]): string {
    const failed = steps.filter(s => s.status === 'failed')
    if (!failed.length) return ''
    return failed.map(f => f.name).join(', ')
}
