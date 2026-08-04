/**
 * Seed bekende industriële warmtebronnen in StaticHeatSource.
 * Idempotent: upsert op (lat, lon, type).
 *
 *   pnpm seed:heat-sources
 */
import 'dotenv/config'
import { prisma } from '@wildfire/db'

const SOURCES = [
  // Industriehaven / raffinaderijen
  { lat: 43.44, lon:  4.89, type: 'industrial', note: 'Fos-sur-Mer — raffinaderij/haven (FR)' },
  { lat: 45.15, lon:  9.94, type: 'industrial', note: 'Spinadesco — industrie Po-vallei (IT)' },
  { lat: 39.08, lon:  9.02, type: 'industrial', note: 'Sarroch — raffinaderij Cagliari (IT)' },
  { lat: 40.24, lon: -3.47, type: 'industrial', note: 'Morata de Tajuña — industrie Madrid (ES)' },
  { lat: 37.57, lon: -0.91, type: 'industrial', note: 'La Unión — metaalverwerking Murcia (ES)' },
  { lat: 43.54, lon: -5.83, type: 'industrial', note: 'Corvera de Asturias — industrie Avilés (ES)' },
  { lat: 43.53, lon: -5.73, type: 'industrial', note: 'Natahoyo — staalwerk Gijón (ES)' },
  { lat: 38.92, lon: -9.01, type: 'industrial', note: 'Alhandra — cement/industrie bij Lissabon (PT)' },
  { lat: 47.17, lon:  7.56, type: 'industrial', note: 'Biberist — industrie Solothurn (CH)' },
] as const

const RADIUS_M = 2000  // 2 km

async function main() {
  console.log(`[seed-heat-sources] ${SOURCES.length} entries, radius ${RADIUS_M} m`)

  let created = 0
  let skipped = 0

  for (const s of SOURCES) {
    const existing = await prisma.staticHeatSource.findFirst({
      where: { lat: s.lat, lon: s.lon, type: s.type },
    })

    if (existing) {
      skipped++
      continue
    }

    await prisma.staticHeatSource.create({
      data: { lat: s.lat, lon: s.lon, radiusM: RADIUS_M, type: s.type, note: s.note },
    })
    created++
    console.log(`  + ${s.note}`)
  }

  console.log(`[seed-heat-sources] klaar — nieuw: ${created}  al aanwezig: ${skipped}`)
}

main()
  .catch((err) => { console.error('[seed-heat-sources] fatal:', err); process.exit(1) })
  .finally(() => prisma.$disconnect())
