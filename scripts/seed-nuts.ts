/**
 * Laad NUTS-regiogrenzen (level 0–3) in de Region-tabel.
 * Bron: Eurostat GISCO — vrij te gebruiken met bronvermelding.
 *
 * Gebruik: pnpm seed:nuts
 */
import 'dotenv/config'
import { prisma } from '@wildfire/db'

const GISCO_BASE = 'https://gisco-services.ec.europa.eu/distribution/v2/nuts/geojson'
const LEVELS = [0, 1, 2, 3] as const

interface NutsProperties {
  NUTS_ID: string
  NUTS_NAME: string
  CNTR_CODE: string
  LEVL_CODE: number
}

interface NutsFeature {
  type: 'Feature'
  geometry: object
  properties: NutsProperties
}

interface NutsCollection {
  type: 'FeatureCollection'
  features: NutsFeature[]
}

async function fetchLevel(level: number): Promise<NutsFeature[]> {
  const url = `${GISCO_BASE}/NUTS_RG_01M_2021_4326_LEVL_${level}.geojson`
  console.log(`[nuts] downloading level ${level}…`)
  const res = await fetch(url)
  if (!res.ok) throw new Error(`HTTP ${res.status} voor ${url}`)
  const data = await res.json() as NutsCollection
  return data.features
}

async function main() {
  let total = 0

  for (const level of LEVELS) {
    const features = await fetchLevel(level)
    console.log(`[nuts] level ${level}: ${features.length} features — upserting…`)

    for (let i = 0; i < features.length; i += 50) {
      const chunk = features.slice(i, i + 50)

      await Promise.all(chunk.map((f) => {
        const { NUTS_ID, NUTS_NAME, CNTR_CODE, LEVL_CODE } = f.properties
        const id = `nuts_${NUTS_ID}`
        return prisma.$queryRaw`
          INSERT INTO "Region" (id, code, name, "countryCode", level, geom)
          VALUES (
            ${id},
            ${NUTS_ID},
            ${NUTS_NAME},
            ${CNTR_CODE},
            ${LEVL_CODE},
            ST_GeomFromGeoJSON(${JSON.stringify(f.geometry)})
          )
          ON CONFLICT (code) DO UPDATE SET
            name          = EXCLUDED.name,
            "countryCode" = EXCLUDED."countryCode",
            level         = EXCLUDED.level,
            geom          = EXCLUDED.geom
        `
      }))

      total += chunk.length
      process.stdout.write(`\r[nuts] ${total} regio's upserted…`)
    }

    console.log()
  }

  console.log(`[nuts] klaar — ${total} regio's totaal`)
}

main()
  .catch((err) => { console.error('[nuts] fout:', err); process.exit(1) })
  .finally(() => prisma.$disconnect())
