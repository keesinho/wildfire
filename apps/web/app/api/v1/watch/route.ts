import { prisma } from '@wildfire/db'
import { authenticate, jsonOk, jsonError } from '@/lib/apiAuth'
import { checkAndIncrementUsage } from '@/lib/apiUsage'

export const dynamic = 'force-dynamic'

function clamp(v: number, lo: number, hi: number): number {
  return Math.max(lo, Math.min(hi, v))
}

export async function POST(request: Request) {
  const auth = await authenticate(request)
  if ('error' in auth) return auth.error

  const usage = await checkAndIncrementUsage(auth.key.id, auth.key.plan)
  if (!usage.ok) return usage.response

  const body = await request.json().catch(() => null)
  const url  = typeof body?.url === 'string' ? body.url.trim() : ''
  const lat  = Number(body?.lat)
  const lon  = Number(body?.lon)
  const radiusKm    = clamp(Math.round(Number(body?.radiusKm ?? 30)), 1, 200)
  const minSeverity = clamp(Math.round(Number(body?.minSeverity ?? 20)), 0, 100)
  const label = typeof body?.label === 'string' ? body.label.trim().slice(0, 80) : null

  let parsedUrl: URL
  try {
    parsedUrl = new URL(url)
  } catch {
    return jsonError(400, 'url is verplicht en moet een geldige URL zijn')
  }
  if (parsedUrl.protocol !== 'http:' && parsedUrl.protocol !== 'https:') {
    return jsonError(400, 'url moet http of https zijn')
  }
  if (isNaN(lat) || lat < -90 || lat > 90)   return jsonError(400, 'lat moet tussen -90 en 90 liggen')
  if (isNaN(lon) || lon < -180 || lon > 180) return jsonError(400, 'lon moet tussen -180 en 180 liggen')

  // Webhook-subscriptions gaan direct actief: de API-key bewijst identiteit,
  // dus de dubbele-opt-in die e-mailinschrijvingen beschermt tegen het
  // ongevraagd mailen van iemand anders is hier niet van toepassing.
  const sub = await prisma.subscription.create({
    data: {
      channel: 'WEBHOOK', target: url, label, lat, lon, radiusKm, minSeverity,
      active: true, apiKeyId: auth.key.id,
    },
  })

  return jsonOk({
    id: sub.id, active: true, radiusKm, minSeverity,
    unsubscribeUrl: `/unsubscribe?token=${sub.unsubscribeToken}`,
  })
}
