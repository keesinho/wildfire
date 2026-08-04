import { randomBytes } from 'node:crypto'
import { prisma } from '@wildfire/db'
import { jsonOk, jsonError } from '@/lib/apiAuth'
import { EMAIL_RE, clientIp } from '@/lib/requestUtils'
import { sendEmail } from '@/lib/resend'

export const dynamic = 'force-dynamic'

const MAX_SUBS_PER_IP_PER_DAY = 5

function clamp(v: number, lo: number, hi: number): number {
  return Math.max(lo, Math.min(hi, v))
}

function baseUrl(request: Request): string {
  const url   = new URL(request.url)
  const proto = request.headers.get('x-forwarded-proto') ?? url.protocol.replace(':', '')
  const host  = request.headers.get('host') ?? url.host
  return `${proto}://${host}`
}

export async function POST(request: Request) {
  const body  = await request.json().catch(() => null)
  const email = typeof body?.email === 'string' ? body.email.trim() : ''
  const lat   = Number(body?.lat)
  const lon   = Number(body?.lon)
  const radiusKm    = clamp(Math.round(Number(body?.radiusKm ?? 30)), 1, 200)
  const minSeverity = clamp(Math.round(Number(body?.minSeverity ?? 20)), 0, 100)
  const label = typeof body?.label === 'string' ? body.label.trim().slice(0, 80) : null

  if (!EMAIL_RE.test(email)) return jsonError(400, 'Geldig e-mailadres verplicht')
  if (isNaN(lat) || lat < -90 || lat > 90)    return jsonError(400, 'lat moet tussen -90 en 90 liggen')
  if (isNaN(lon) || lon < -180 || lon > 180)  return jsonError(400, 'lon moet tussen -180 en 180 liggen')

  const ip    = clientIp(request)
  const today = new Date(); today.setUTCHours(0, 0, 0, 0)

  // DB-backed i.p.v. in-memory (geen Redis in dit project, zie PLAN.md §0).
  const recentFromIp = await prisma.subscription.count({
    where: { signupIp: ip, createdAt: { gte: today } },
  })
  if (recentFromIp >= MAX_SUBS_PER_IP_PER_DAY) {
    return jsonError(429, `Max ${MAX_SUBS_PER_IP_PER_DAY} inschrijvingen per dag per IP`)
  }

  const confirmToken = randomBytes(24).toString('base64url')

  const sub = await prisma.subscription.create({
    data: {
      channel: 'EMAIL', target: email, label, lat, lon, radiusKm, minSeverity,
      active: false, confirmToken, signupIp: ip,
    },
  })

  const confirmUrl = `${baseUrl(request)}/confirm?token=${confirmToken}`
  const sent = await sendEmail(
    email,
    'Bevestig je wildfire-alert',
    `Bevestig je inschrijving voor brandwaarschuwingen (binnen ${radiusKm} km van je locatie):\n\n${confirmUrl}\n\nHeb je dit niet aangevraagd? Negeer dit bericht dan gewoon — er gebeurt niets zonder bevestiging.`,
  )

  if (!sent) {
    // Rij blijft staan (active: false) — gebruiker kan het opnieuw proberen;
    // we faalt niet hard omdat Resend een tijdelijke storing kan hebben.
    console.error(`[subscribe] bevestigingsmail niet verstuurd voor subscription ${sub.id}`)
  }

  return jsonOk({ message: 'Check je inbox om je inschrijving te bevestigen.' })
}
