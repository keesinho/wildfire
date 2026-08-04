/**
 * Suspects — kandidaat StaticHeatSources
 *
 * Groepeert detecties op afgerond coördinaat (2 decimalen ≈ 1 km raster),
 * toont locaties met detecties op ≥ 3 verschillende UTC-dagen,
 * gesorteerd op aantal dagen (meest hardnekkig eerst).
 *
 * Gebruik:
 *   pnpm --filter worker suspects
 *   pnpm --filter worker suspects -- --min-days 5
 */
import 'dotenv/config'
import { prisma } from '@wildfire/db'

function getArg(flag: string, fallback: number): number {
  const idx = process.argv.indexOf(`--${flag}`)
  if (idx !== -1 && process.argv[idx + 1]) return parseInt(process.argv[idx + 1], 10)
  return fallback
}

type SuspectRow = {
  rlat:      number
  rlon:      number
  day_count: number | bigint
  det_count: number | bigint
  avg_frp:   number | null
  first_day: Date
  last_day:  Date
}

type PlaceRow = { name: string; distance_m: number }

async function main() {
  const minDays = getArg('min-days', 3)

  console.log(`[suspects] min-days=${minDays}`)
  console.log(`[suspects] PostGIS: ${(await prisma.$queryRaw<[{v:string}]>`SELECT PostGIS_Version() v`)[0].v}\n`)

  const suspects = await prisma.$queryRaw<SuspectRow[]>`
    SELECT
      ROUND(lat::numeric, 2)  AS rlat,
      ROUND(lon::numeric, 2)  AS rlon,
      COUNT(DISTINCT DATE("acquiredAt" AT TIME ZONE 'UTC'))::int  AS day_count,
      COUNT(*)::int                                                AS det_count,
      ROUND(AVG(frp)::numeric, 1)                                 AS avg_frp,
      MIN(DATE("acquiredAt" AT TIME ZONE 'UTC'))                   AS first_day,
      MAX(DATE("acquiredAt" AT TIME ZONE 'UTC'))                   AS last_day
    FROM "Detection"
    GROUP BY ROUND(lat::numeric, 2), ROUND(lon::numeric, 2)
    HAVING COUNT(DISTINCT DATE("acquiredAt" AT TIME ZONE 'UTC')) >= ${minDays}
    ORDER BY day_count DESC, det_count DESC
  `

  if (suspects.length === 0) {
    console.log('Geen suspects gevonden.')
    return
  }

  console.log(`${'lat'.padStart(8)}  ${'lon'.padStart(8)}  ${'dagen'.padStart(5)}  ${'dets'.padStart(5)}  ${'avg FRP'.padStart(8)}  ${'eerste'.padStart(10)}  ${'laatste'.padStart(10)}  plaatsnaam`)
  console.log('─'.repeat(100))

  for (const s of suspects) {
    const lat = Number(s.rlat)
    const lon = Number(s.rlon)

    // Dichtstbijzijnde plaatsnaam via kNN-operator
    const places = await prisma.$queryRaw<PlaceRow[]>`
      SELECT
        name,
        ROUND(ST_Distance(
          ST_SetSRID(ST_MakePoint(${lon}, ${lat}), 4326)::geography,
          ST_SetSRID(ST_MakePoint(lon, lat), 4326)::geography
        )::numeric) AS distance_m
      FROM "Place"
      ORDER BY ST_MakePoint(lon, lat) <-> ST_MakePoint(${lon}, ${lat})
      LIMIT 1
    `
    const place     = places[0]
    const placeStr  = place ? `${place.name} (${(place.distance_m / 1000).toFixed(1)} km)` : '—'

    const frpStr    = s.avg_frp != null ? `${s.avg_frp} MW` : '    —   '
    const firstStr  = new Date(s.first_day).toISOString().slice(0, 10)
    const lastStr   = new Date(s.last_day).toISOString().slice(0, 10)

    console.log(
      `${lat.toFixed(2).padStart(8)}  ${lon.toFixed(2).padStart(8)}  ` +
      `${String(Number(s.day_count)).padStart(5)}  ${String(Number(s.det_count)).padStart(5)}  ` +
      `${frpStr.padStart(8)}  ${firstStr}  ${lastStr}  ${placeStr}`,
    )
  }

  console.log(`\n${suspects.length} suspect(s) gevonden.`)
}

main()
  .catch((err) => { console.error('[suspects] fatal:', err); process.exit(1) })
  .finally(() => prisma.$disconnect())
