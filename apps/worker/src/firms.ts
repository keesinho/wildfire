import type { Confidence, HotspotSource } from '@wildfire/db'

const FIRMS_BASE = 'https://firms.modaps.eosdis.nasa.gov/api/area/csv'

export const SOURCES = [
  { apiName: 'VIIRS_SNPP_NRT',   enumVal: 'VIIRS_SNPP'   as HotspotSource },
  { apiName: 'VIIRS_NOAA20_NRT', enumVal: 'VIIRS_NOAA20' as HotspotSource },
  { apiName: 'VIIRS_NOAA21_NRT', enumVal: 'VIIRS_NOAA21' as HotspotSource },
  { apiName: 'MODIS_NRT',        enumVal: 'MODIS'         as HotspotSource },
]

export type FirmsSource = typeof SOURCES[number]

export interface DetectionInput {
  source:       HotspotSource
  lat:          number
  lon:          number
  acquiredAt:   Date
  confidence:   Confidence
  frp:          number | null
  brightness:   number | null
  daynight:     string | null
  filtered:     boolean
  filterReason: string | null
}

// ------------------------------------------------------------------ helpers

function parseVirsConf(raw: string): Confidence {
  if (raw === 'l') return 'LOW'
  if (raw === 'h') return 'HIGH'
  return 'NOMINAL'
}

function parseModisConf(raw: string): Confidence {
  const n = parseInt(raw, 10)
  if (isNaN(n)) return 'NOMINAL'
  if (n < 30)  return 'LOW'
  if (n > 80)  return 'HIGH'
  return 'NOMINAL'
}

function parseFloat_(s: string): number | null {
  if (!s || s === '') return null
  const n = parseFloat(s)
  return isNaN(n) ? null : n
}

/** acq_date "2026-07-31" + acq_time "0148" → UTC Date */
function parseAcquiredAt(date: string, time: string): Date {
  const t = time.padStart(4, '0')
  return new Date(`${date}T${t.slice(0, 2)}:${t.slice(2, 4)}:00Z`)
}

// ------------------------------------------------------------------ fetch

/**
 * Fetch een enkele FIRMS-bron en retourneer geparseerde detecties.
 *
 * @param mapKey   NASA FIRMS MAP_KEY
 * @param source   één van SOURCES
 * @param bbox     "W,S,E,N"  bijv. "-10,36,10,48"
 * @param days     1–10 (FIRMS-maximum)
 */
export async function fetchFirms(
  mapKey: string,
  source: FirmsSource,
  bbox: string,
  days: number,
): Promise<DetectionInput[]> {
  const url = `${FIRMS_BASE}/${mapKey}/${source.apiName}/${bbox}/${days}`
  const res = await fetch(url)

  if (!res.ok) {
    throw new Error(`FIRMS ${source.apiName} → HTTP ${res.status}: ${await res.text()}`)
  }

  const text = await res.text()

  // FIRMS stuurt soms een HTML-foutpagina terug
  if (text.trimStart().startsWith('<')) {
    throw new Error(`FIRMS ${source.apiName} → onverwachte HTML-response`)
  }

  const lines = text.trim().split('\n')
  if (lines.length < 2) return []   // enkel header of leeg

  const headers = lines[0].split(',').map(h => h.trim())
  const isModis = source.apiName.startsWith('MODIS')

  const detections: DetectionInput[] = []

  for (let i = 1; i < lines.length; i++) {
    const cols = lines[i].split(',')
    if (cols.length < headers.length) continue

    const row: Record<string, string> = {}
    headers.forEach((h, idx) => { row[h] = (cols[idx] ?? '').trim() })

    // Alleen vegetatiebranden (type 0).
    // De type-kolom is alleen aanwezig in MODIS; VIIRS NRT heeft hem niet.
    // Als de kolom ontbreekt, gaan we ervan uit dat het een vegetatiebrand is.
    const rowType = row['type']
    if (rowType !== undefined && rowType !== '' && rowType !== '0') continue

    const lat = parseFloat_(row['latitude'])
    const lon = parseFloat_(row['longitude'])
    if (lat === null || lon === null) continue

    const acquiredAt = parseAcquiredAt(row['acq_date'], row['acq_time'])
    const confidence = isModis
      ? parseModisConf(row['confidence'])
      : parseVirsConf(row['confidence'])

    const frp        = parseFloat_(row['frp'])
    const brightness = parseFloat_(isModis ? row['brightness'] : row['bright_ti4'])
    const daynight   = row['daynight'] || null

    detections.push({
      source:       source.enumVal,
      lat,
      lon,
      acquiredAt,
      confidence,
      frp,
      brightness,
      daynight,
      filtered:     false,
      filterReason: null,
    })
  }

  return detections
}
