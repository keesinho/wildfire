import 'dotenv/config'
import { prisma } from '@wildfire/db'
import { fetchFirms, SOURCES } from './firms.js'
import { filterNewDetections, unfilterLowConfWithNeighbors } from './filter.js'
import { clusterAndRecalculate } from './cluster.js'

// ------------------------------------------------------------------ config

/**
 * Leest een parameter in volgorde van prioriteit:
 *   1. CLI-argument  --<flag> <value>
 *   2. Omgevingsvariabele  <envKey>
 *   3. Ingebouwde standaardwaarde  <fallback>
 */
function getParam(envKey: string, cliFlag: string, fallback: string): string {
  const idx = process.argv.indexOf(`--${cliFlag}`)
  if (idx !== -1 && process.argv[idx + 1]) return process.argv[idx + 1]
  return process.env[envKey] ?? fallback
}

// ------------------------------------------------------------------ main

async function main() {
  const mapKey = process.env.FIRMS_MAP_KEY
  if (!mapKey) throw new Error('FIRMS_MAP_KEY is niet ingesteld')

  // Standaard: Zuidwest-Europa; backfill via --bbox en --days of env vars
  // Voorbeelden:
  //   pnpm --filter worker start -- --bbox "-25,34,45,72" --days 5
  //   FIRMS_BBOX="-25,34,45,72" FIRMS_DAYS=5 pnpm --filter worker start
  const bbox = getParam('FIRMS_BBOX', 'bbox', '-10,36,10,48')
  const days = Math.max(1, parseInt(getParam('FIRMS_DAYS', 'days', '1'), 10))

  console.log(`[ingest] start  bbox=${bbox}  days=${days}`)
  console.log(`[ingest] PostGIS: ${(await prisma.$queryRaw<[{v:string}]>`SELECT PostGIS_Version() v`)[0].v}`)

  let totalNew      = 0
  let totalSkipped  = 0

  for (const source of SOURCES) {
    console.log(`[ingest] → ${source.apiName}…`)

    let detections
    try {
      detections = await fetchFirms(mapKey, source, bbox, days)
    } catch (err) {
      console.error(`[ingest]   ${source.apiName} mislukt:`, err)
      continue
    }

    console.log(`[ingest]   ${detections.length} records geparseerd`)
    if (detections.length === 0) continue

    // Batch-upsert in blokken van 500; skipDuplicates zorgt voor idempotentie
    for (let i = 0; i < detections.length; i += 500) {
      const chunk  = detections.slice(i, i + 500)
      const result = await prisma.detection.createMany({ data: chunk, skipDuplicates: true })
      totalNew     += result.count
      totalSkipped += chunk.length - result.count
    }
  }

  const dbTotal = await prisma.detection.count()
  console.log(`[ingest] klaar — nieuw: ${totalNew}  dupes overgeslagen: ${totalSkipped}  totaal in db: ${dbTotal}`)

  if (totalNew === 0) {
    console.log('[ingest] geen nieuwe detecties — filter/cluster overgeslagen')
    return
  }

  // ── Filter ───────────────────────────────────────────────────────────────
  const unfiltered = await unfilterLowConfWithNeighbors()
  console.log(`[filter] low_conf_isolated ongedaan gemaakt: ${unfiltered}`)

  const { staticHeatFiltered, lowConfFiltered } = await filterNewDetections()
  console.log(`[filter] static_heat_source: ${staticHeatFiltered}  low_conf_isolated: ${lowConfFiltered}`)

  // ── Cluster ──────────────────────────────────────────────────────────────
  const eventCount = await clusterAndRecalculate()
  console.log(`[cluster] gerakte events herberekend: ${eventCount}`)
}

main()
  .catch((err) => { console.error('[ingest] fatal:', err); process.exit(1) })
  .finally(() => prisma.$disconnect())
