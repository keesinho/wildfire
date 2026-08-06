/**
 * Replay-script (PLAN.md §7): speel bestaande detecties opnieuw af
 * in acquiredAt-volgorde, met configureerbare clusterparameters.
 *
 * Gebruik:
 *   pnpm replay                          # standaardparameters
 *   pnpm replay -- --eps 1.5             # kleinere cluster-afstand
 *   pnpm replay -- --eps 2.5 --min-pts 3 # hogere drempel
 *   REPLAY_EPS=1.5 REPLAY_MIN_PTS=3 pnpm replay
 */
import 'dotenv/config'
import { prisma } from '@wildfire/db'
import {
  processDetection,
  recalculateEvent,
  runStatusMachine,
  DEFAULT_CONFIG,
  type ClusterConfig,
} from './cluster.js'
import { filterNewDetections } from './filter.js'

// ── Arg-parsing ──────────────────────────────────────────────────────────────

function getParam(envKey: string, cliFlag: string, fallback: string): string {
  const idx = process.argv.indexOf(`--${cliFlag}`)
  if (idx !== -1 && process.argv[idx + 1]) return process.argv[idx + 1]
  return process.env[envKey] ?? fallback
}

function fmtDuration(ms: number): string {
  const h = Math.floor(ms / 3_600_000)
  const d = Math.floor(h / 24)
  if (d >= 1) return `${d}d ${h % 24}u`
  return `${h}u`
}

function fmtHa(ha: number | null): string {
  if (ha == null) return '—'
  return ha >= 1000
    ? `${(ha / 1000).toFixed(1)} kha`
    : `${Math.round(ha)} ha`
}

// ── Main ─────────────────────────────────────────────────────────────────────

