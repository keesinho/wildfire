/**
 * EFFIS FWI-ingest: Fire Weather Index-klasse per 0,25°-cel, vandaag + forecast.
 *
 * EFFIS heeft geen bruikbare data-API: alle FWI-lagen hebben queryable="0"
 * (GetFeatureInfo werkt niet) en WCS is niet geconfigureerd (bevestigd via
 * live requests). Wat wél werkt: een WMS GetMap in image/png — maar dat
 * levert een gestileerde afbeelding, geen ruwe waarden.
 *
 * Twee EFFIS-hosts/lagen zijn getest; niet allebei hebben actuele data:
 *   - ies-ows.jrc.ec.europa.eu/effis, laag "ecmwf007.fwi" → lijkt bevroren
 *     op 2021-01-01 (elke andere datum, ook vandaag, geeft een lege/witte
 *     afbeelding — bevestigd met live requests).
 *   - maps.effis.emergency.copernicus.eu/effis, laag "mf010.fwi" → heeft wél
 *     live data voor vandaag t/m +3 dagen (daarna leeg — de forecast-horizon
 *     is in de praktijk ~4 dagen, niet de "meerdaagse" periode uit PLAN.md).
 *     Dit is de host/laag die we gebruiken.
 *
 * Oplossing voor de ontbrekende puntwaarden: de legende (GetLegendGraphic,
 * laag mf010.fwi, stijl "default") bestaat uit precies 6 effen kleurvlakken
 * die 1-op-1 overeenkomen met de 6 EFFIS-gevarenklassen. We renderen de
 * kaart op exact 0,25°/pixel (zelfde raster als
 * DangerReading.cellLat/cellLon), classificeren elke pixel op
 * dichtstbijzijnde legendakleur en slaan de klasse op. fwiValue blijft
 * null — we hebben alleen de klasse, geen continue waarde (bewuste keuze,
 * geen omissie).
 *
 * Gebruik:
 *   pnpm --filter worker danger
 *   pnpm --filter worker danger -- --bbox "-10,36,10,48" --days 4
 */
import 'dotenv/config'
import { randomUUID } from 'node:crypto'
import { PNG } from 'pngjs'
import { prisma, Prisma } from '@wildfire/db'

const WMS_BASE  = 'https://maps.effis.emergency.copernicus.eu/effis'
const LAYER     = 'mf010.fwi'
const CELL_DEG  = 0.25

// Vastgesteld door de legende (GetLegendGraphic) handmatig te decoderen —
// 6 effen kleurvlakken, top→bottom van laag naar hoog risico. Specifiek
// voor de mf010.fwi-stijl; ecmwf007.fwi gebruikt net iets andere tinten.
const LEGEND: { rgb: [number, number, number]; cls: string }[] = [
  { rgb: [156, 255, 192], cls: 'very_low' },
  { rgb: [205, 226, 78],  cls: 'low' },
  { rgb: [230, 172, 0],   cls: 'moderate' },
  { rgb: [217, 112, 16],  cls: 'high' },
  { rgb: [173, 6, 14],    cls: 'very_high' },
  { rgb: [58, 0, 21],     cls: 'extreme' },
]

// ------------------------------------------------------------------ config

function getParam(envKey: string, cliFlag: string, fallback: string): string {
  const idx = process.argv.indexOf(`--${cliFlag}`)
  if (idx !== -1 && process.argv[idx + 1]) return process.argv[idx + 1]
  return process.env[envKey] ?? fallback
}

function isoDateOffset(offsetDays: number): string {
  const d = new Date()
  d.setUTCDate(d.getUTCDate() + offsetDays)
  return d.toISOString().slice(0, 10)
}

// ------------------------------------------------------------------ classificatie

/** Grijs/wit-drempel: alle 6 legendakleuren hebben een kanaalspreiding > 50. */
function isNoData(r: number, g: number, b: number): boolean {
  return Math.max(r, g, b) - Math.min(r, g, b) < 20
}

function nearestClass(r: number, g: number, b: number): string {
  let best = LEGEND[0]
  let bestDist = Infinity
  for (const entry of LEGEND) {
    const [lr, lg, lb] = entry.rgb
    const dist = (r - lr) ** 2 + (g - lg) ** 2 + (b - lb) ** 2
    if (dist < bestDist) { bestDist = dist; best = entry }
  }
  return best.cls
}

// ------------------------------------------------------------------ fetch + classify

interface CellReading { cellLat: number; cellLon: number; fwiClass: string }

