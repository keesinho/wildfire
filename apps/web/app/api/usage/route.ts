import { prisma } from '@wildfire/db'
import { hashKey, jsonOk, jsonError } from '@/lib/apiAuth'
import { limitForPlan } from '@/lib/plans'

export const dynamic = 'force-dynamic'

export async function POST(request: Request) {
  const body   = await request.json().catch(() => null)
  const apiKey = typeof body?.apiKey === 'string' ? body.apiKey.trim() : ''

  if (!apiKey) return jsonError(400, 'apiKey verplicht')

  const key = await prisma.apiKey.findUnique({
    where:  { keyHash: hashKey(apiKey) },
    select: { id: true, plan: true, createdAt: true },
  })
  if (!key) return jsonError(401, 'Onbekende API-key')

  const today = new Date(); today.setUTCHours(0, 0, 0, 0)
  const usage = await prisma.apiUsage.findUnique({
    where:  { apiKeyId_date: { apiKeyId: key.id, date: today } },
    select: { count: true },
  })

  return jsonOk({
    plan:       key.plan,
    dailyLimit: limitForPlan(key.plan),
    usedToday:  usage?.count ?? 0,
    keySince:   key.createdAt.toISOString(),
  })
}
