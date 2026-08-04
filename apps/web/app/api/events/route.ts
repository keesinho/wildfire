import { NextResponse } from 'next/server'
import { prisma } from '@wildfire/db'

export const dynamic = 'force-dynamic'

export async function GET() {
  // GeoJSON van alle niet-gesloten events met hull of centroid als fallback
  type Row = {
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

  const rows = await prisma.$queryRaw<Row[]>`
    SELECT
      id,
      name,
      slug,
      status,
      severity,
      trend,
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
    WHERE status != 'CLOSED'
    ORDER BY severity DESC
  `

  const features = rows.map(r => {
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
        lastSeen:       new Date(r.last_seen).toISOString(),
      },
    }
  })

  return NextResponse.json(
    { type: 'FeatureCollection', features },
    {
      // Zonder expliciete charset defaulten sommige HTTP-clients op Latin-1,
      // wat event-namen met accenten corrumpeert terwijl de bytes UTF-8 zijn.
      headers: { 'Cache-Control': 'no-store', 'Content-Type': 'application/json; charset=utf-8' },
    },
  )
}
