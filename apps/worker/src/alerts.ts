/**
 * Alert-worker: de vier regels uit PLAN.md §4.
 *
 *   1. Nieuw     — status=ACTIVE binnen radiusKm, severity >= minSeverity, nog niet gemeld.
 *   2. Update    — severity-band omhoog, of afstand tot hull krimpt >20% t.o.v. de vorige melding.
 *   3. Throttle  — max 1 bericht (new/update) per event per subscription per 6 uur.
 *   4. All-clear — status=CLOSED, nog niet als all_clear gemeld (geen throttle — eenmalig).
 *
 * Gebruik:
 *   pnpm --filter worker alerts
 *   pnpm --filter worker alerts -- --dry-run   (toont berichten, verstuurt/logt niets)
 */
import 'dotenv/config'
import { prisma } from '@wildfire/db'
import { buildContext, buildMessage, type EventLike, type SubscriptionLike, type AlertKind } from './alertContext.js'
import { sendEmail, sendWebhook } from './notify.js'

const CANDIDATE_MARGIN_KM = 50 // marge boven sub.radiusKm in de SQL-prefilter: hull kan dichterbij liggen dan de centroid
const THROTTLE_H          = 6
const CLOSED_LOOKBACK_H = 24 * 14 // hoe ver terug we CLOSED-events nog voor all-clear controleren

// ── Severity-banden — exact de breekpunten uit cluster.ts ───────────────────
// <20 laag · 20–50 middel · 50–75 hoog · >75 extreem
function severityBand(sev: number): number {
  if (sev < 20) return 0
  if (sev < 50) return 1
  if (sev < 75) return 2
  return 3
}

function toRad(d: number): number { return d * Math.PI / 180 }
function haversineKm(lat1: number, lon1: number, lat2: number, lon2: number): number {
  const R = 6371
  const dLat = toRad(lat2 - lat1)
  const dLon = toRad(lon2 - lon1)
  const a = Math.sin(dLat / 2) ** 2 + Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLon / 2) ** 2
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a))
}

// ── DB-rijen ─────────────────────────────────────────────────────────────

type SubRow = {
  id: string; channel: string; target: string; lat: number; lon: number
  radiusKm: number; minSeverity: number; unsubscribeToken: string
}

type EventRow = EventLike

async function getActiveSubscriptions(): Promise<SubRow[]> {
  return prisma.subscription.findMany({
    where: { active: true },
    select: {
      id: true, channel: true, target: true, lat: true, lon: true,
      radiusKm: true, minSeverity: true, unsubscribeToken: true,
    },
  })
}

async function getCandidateEvents(sub: SubRow): Promise<EventRow[]> {
  // SQL-prefilter op centroid-afstand, met marge: de echte grens (sub.radiusKm,
  // op hull-afstand) wordt hierna in decide() gecontroleerd.
  const nearby = await prisma.$queryRaw<EventRow[]>`
    SELECT id, name, slug, status, severity, trend,
           "centroidLat" AS "centroidLat", "centroidLon" AS "centroidLon"
    FROM "FireEvent"
    WHERE  status != 'CLOSED'
      AND  "geomCentroid" IS NOT NULL
      AND  ST_DWithin(
             "geomCentroid"::geography,
             ST_SetSRID(ST_MakePoint(${sub.lon}, ${sub.lat}), 4326)::geography,
             ${(sub.radiusKm + CANDIDATE_MARGIN_KM) * 1000}
           )
  `

  const closedLookback = new Date(Date.now() - CLOSED_LOOKBACK_H * 3_600_000)
  const closedNeedingAllClear = await prisma.$queryRaw<EventRow[]>`
    SELECT DISTINCT fe.id, fe.name, fe.slug, fe.status, fe.severity, fe.trend,
           fe."centroidLat" AS "centroidLat", fe."centroidLon" AS "centroidLon"
    FROM "FireEvent" fe
    JOIN "NotificationLog" nl ON nl."eventId" = fe.id AND nl."subscriptionId" = ${sub.id}
    WHERE  fe.status = 'CLOSED'
      AND  fe."lastSeen" > ${closedLookback}
      AND  nl.kind IN ('new', 'update')
      AND  NOT EXISTS (
             SELECT 1 FROM "NotificationLog" ac
             WHERE ac."subscriptionId" = ${sub.id} AND ac."eventId" = fe.id AND ac.kind = 'all_clear'
           )
  `

  return [...nearby, ...closedNeedingAllClear]
}

async function getHullDistanceKm(lat: number, lon: number, eventId: string): Promise<number> {
  const rows = await prisma.$queryRaw<{ distance_km: number }[]>`
    SELECT ST_Distance(
             COALESCE("geomHull", "geomCentroid")::geography,
             ST_SetSRID(ST_MakePoint(${lon}, ${lat}), 4326)::geography
           ) / 1000 AS distance_km
    FROM "FireEvent" WHERE id = ${eventId}
  `
  return rows[0]?.distance_km ?? Infinity
}

type LogRow = { kind: string; severity: number | null; distanceKm: number | null; sentAt: Date }

async function getNotificationHistory(subscriptionId: string, eventId: string) {
  const logs = await prisma.notificationLog.findMany({
    where: { subscriptionId, eventId },
    orderBy: { sentAt: 'desc' },
    select: { kind: true, severity: true, distanceKm: true, sentAt: true },
  })
  const last: LogRow | undefined = logs[0]
  const lastNewOrUpdate = logs.find(l => l.kind === 'new' || l.kind === 'update')
  const hasAllClear = logs.some(l => l.kind === 'all_clear')
  return { last, lastNewOrUpdate, hasAllClear }
}

