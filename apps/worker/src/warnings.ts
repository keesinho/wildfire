/**
 * MeteoAlarm-ingest: officiële waarschuwingen per land (CAP/Atom-feeds).
 *
 * Bron: https://feeds.meteoalarm.org/feeds/meteoalarm-legacy-atom-<land>
 * (de oude RSS-feeds zijn dood; Atom is de actief onderhouden vervanger).
 *
 * We houden alleen entries aan waarvan <cap:event> op "fire" of "temperature"
 * duidt — de twee awareness-types die relevant zijn voor brandrisico
 * (PLAN.md §1). Andere types (storm, regen, wind, sneeuw, ...) worden
 * genegeerd.
 *
 * Regiokoppeling: <cap:geocode> is NIET consistent NUTS3 — Frankrijk
 * publiceert echte NUTS3-codes, maar Spanje/Portugal/Duitsland/Polen/Servië
 * publiceren een eigen "EMMA_ID" die vaak (niet gegarandeerd) gelijk is aan
 * de NUTS3-code. We proberen een directe match op Region.code; lukt dat
 * niet, dan blijft regionId leeg maar staat de ruwe geocode in `raw` zodat
 * een latere EMMA→NUTS-mappingtabel zonder herfetch gebouwd kan worden.
 * `/api/risk` vangt de non-match op met een land-brede fallback.
 *
 * Gebruik:
 *   pnpm --filter worker warnings
 */
import 'dotenv/config'
import { XMLParser } from 'fast-xml-parser'
import { prisma } from '@wildfire/db'

// ------------------------------------------------------------------ landen

const COUNTRIES: { slug: string; iso2: string }[] = [
  { slug: 'andorra',                      iso2: 'AD' },
  { slug: 'austria',                      iso2: 'AT' },
  { slug: 'belgium',                      iso2: 'BE' },
  { slug: 'bosnia-herzegovina',           iso2: 'BA' },
  { slug: 'bulgaria',                     iso2: 'BG' },
  { slug: 'croatia',                      iso2: 'HR' },
  { slug: 'cyprus',                       iso2: 'CY' },
  { slug: 'czechia',                      iso2: 'CZ' },
  { slug: 'denmark',                      iso2: 'DK' },
  { slug: 'estonia',                      iso2: 'EE' },
  { slug: 'finland',                      iso2: 'FI' },
  { slug: 'france',                       iso2: 'FR' },
  { slug: 'germany',                      iso2: 'DE' },
  { slug: 'greece',                       iso2: 'GR' },
  { slug: 'hungary',                      iso2: 'HU' },
  { slug: 'iceland',                      iso2: 'IS' },
  { slug: 'ireland',                      iso2: 'IE' },
  { slug: 'israel',                       iso2: 'IL' },
  { slug: 'italy',                        iso2: 'IT' },
  { slug: 'latvia',                       iso2: 'LV' },
  { slug: 'lithuania',                    iso2: 'LT' },
  { slug: 'luxembourg',                   iso2: 'LU' },
  { slug: 'malta',                        iso2: 'MT' },
  { slug: 'moldova',                      iso2: 'MD' },
  { slug: 'montenegro',                   iso2: 'ME' },
  { slug: 'netherlands',                  iso2: 'NL' },
  { slug: 'norway',                       iso2: 'NO' },
  { slug: 'poland',                       iso2: 'PL' },
  { slug: 'portugal',                     iso2: 'PT' },
  { slug: 'republic-of-north-macedonia',  iso2: 'MK' },
  { slug: 'romania',                      iso2: 'RO' },
  { slug: 'serbia',                       iso2: 'RS' },
  { slug: 'slovakia',                     iso2: 'SK' },
  { slug: 'slovenia',                     iso2: 'SI' },
  { slug: 'spain',                        iso2: 'ES' },
  { slug: 'sweden',                       iso2: 'SE' },
  { slug: 'switzerland',                  iso2: 'CH' },
  { slug: 'ukraine',                      iso2: 'UA' },
  { slug: 'united-kingdom',               iso2: 'GB' },
]

const FEED_BASE   = 'https://feeds.meteoalarm.org/feeds/meteoalarm-legacy-atom'
const CONCURRENCY = 5

// ------------------------------------------------------------------ parsing

const parser = new XMLParser({ ignoreAttributes: false, attributeNamePrefix: '' })

