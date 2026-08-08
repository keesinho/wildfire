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
 * Attributie (PLAN.md §8): de Atom-entry bevat geen CAP-zender, dus voor elke
 * entry die we bewaren (na de fire/temperature-filter) halen we het volledige
 * CAP-document op via de "application/cap+xml"-link om senderName (nationale
 * weerdienst) te lezen — één extra fetch per opgeslagen warning, niet per
 * feed-entry.
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
  'cap:sent'?:      string
  'cap:expires'?:   string
  'cap:severity'?:  string
  'cap:identifier'?: string
  title?:           string
  link?:            { type?: string; href?: string }[] | { type?: string; href?: string }
}

interface RawCapInfo {
  language?:   string
  senderName?: string
}

interface RawCapAlert {
  sender?: string
  info?:   RawCapInfo[] | RawCapInfo
}

/**
 * Haalt de nationale weerdienst op uit de volledige CAP-XML van één warning
 * (senderName staat niet in de Atom-entry zelf, alleen in het CAP-document
 * waarnaar de entry linkt) — verplicht te tonen bij één-land-info
 * (MeteoAlarm CC BY 4.0, PLAN.md §8).
 */
async function fetchSenderName(entry: RawEntry): Promise<string | null> {
  const links = Array.isArray(entry.link) ? entry.link : entry.link ? [entry.link] : []
  const capUrl = links.find(l => l.type === 'application/cap+xml')?.href
  if (!capUrl) return null

  try {
    const res = await fetch(capUrl)
    if (!res.ok) return null
    const alert: RawCapAlert | undefined = parser.parse(await res.text())?.alert
    if (!alert) return null

    const infos = Array.isArray(alert.info) ? alert.info : alert.info ? [alert.info] : []
    const info = infos.find(i => i.language?.startsWith('en')) ?? infos[0]
    return info?.senderName ?? alert.sender ?? null
  } catch (err) {
    console.error('[warnings]   senderName-fetch mislukt:', (err as Error)?.message ?? err)
    return null
  }
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

    // Tijdstip van uitgifte: cap:sent, met onset als terugval als sent ontbreekt/ongeldig is
    // (verplicht te tonen, PLAN.md §8).
    const sent = entry['cap:sent'] ? new Date(entry['cap:sent']) : null
    const issuedAt = sent && !isNaN(sent.getTime()) ? sent : onset

    const senderName = await fetchSenderName(entry)

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
        issuedAt,
        senderName,
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
        issuedAt,
        senderName,
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