// ── Beslissing per (subscription, event)-paar ───────────────────────────

interface Decision { kind: AlertKind; distanceKm: number }

type SkipReason =
  | 'buiten_radius'           // hull-afstand > sub.radiusKm
  | 'onder_severity_drempel'  // event.severity < sub.minSeverity (bij eerste melding)
  | 'niet_actief'             // status is CANDIDATE/COOLING, nog geen 'nieuw'-trigger
  | 'al_gelogd'               // al gemeld en geen band-jump/krimp sinds toen, of CLOSED met al een all_clear
  | 'throttle'                // laatste new/update-melding minder dan THROTTLE_H geleden

interface DecideResult { decision: Decision | null; reason: SkipReason | null }

async function decide(sub: SubRow, event: EventRow): Promise<DecideResult> {
  const { last, lastNewOrUpdate, hasAllClear } = await getNotificationHistory(sub.id, event.id)

  if (event.status === 'CLOSED') {
    if (hasAllClear) return { decision: null, reason: 'al_gelogd' }
    const distanceKm = await getHullDistanceKm(sub.lat, sub.lon, event.id)
    return { decision: { kind: 'all_clear', distanceKm }, reason: null } // bypasst de 6u-throttle — eenmalig bericht
  }

  // Echte straal-check op hull-afstand — de SQL-prefilter hierboven is bewust
  // ruimer (marge + op centroid) en filtert dit niet af.
  const distanceKm = await getHullDistanceKm(sub.lat, sub.lon, event.id)
  if (distanceKm > sub.radiusKm) return { decision: null, reason: 'buiten_radius' }

  let kind: AlertKind

  if (!lastNewOrUpdate) {
    if (event.status !== 'ACTIVE') return { decision: null, reason: 'niet_actief' }
    if (event.severity < sub.minSeverity) return { decision: null, reason: 'onder_severity_drempel' }
    kind = 'new'
  } else {
    const bandJump = severityBand(event.severity) > severityBand(lastNewOrUpdate.severity ?? 0)
    const shrunk   = lastNewOrUpdate.distanceKm != null && distanceKm <= lastNewOrUpdate.distanceKm * 0.8
    if (!bandJump && !shrunk) return { decision: null, reason: 'al_gelogd' }
    kind = 'update'
  }

  if (last && Date.now() - last.sentAt.getTime() < THROTTLE_H * 3_600_000) {
    return { decision: null, reason: 'throttle' } // rule 3
  }

  return { decision: { kind, distanceKm }, reason: null }
}

// ── Main ─────────────────────────────────────────────────────────────────

async function main() {
  const dryRun = process.argv.includes('--dry-run')
  console.log(`[alerts] start${dryRun ? ' (DRY RUN — geen sends, geen DB-writes)' : ''}`)

  const appBaseUrl = process.env.APP_BASE_URL ?? 'http://localhost:3000'
  if (!process.env.APP_BASE_URL && !dryRun) {
    console.warn('[alerts] APP_BASE_URL niet gezet — uitschrijflinks wijzen naar http://localhost:3000. In productie hoort dit https://www.vuuralert.nl te zijn (zie cron-alerts.yml → vars.APP_BASE_URL).')
  }

  const subs = await getActiveSubscriptions()
  console.log(`[alerts] ${subs.length} actieve subscriptions`)

  let sent = 0
  let skipped = 0
  let failed = 0

  for (const sub of subs) {
    const events = await getCandidateEvents(sub)

    for (const event of events) {
      const { decision, reason } = await decide(sub, event)
      if (!decision) {
        skipped++
        console.log(`[alerts] SKIP ${sub.channel} ${sub.target} (sub ${sub.id}, event ${event.slug}) — reden: ${reason}`)
        continue
      }

      const subLike: SubscriptionLike = { id: sub.id, lat: sub.lat, lon: sub.lon, target: sub.target }
      const ctx = await buildContext(subLike, event)
      ctx.distanceKm = Math.round(decision.distanceKm * 10) / 10 // hull-afstand i.p.v. centroid-afstand

      const unsubscribeUrl = `${appBaseUrl}/unsubscribe?token=${sub.unsubscribeToken}`
      const message = await buildMessage(subLike, event, decision.kind, ctx, unsubscribeUrl)

      if (dryRun) {
        console.log(`\n[dry-run] ${decision.kind.toUpperCase()} → ${sub.channel} ${sub.target} (sub ${sub.id}, event ${event.slug})`)
        console.log(`  onderwerp: ${message.subject}`)
        console.log(message.text.split('\n').map(l => `  ${l}`).join('\n'))
        continue
      }

      let ok = false
      if (sub.channel === 'EMAIL') {
        ok = await sendEmail(sub.target, message.subject, message.text)
      } else {
        ok = await sendWebhook(sub.target, {
          kind: decision.kind,
          event: { id: event.id, name: event.name, slug: event.slug, status: event.status, severity: event.severity, trend: event.trend },
          context: ctx,
          message,
        })
      }

      if (!ok) { failed++; continue }

      await prisma.notificationLog.create({
        data: {
          subscriptionId: sub.id, eventId: event.id, kind: decision.kind,
          severity: event.severity, distanceKm: decision.distanceKm,
        },
      })
      sent++
    }
  }

  console.log(`[alerts] klaar — verstuurd: ${sent}  overgeslagen: ${skipped}  mislukt: ${failed}`)
}

main()
  .catch((err) => { console.error('[alerts] fatal:', err); process.exit(1) })
  .finally(() => prisma.$disconnect())
