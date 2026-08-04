import { randomUUID } from 'node:crypto'
import { prisma } from '@wildfire/db'
import { limitForPlan } from './plans'
import { jsonError } from './apiAuth'
import type { NextResponse } from 'next/server'

function secondsUntilNextUtcMidnight(): number {
  const now = new Date()
  const next = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() + 1))
  return Math.ceil((next.getTime() - now.getTime()) / 1000)
}

/**
 * Atomisch increment-then-compare (niet check-then-increment) — voorkomt een
 * race tussen gelijktijdige requests. Het verzoek dat de teller over de
 * limiet duwt telt zelf mee en krijgt de 429.
 */
export async function checkAndIncrementUsage(
  apiKeyId: string,
  plan: string,
): Promise<{ ok: true } | { ok: false; response: NextResponse }> {
  const today = new Date(); today.setUTCHours(0, 0, 0, 0)
  const limit = limitForPlan(plan)

  const rows = await prisma.$queryRaw<{ count: number }[]>`
    INSERT INTO "ApiUsage" (id, "apiKeyId", date, count)
    VALUES (${randomUUID()}, ${apiKeyId}, ${today}, 1)
    ON CONFLICT ("apiKeyId", date) DO UPDATE SET count = "ApiUsage".count + 1
    RETURNING count
  `
  const count = rows[0].count

  if (count > limit) {
    const retryAfter = secondsUntilNextUtcMidnight()
    return {
      ok: false,
      response: jsonError(429, `Daglimiet bereikt (${limit} requests/dag voor plan "${plan}")`, {
        'Retry-After': String(retryAfter),
      }),
    }
  }

  return { ok: true }
}
