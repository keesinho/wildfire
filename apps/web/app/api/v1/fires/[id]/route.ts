import { authenticate, jsonOk, jsonError } from '@/lib/apiAuth'
import { checkAndIncrementUsage } from '@/lib/apiUsage'
import { getFireDetail } from '@/lib/fires'
import { ATTRIBUTION } from '@/lib/attribution'

export const dynamic = 'force-dynamic'

export async function GET(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const auth = await authenticate(request)
  if ('error' in auth) return auth.error

  const usage = await checkAndIncrementUsage(auth.key.id, auth.key.plan)
  if (!usage.ok) return usage.response

  const { id } = await params
  const detail = await getFireDetail(id)
  if (!detail) return jsonError(404, `Geen fire event gevonden met id/slug "${id}"`)

  return jsonOk({ ...detail, attribution: ATTRIBUTION })
}
