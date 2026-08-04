import { prisma } from '@wildfire/db'
import { generateApiKey, hashKey, jsonOk, jsonError } from '@/lib/apiAuth'
import { limitForPlan } from '@/lib/plans'
import { EMAIL_RE, clientIp } from '@/lib/requestUtils'

export const dynamic = 'force-dynamic'

const MAX_SIGNUPS_PER_IP_PER_DAY = 3

export async function POST(request: Request) {
  const body = await request.json().catch(() => null)
  const email = typeof body?.email === 'string' ? body.email.trim() : ''

  if (!EMAIL_RE.test(email)) {
    return jsonError(400, 'Geldig e-mailadres verplicht')
  }

  const ip    = clientIp(request)
  const today = new Date(); today.setUTCHours(0, 0, 0, 0)

  // DB-backed i.p.v. in-memory: overleeft serverless cold starts/meerdere
  // instances (er is bewust geen Redis in dit project — zie PLAN.md §0).
  const recentFromIp = await prisma.apiKey.count({
    where: { signupIp: ip, createdAt: { gte: today } },
  })
  if (recentFromIp >= MAX_SIGNUPS_PER_IP_PER_DAY) {
    return jsonError(429, `Max ${MAX_SIGNUPS_PER_IP_PER_DAY} gratis keys per dag per IP`)
  }

  const raw  = generateApiKey()
  const plan = 'free'

  await prisma.apiKey.create({
    data: { keyHash: hashKey(raw), ownerMail: email, plan, signupIp: ip },
  })

  return jsonOk({ apiKey: raw, plan, dailyLimit: limitForPlan(plan) })
}
