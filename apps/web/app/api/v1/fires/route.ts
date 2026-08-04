import { authenticate, jsonOk, jsonError } from '@/lib/apiAuth'
import { checkAndIncrementUsage } from '@/lib/apiUsage'
import { listFires } from '@/lib/fires'
import { ATTRIBUTION } from '@/lib/attribution'

export const dynamic = 'force-dynamic'

function parseBbox(raw: string | null): [number, number, number, number] | null | 'invalid' {
  if (!raw) return null
  const parts = raw.split(',').map(Number)
  if (parts.length !== 4 || parts.some(isNaN)) return 'invalid'
  return parts as [number, number, number, number]
}

export async function GET(request: Request) {
  const auth = await authenticate(request)
  if ('error' in auth) return auth.error

  const usage = await checkAndIncrementUsage(auth.key.id, auth.key.plan)
  if (!usage.ok) return usage.response

  const { searchParams } = new URL(request.url)
  const bbox   = parseBbox(searchParams.get('bbox'))
  const status = searchParams.get('status') ?? undefined

  if (bbox === 'invalid') {
    return jsonError(400, 'bbox moet 4 numerieke waarden zijn: west,south,east,north')
  }

  const geojson = await listFires({ bbox: bbox ?? undefined, status })
  return jsonOk({ ...geojson, attribution: ATTRIBUTION })
}
