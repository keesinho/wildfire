import 'dotenv/config'
import { prisma } from '@wildfire/db'

async function main() {
  console.log('[ingest] connecting to database…')

  const result = await prisma.$queryRaw<[{ postgis_version: string }]>`
    SELECT PostGIS_Version() AS postgis_version
  `
  console.log('[ingest] PostGIS version:', result[0].postgis_version)

  const regionCount = await prisma.region.count()
  const placeCount  = await prisma.place.count()
  console.log(`[ingest] regions: ${regionCount}, places: ${placeCount}`)

  // TODO fase 1: fetchFirms()    — NASA FIRMS VIIRS/MODIS hotspots
  // TODO fase 3: fetchWarnings() — MeteoAlarm CAP-feeds
  // TODO fase 3: fetchDanger()   — EFFIS Fire Weather Index
}

main()
  .catch((err) => { console.error('[ingest] fatal:', err); process.exit(1) })
  .finally(() => prisma.$disconnect())
