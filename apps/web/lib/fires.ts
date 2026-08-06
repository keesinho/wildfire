import { prisma } from '@wildfire/db'

type EventRow = {
  id:              string
  name:            string | null
  slug:            string
  status:          string
  severity:        number
  trend:           string
  detection_count: number
  total_frp:       number
  est_area_ha:     number | null
  first_seen:      Date
  last_seen:       Date
  country_code:    string | null
  centroid_lon:    number
  centroid_lat:    number
  hull_geojson:    string | null
}

function toFeature(r: EventRow) {
  const geometry = r.hull_geojson
    ? JSON.parse(r.hull_geojson)
    : { type: 'Point', coordinates: [r.centroid_lon, r.centroid_lat] }

  const durationH = Math.round(
    (new Date(r.last_seen).getTime() - new Date(r.first_seen).getTime()) / 3_600_000,
  )

  return {
    type: 'Feature',
    geometry,
    properties: {
      id:             r.id,
      name:           r.name ?? '(onbekend)',
      slug:           r.slug,
      status:         r.status,
      severity:       r.severity,
      trend:          r.trend,
      detectionCount: r.detection_count,
      totalFrp:       Number(r.total_frp).toFixed(1),
      estAreaHa:      r.est_area_ha ? Math.round(r.est_area_ha) : null,
      countryCode:    r.country_code,
      durationH,
      firstSeen:      new Date(r.first_seen).toISOString(),
      lastSeen:       new Date(r.last_seen).toISOString(),
    },
  }
}

export interface ListFiresArgs {
  /** [west, south, east, north] in EPSG:4326 */
  bbox?: [number, number, number, number]
  status?: string
}

export async function listFires({ bbox, status }: ListFiresArgs = {}) {
  const rows = bbox
    ? await prisma.$queryRaw<EventRow[]>`
        SELECT
          id, name, slug, status, severity, trend,
          "detectionCount"  AS detection_count,
          "totalFrp"        AS total_frp,
          "estAreaHa"       AS est_area_ha,
          "firstSeen"       AS first_seen,
          "lastSeen"        AS last_seen,
          "countryCode"     AS country_code,
          "centroidLon"     AS centroid_lon,
          "centroidLat"     AS centroid_lat,
          ST_AsGeoJSON("geomHull")::text AS hull_geojson
        FROM "FireEvent"
        WHERE (${status}::text IS NOT NULL AND status::text = ${status}::text
               OR ${status}::text IS NULL AND status != 'CLOSED')
          AND ST_Intersects(
                COALESCE("geomHull", "geomCentroid"),
                ST_MakeEnvelope(${bbox[0]}, ${bbox[1]}, ${bbox[2]}, ${bbox[3]}, 4326)
              )
        ORDER BY severity DESC
      `
    : await prisma.$queryRaw<EventRow[]>`
        SELECT
          id, name, slug, status, severity, trend,
          "detectionCount"  AS detection_count,
          "totalFrp"        AS total_frp,
          "estAreaHa"       AS est_area_ha,
          "firstSeen"       AS first_seen,
          "lastSeen"        AS last_seen,
          "countryCode"     AS country_code,
          "centroidLon"     AS centroid_lon,
          "centroidLat"     AS centroid_lat,
          ST_AsGeoJSON("geomHull")::text AS hull_geojson
        FROM "FireEvent"
        WHERE (${status}::text IS NOT NULL AND status::text = ${status}::text
               OR ${status}::text IS NULL AND status != 'CLOSED')
        ORDER BY severity DESC
      `

  return { type: 'FeatureCollection' as const, features: rows.map(toFeature) }
}

type DetectionRow = {
  id: string; lat: number; lon: number; acquiredAt: Date
  frp: number | null; confidence: string; source: string
}

export async function getFireDetail(idOrSlug: string) {
  const event = await prisma.fireEvent.findFirst({
    where: { OR: [{ id: idOrSlug }, { slug: idOrSlug }] },
  })
  if (!event) return null

  const detections = await prisma.detection.findMany({
    where:   { eventId: event.id },
    select:  { id: true, lat: true, lon: true, acquiredAt: true, frp: true, confidence: true, source: true },
    orderBy: { acquiredAt: 'desc' },
    take:    200,
  })

  return {
    id:             event.id,
    name:           event.name ?? '(onbekend)',
    slug:           event.slug,
    status:         event.status,
    severity:       event.severity,
    trend:          event.trend,
    detectionCount: event.detectionCount,
    totalFrp:       event.totalFrp,
    maxFrp:         event.maxFrp,
    estAreaHa:      event.estAreaHa ? Math.round(event.estAreaHa) : null,
    countryCode:    event.countryCode,
    centroid:       { lat: event.centroidLat, lon: event.centroidLon },
    firstSeen:      event.firstSeen.toISOString(),
    lastSeen:       event.lastSeen.toISOString(),
    detections: detections.map((d: DetectionRow) => ({
      id:         d.id,
      lat:        d.lat,
      lon:        d.lon,
      acquiredAt: d.acquiredAt.toISOString(),
      frp:        d.frp,
      confidence: d.confidence,
      source:     d.source,
    })),
    detectionsTruncated: event.detectionCount > detections.length,
  }
}