interface RawEntry {
  'cap:geocode'?:   { valueName?: string; value?: string }
  'cap:areaDesc'?:  string
  'cap:event'?:     string
  'cap:onset'?:     string
  'cap:expires'?:   string
  'cap:severity'?:  string
  'cap:identifier'?: string
  title?:           string
}

type AwarenessType = 'forest_fire' | 'extreme_temp'

function classifyEvent(event: string | undefined): AwarenessType | null {
  if (!event) return null
  if (/fire/i.test(event))        return 'forest_fire'
  if (/temperature/i.test(event)) return 'extreme_temp'
  return null
}

function levelFromTitle(title: string | undefined): 'YELLOW' | 'ORANGE' | 'RED' | null {
  const word = title?.trim().split(/\s+/)[0]?.toLowerCase()
  if (word === 'yellow') return 'YELLOW'
  if (word === 'orange') return 'ORANGE'
  if (word === 'red')    return 'RED'
  return null
}

async function fetchCountryWarnings(iso2: string, slug: string): Promise<number> {
  const url = `${FEED_BASE}-${slug}`
  const res = await fetch(url)
  if (!res.ok) throw new Error(`HTTP ${res.status}`)

  const xml  = await res.text()
  const feed = parser.parse(xml)?.feed
  if (!feed) return 0

  const entries: RawEntry[] = Array.isArray(feed.entry) ? feed.entry : feed.entry ? [feed.entry] : []
  let stored = 0

  for (const entry of entries) {
    const awarenessType = classifyEvent(entry['cap:event'])
    if (!awarenessType) continue

    const level = levelFromTitle(entry.title)
    if (!level) continue

    const identifier = entry['cap:identifier']
    const geocode     = entry['cap:geocode']
    const geocodeValue = geocode?.value
    if (!identifier || !geocodeValue) continue

    const onset   = entry['cap:onset']   ? new Date(entry['cap:onset'])   : null
    const expires = entry['cap:expires'] ? new Date(entry['cap:expires']) : null
    if (!onset || !expires || isNaN(onset.getTime()) || isNaN(expires.getTime())) continue

    const regionRows = await prisma.$queryRaw<{ id: string }[]>`
      SELECT id FROM "Region" WHERE code = ${geocodeValue} ORDER BY level DESC LIMIT 1
    `
    const regionId = regionRows[0]?.id ?? null

    await prisma.warning.upsert({
      where:  { externalId: `${identifier}:${geocodeValue}` },
      create: {
        externalId:    `${identifier}:${geocodeValue}`,
        countryCode:   iso2,
        awarenessType,
        level,
        onset,
        expires,
        headline:      entry.title ?? null,
        regionId,
        raw: {
          geocodeValueName: geocode?.valueName ?? null,
          geocodeValue,
          areaDesc: entry['cap:areaDesc'] ?? null,
          event:    entry['cap:event']    ?? null,
          severity: entry['cap:severity'] ?? null,
        },
      },
      update: {
        level,
        onset,
        expires,
        headline: entry.title ?? null,
        regionId,
        fetchedAt: new Date(),
      },
    })
    stored++
  }

  return stored
}

// ------------------------------------------------------------------ main

async function main() {
  console.log(`[warnings] start — ${COUNTRIES.length} landen`)

  const deleted = await prisma.warning.deleteMany({
    where: { expires: { lt: new Date(Date.now() - 30 * 24 * 3_600_000) } },
  })
  console.log(`[warnings] opgeruimd (>30d verlopen): ${deleted.count}`)

  let totalStored = 0
  let totalFailed = 0

  for (let i = 0; i < COUNTRIES.length; i += CONCURRENCY) {
    const batch = COUNTRIES.slice(i, i + CONCURRENCY)
    const results = await Promise.allSettled(
      batch.map(c => fetchCountryWarnings(c.iso2, c.slug)),
    )

    results.forEach((r, idx) => {
      const country = batch[idx]
      if (r.status === 'fulfilled') {
        totalStored += r.value
      } else {
        totalFailed++
        console.error(`[warnings]   ${country.slug} mislukt:`, r.reason?.message ?? r.reason)
      }
    })
  }

  console.log(`[warnings] klaar — opgeslagen/bijgewerkt: ${totalStored}  landen mislukt: ${totalFailed}/${COUNTRIES.length}`)
}

main()
  .catch((err) => { console.error('[warnings] fatal:', err); process.exit(1) })
  .finally(() => prisma.$disconnect())
