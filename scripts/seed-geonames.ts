/**
 * Laad Europese plaatsen uit GeoNames cities500 in de Place-tabel.
 * Bron: GeoNames — CC-BY, vermelding verplicht in colofon/docs.
 *
 * Gebruik: pnpm seed:geonames
 */
import 'dotenv/config'
import { createWriteStream, createReadStream } from 'node:fs'
import { mkdir, rm } from 'node:fs/promises'
import { createInterface } from 'node:readline'
import { pipeline } from 'node:stream/promises'
import * as path from 'node:path'
import * as os from 'node:os'
import unzipper from 'unzipper'
import { prisma } from '@wildfire/db'

const GEONAMES_URL = 'https://download.geonames.org/export/dump/cities500.zip'

// Europese ISO 3166-1 alpha-2 landcodes
const EUROPE = new Set([
  'AL', 'AD', 'AT', 'BY', 'BE', 'BA', 'BG', 'HR', 'CY', 'CZ',
  'DK', 'EE', 'FI', 'FR', 'DE', 'GR', 'HU', 'IS', 'IE', 'IT',
  'XK', 'LV', 'LI', 'LT', 'LU', 'MT', 'MD', 'MC', 'ME', 'NL',
  'MK', 'NO', 'PL', 'PT', 'RO', 'SM', 'RS', 'SK', 'SI', 'ES',
  'SE', 'CH', 'TR', 'UA', 'GB', 'VA',
])

async function download(url: string, dest: string) {
  console.log('[geonames] cities500.zip downloaden…')
  const res = await fetch(url)
  if (!res.ok) throw new Error(`HTTP ${res.status}`)
  if (!res.body) throw new Error('Lege response body')
  await pipeline(res.body as unknown as NodeJS.ReadableStream, createWriteStream(dest))
  console.log('[geonames] download klaar')
}

async function extract(zipPath: string, outDir: string): Promise<string> {
  const txtPath = path.join(outDir, 'cities500.txt')
  console.log('[geonames] uitpakken…')

  await new Promise<void>((resolve, reject) => {
    createReadStream(zipPath)
      .pipe(unzipper.Parse())
      .on('entry', (entry: unzipper.Entry) => {
        if (entry.path === 'cities500.txt') {
          entry
            .pipe(createWriteStream(txtPath))
            .on('finish', resolve)
            .on('error', reject)
        } else {
          entry.autodrain()
        }
      })
      .on('error', reject)
  })

  return txtPath
}

async function main() {
  const tmpDir = path.join(os.tmpdir(), 'wildfire-geonames')
  await mkdir(tmpDir, { recursive: true })
  const zipPath = path.join(tmpDir, 'cities500.zip')

  try {
    await download(GEONAMES_URL, zipPath)
    const txtPath = await extract(zipPath, tmpDir)

    console.log('[geonames] parsen en upserting (alleen Europa)…')
    const rl = createInterface({ input: createReadStream(txtPath), crlfDelay: Infinity })

    // GeoNames TSV-kolommen (cities500):
    // 0:geonameid  1:name  2:asciiname  3:alternatenames
    // 4:latitude   5:longitude  6:feature_class  7:feature_code
    // 8:country_code  9:cc2  10:admin1_code  11:admin2_code
    // 12:admin3  13:admin4  14:population  15:elevation
    // 16:dem  17:timezone  18:modification_date

    type UpsertArg = Parameters<typeof prisma.place.upsert>[0]
    const batch: UpsertArg[] = []
    let count = 0
    let skipped = 0

    const flush = async () => {
      if (batch.length === 0) return
      await Promise.all(batch.map((args) => prisma.place.upsert(args)))
      count += batch.length
      batch.length = 0
      process.stdout.write(`\r[geonames] ${count} plaatsen upserted…`)
    }

    for await (const line of rl) {
      if (!line.trim()) continue
      const cols = line.split('\t')
      const countryCode = cols[8]

      if (!EUROPE.has(countryCode)) { skipped++; continue }

      batch.push({
        where:  { id: cols[0] },
        update: {
          name: cols[1],
          lat:  parseFloat(cols[4]),
          lon:  parseFloat(cols[5]),
          population: parseInt(cols[14], 10) || 0,
          countryCode,
          admin1: cols[10] || null,
        },
        create: {
          id:   cols[0],
          name: cols[1],
          lat:  parseFloat(cols[4]),
          lon:  parseFloat(cols[5]),
          population: parseInt(cols[14], 10) || 0,
          countryCode,
          admin1: cols[10] || null,
        },
      })

      if (batch.length >= 500) await flush()
    }

    await flush()
    console.log(`\n[geonames] klaar — ${count} Europese plaatsen, ${skipped} overgeslagen`)
  } finally {
    await rm(tmpDir, { recursive: true, force: true })
  }
}

main()
  .catch((err) => { console.error('[geonames] fout:', err); process.exit(1) })
  .finally(() => prisma.$disconnect())