async function fetchDayGrid(
  bbox: [number, number, number, number], // W,S,E,N
  date: string,
): Promise<CellReading[]> {
  const [w, s, e, n] = bbox
  const width  = Math.round((e - w) / CELL_DEG)
  const height = Math.round((n - s) / CELL_DEG)

  const url = `${WMS_BASE}?LAYERS=${LAYER}&FORMAT=image/png&TRANSPARENT=false&SINGLETILE=false` +
    `&SERVICE=wms&VERSION=1.1.1&REQUEST=GetMap&STYLES=&SRS=EPSG:4326` +
    `&BBOX=${w},${s},${e},${n}&WIDTH=${width}&HEIGHT=${height}&TIME=${date}`

  const res = await fetch(url)
  if (!res.ok) throw new Error(`EFFIS WMS → HTTP ${res.status}`)

  const buf = Buffer.from(await res.arrayBuffer())
  if (buf.slice(0, 8).toString('ascii').includes('<?xml')) {
    throw new Error(`EFFIS WMS → ServiceException: ${buf.toString('utf8').slice(0, 300)}`)
  }

  const png = PNG.sync.read(buf)
  const readings: CellReading[] = []
  const counts: Record<string, number> = Object.fromEntries(LEGEND.map(l => [l.cls, 0]))
  let noData = 0

  for (let y = 0; y < png.height; y++) {
    for (let x = 0; x < png.width; x++) {
      const idx = (png.width * y + x) << 2
      const r = png.data[idx]
      const g = png.data[idx + 1]
      const b = png.data[idx + 2]

      if (isNoData(r, g, b)) { noData++; continue }

      const cls = nearestClass(r, g, b)
      counts[cls]++

      const lon = w + (x + 0.5) * (e - w) / width
      const lat = n - (y + 0.5) * (n - s) / height
      readings.push({
        cellLat: Math.round(lat / CELL_DEG) * CELL_DEG,
        cellLon: Math.round(lon / CELL_DEG) * CELL_DEG,
        fwiClass: cls,
      })
    }
  }

  // ── Sanity guard ──────────────────────────────────────────────────────
  // Enige manier om een gewijzigd legendaschema (EFFIS-zijde) te merken:
  // als er niets geclassificeerd wordt, of één klasse domineert onnatuurlijk,
  // klopt de kleur→klasse-mapping vermoedelijk niet meer.
  const classified = readings.length
  console.log(
    `[danger]   ${date}  classified=${classified}  noData=${noData}  ` +
    LEGEND.map(l => `${l.cls}=${counts[l.cls]}`).join(' '),
  )

  if (classified === 0) {
    throw new Error(`${date}: 0 pixels geclassificeerd — legendakleuren waarschijnlijk gewijzigd`)
  }
  const dominant = Math.max(...Object.values(counts)) / classified
  if (dominant > 0.95) {
    throw new Error(`${date}: >95% van de pixels in één klasse — controleer de legenda-kleuren`)
  }

  return readings
}

async function upsertReadings(readings: CellReading[], date: string): Promise<void> {
  for (let i = 0; i < readings.length; i += 500) {
    const chunk = readings.slice(i, i + 500)
    const values = Prisma.join(
      chunk.map(r => Prisma.sql`(${randomUUID()}, ${r.cellLat}, ${r.cellLon}, ${date}::date, ${r.fwiClass})`),
    )
    await prisma.$executeRaw`
      INSERT INTO "DangerReading" (id, "cellLat", "cellLon", date, "fwiClass", "fetchedAt")
      SELECT v.id, v."cellLat", v."cellLon", v.date, v."fwiClass", NOW()
      FROM (VALUES ${values}) AS v(id, "cellLat", "cellLon", date, "fwiClass")
      ON CONFLICT ("cellLat", "cellLon", date) DO UPDATE SET
        "fwiClass"  = EXCLUDED."fwiClass",
        "fetchedAt" = NOW()
    `
  }
}

// ------------------------------------------------------------------ main

async function main() {
  const bboxStr = getParam('EFFIS_BBOX', 'bbox', '-10,36,10,48')
  const days    = Math.max(1, parseInt(getParam('EFFIS_DAYS', 'days', '4'), 10))
  const bbox    = bboxStr.split(',').map(Number) as [number, number, number, number]

  console.log(`[danger] start  bbox=${bboxStr}  days=${days}`)

  let totalCells = 0
  for (let offset = 0; offset < days; offset++) {
    const date     = isoDateOffset(offset)
    const readings = await fetchDayGrid(bbox, date)
    await upsertReadings(readings, date)
    totalCells += readings.length
  }

  console.log(`[danger] klaar — ${totalCells} cel-dag-waarden opgeslagen over ${days} dagen`)
}

main()
  .catch((err) => { console.error('[danger] fatal:', err); process.exit(1) })
  .finally(() => prisma.$disconnect())
