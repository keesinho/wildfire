import { authenticate, jsonOk, jsonError } from '@/lib/apiAuth'
import { checkAndIncrementUsage } from '@/lib/apiUsage'
import { computeRisk } from '@/lib/risk'

export const dynamic = 'force-dynamic'

export async function GET(request: Request) {
  const auth = await authenticate(request)
  if ('error' in auth) return auth.error

  const usage = await checkAndIncrementUsage(auth.key.id, auth.key.plan)
  if (!usage.ok) return usage.response

  const { searchParams } = new URL(request.url)
  const lat = parseFloat(searchParams.get('lat') ?? '')
  const lon = parseFloat(searchParams.get('lon') ?? '')

  if (isNaN(lat) || isNaN(lon)) {
    return jsonError(400, 'lat en lon zijn verplicht en moeten numeriek zijn')
  }

  const result = await computeRisk(lat, lon)
  return jsonOk(result)
}