async function main() {
  const cfg: ClusterConfig = {
    ...DEFAULT_CONFIG,
    epsKm:  parseFloat(getParam('REPLAY_EPS',     'eps',     String(DEFAULT_CONFIG.epsKm))),
    minPts: parseInt  (getParam('REPLAY_MIN_PTS', 'min-pts', String(DEFAULT_CONFIG.minPts)), 10),
  }

  console.log('═'.repeat(60))
  console.log(`[replay] parameters:`)
  console.log(`         EPS_KM         = ${cfg.epsKm}`)
  console.log(`         ATTACH_WINDOW_H = ${cfg.attachWindowH}`)
  console.log(`         MIN_PTS        = ${cfg.minPts}`)
  console.log(`         SOLO_FRP_MW    = ${cfg.soloFrpMw}`)
  console.log(`         COOLING_H      = ${cfg.coolingH}`)
  console.log(`         CLOSED_H       = ${cfg.closedH}`)
  console.log('═'.repeat(60))

  // ── 1. Reset ──────────────────────────────────────────────────────────────
  console.log('[replay] FireEvent-tabel leegmaken + detecties volledig resetten…')
  await prisma.$executeRaw`
    UPDATE "Detection"
    SET "eventId" = NULL, filtered = false, "filterReason" = NULL
  `
  await prisma.fireEvent.deleteMany()
  console.log('[replay] reset klaar')

  // ── 1b. Filter opnieuw toepassen ──────────────────────────────────────────
  console.log('[replay] filters toepassen…')
  const { noNutsFiltered, staticHeatFiltered, lowConfFiltered } = await filterNewDetections(cfg)
  console.log(`[replay] no_nuts_region: ${noNutsFiltered}  static_heat_source: ${staticHeatFiltered}  low_conf_isolated: ${lowConfFiltered}`)

  // ── 2. Detecties ophalen ──────────────────────────────────────────────────
  const detections = await prisma.detection.findMany({
    where:   { filtered: false },
    orderBy: { acquiredAt: 'asc' },
    select:  { id: true, lat: true, lon: true, frp: true, confidence: true, acquiredAt: true },
  })

  const total     = detections.length
  const startTime = Date.now()
  console.log(`[replay] ${total} detecties te verwerken (${new Date(detections[0]?.acquiredAt).toISOString()} → ${new Date(detections[total-1]?.acquiredAt).toISOString()})`)

  // ── 3. Clustering-loop ────────────────────────────────────────────────────
  let attached   = 0
  let loose      = 0
  const affectedEvents = new Set<string>()

  for (let i = 0; i < total; i++) {
    const d = detections[i]
    try {
      const eventId = await processDetection(d, cfg)
      if (eventId) {
        attached++
        affectedEvents.add(eventId)
      } else {
        loose++
      }
    } catch (err) {
      console.error(`\n[replay] processDetection mislukt voor detectie ${d.id}:`, err)
    }

    if ((i + 1) % 100 === 0 || i === total - 1) {
      const pct = Math.round(((i + 1) / total) * 100)
      process.stdout.write(
        `\r[replay] ${i + 1}/${total} (${pct}%)  events: ${affectedEvents.size}  gehecht: ${attached}  los: ${loose}   `,
      )
    }
  }
  console.log()

  // ── 4. Herbereken alle events ─────────────────────────────────────────────
  const eventIds = [...affectedEvents]
  console.log(`[replay] herbereken ${eventIds.length} events…`)
  for (let i = 0; i < eventIds.length; i++) {
    try {
      await recalculateEvent(eventIds[i])
    } catch (err) {
      console.error(`\n[replay] recalculateEvent mislukt voor event ${eventIds[i]}:`, err)
    }
    if ((i + 1) % 10 === 0 || i === eventIds.length - 1) {
      process.stdout.write(`\r[replay] herberekend: ${i + 1}/${eventIds.length}   `)
    }
  }
  console.log()

  // ── 5. Statusmachine ──────────────────────────────────────────────────────
  const lastAcquiredAt = detections[total - 1].acquiredAt
  console.log(`[replay] statusmachine uitvoeren (now = ${lastAcquiredAt.toISOString()})…`)
  await runStatusMachine(lastAcquiredAt, cfg)

  // ── 6. Samenvatting ───────────────────────────────────────────────────────
  type EventSummary = {
    id:             string
    name:           string | null
    status:         string
    severity:       number
    est_area_ha:    number | null
    detection_count: number
    first_seen:     Date
    last_seen:      Date
    country_code:   string | null
  }

  const events = await prisma.$queryRaw<EventSummary[]>`
    SELECT
      id, name, status, severity,
      "estAreaHa"      AS est_area_ha,
      "detectionCount" AS detection_count,
      "firstSeen"      AS first_seen,
      "lastSeen"       AS last_seen,
      "countryCode"    AS country_code
    FROM "FireEvent"
    ORDER BY severity DESC, "detectionCount" DESC
  `

  const byStatus = events.reduce<Record<string, number>>((acc, e) => {
    acc[e.status] = (acc[e.status] ?? 0) + 1
    return acc
  }, {})

  const elapsed = ((Date.now() - startTime) / 1000).toFixed(1)

  console.log()
  console.log('═'.repeat(60))
  console.log(`[replay] klaar in ${elapsed}s`)
  console.log(`[replay] ${total} detecties verwerkt`)
  console.log(`[replay] gehecht: ${attached}  los: ${loose}  (${Math.round(attached/total*100)}%)`)
  console.log(`[replay] events: ${events.length} totaal`)
  Object.entries(byStatus)
    .sort(([a], [b]) => a.localeCompare(b))
    .forEach(([status, count]) => console.log(`           ${status.padEnd(10)} ${count}`))
  console.log()
  console.log(`[replay] Top ${Math.min(10, events.length)} events (op severity):`)

  events.slice(0, 10).forEach((e, i) => {
    const duur = fmtDuration(e.last_seen.getTime() - e.first_seen.getTime())
    const area = fmtHa(e.est_area_ha)
    const naam = e.name ?? '(onbekend)'
    console.log(
      `  #${String(i+1).padStart(2)}  ${naam.padEnd(40)}` +
      `  ${e.country_code ?? '--'}  sev=${String(e.severity).padStart(3)}` +
      `  ${area.padStart(10)}  duur=${duur}  det=${e.detection_count}`,
    )
  })
  console.log('═'.repeat(60))
}

main()
  .catch((err) => { console.error('[replay] fatal:', err); process.exit(1) })
  .finally(() => prisma.$disconnect())
