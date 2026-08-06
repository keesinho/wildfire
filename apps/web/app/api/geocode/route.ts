import { jsonOk, jsonError } from '@/lib/apiAuth'

export const dynamic = 'force-dynamic'

const NOMINATIM_URL = 'https://nominatim.openstreetmap.org/search'

interface NominatimResult {
  lat: string
  lon: string
  display_name: string
}

/**
 * Server-side proxy naar Nominatim (OSM) — nodig omdat hun usage policy een
 * identificerende User-Agent verplicht, wat je vanuit de browser niet kunt
 * zetten. Alleen gebruikt om het adresveld op /alerts naar lat/lon te vertalen.
 */
export async function GET(request: Request) {
  const { searchParams } = new URL(request.url)
  const q = (searchParams.get('q') ?? '').trim()

  if (!q) return jsonError(400, 'Zoekterm (q) verplicht')
  if (q.length > 200) return jsonError(400, 'Zoekterm te lang')

  let res: Response
  try {
    res = await fetch(`${NOMINATIM_URL}?format=jsonv2&limit=1&q=${encodeURIComponent(q)}`, {
      headers: { 'User-Agent': 'vuuralert.nl/1.0 (geocoder; alerts@vuuralert.nl)' },
    })
  } catch {
    return jsonError(502, 'Geocoding-service niet bereikbaar')
  }

  if (!res.ok) return jsonError(502, 'Geocoding-service gaf een fout terug')

  const results = await res.json().catch(() => null) as NominatimResult[] | null
  if (!results || results.length === 0) return jsonError(404, 'Geen locatie gevonden voor deze zoekterm')

  const { lat, lon, display_name } = results[0]
  return jsonOk({ lat: Number(lat), lon: Number(lon), displayName: display_name })
}
