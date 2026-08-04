import { NextResponse } from 'next/server'
import { prisma } from '@wildfire/db'
import { getWindAndTemp } from '@/lib/openmeteo'

export const dynamic = 'force-dynamic'

const CELL_DEG        = 0.25   // moet gelijk zijn aan apps/worker/src/danger.ts
const MAX_FIRE_KM      = 300

function roundToCell(v: number): number {
  return Math.round(v / CELL_DEG) * CELL_DEG
}

/** Kompasrichting (0-360, 0 = N) van punt A naar punt B. */
function bearing(latA: number, lonA: number, latB: number, lonB: number): number {
  const toRad = (d: number) => d * Math.PI / 180
  const φ1 = toRad(latA), φ2 = toRad(latB)
  const Δλ = toRad(lonB - lonA)
  const y = Math.sin(Δλ) * Math.cos(φ2)
  const x = Math.cos(φ1) * Math.sin(φ2) - Math.sin(φ1) * Math.cos(φ2) * Math.cos(Δλ)
  return (Math.atan2(y, x) * 180 / Math.PI + 360) % 360
}

type RegionRow = { id: string; countryCode: string; name: string }
type DangerRow = { date: Date; fwiClass: string; fwiValue: number | null }
type FireRow = {
  id: string; name: string | null; slug: string; status: string; trend: string
  severity: number; centroidLat: number; centroidLon: number; distanceKm: number
}
type WarningRow = {
  awarenessType: string; level: string; expires: Date; headline: string | null
  regionId: string | null
}

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url)
  const lat = parseFloat(searchParams.get('lat') ?? '')
  const lon = parseFloat(searchParams.get('lon') ?? '')

  if (isNaN(lat) || isNaN(lon)) {
    return NextResponse.json({ error: 'lat en lon zijn verplicht en moeten numeriek zijn' }, { status: 400 })
  }

  // ── Regio (NUTS-3) + land ──────────────────────────────────────────────
  const region3 = await prisma.$queryRaw<RegionRow[]>`
    SELECT id, "countryCode", name FROM "Region"
    WHERE  level = 3 AND geom IS NOT NULL
      AND  ST_Contains(geom, ST_SetSRID(ST_MakePoint(${lon}, ${lat}), 4326))
    LIMIT 1
  `
  let countryCode = region3[0]?.countryCode ?? null

  if (!countryCode) {
    const region0 = await prisma.$queryRaw<{ countryCode: string }[]>`
      SELECT "countryCode" FROM "Region"
      WHERE  level = 0 AND geom IS NOT NULL
        AND  ST_Contains(geom, ST_SetSRID(ST_MakePoint(${lon}, ${lat}), 4326))
      LIMIT 1
    `
    countryCode = region0[0]?.countryCode ?? null
  }

  const regionId = region3[0]?.id ?? null

  // ── Fire danger: vandaag + forecast voor dichtstbijzijnde 0,25°-cel ────
  const cellLat = roundToCell(lat)
  const cellLon = roundToCell(lon)
  const today   = new Date(); today.setUTCHours(0, 0, 0, 0)

  let dangerRows = await prisma.dangerReading.findMany({
    where: { cellLat, cellLon, date: { gte: today } },
    select: { date: true, fwiClass: true, fwiValue: true },
    orderBy: { date: 'asc' },
  })

  // Fallback: punt kan net op een celgrens vallen waar de exacte cel geen
  // recente rij heeft (bv. no-data/zee-pixel ernaast) — pak de dichtstbijzijnde.
  if (dangerRows.length === 0) {
    dangerRows = await prisma.$queryRaw<DangerRow[]>`
      SELECT date, "fwiClass" AS "fwiClass", "fwiValue" AS "fwiValue"
      FROM "DangerReading"
      WHERE date >= ${today}
      ORDER BY (("cellLat" - ${lat})^2 + ("cellLon" - ${lon})^2) ASC, date ASC
      LIMIT 4
    `
  }

  const danger = dangerRows.length > 0
    ? {
        today:    { fwiClass: dangerRows[0].fwiClass, fwiValue: dangerRows[0].fwiValue },
        forecast: dangerRows.slice(1).map(r => ({
          date:     r.date.toISOString().slice(0, 10),
          fwiClass: r.fwiClass,
          fwiValue: r.fwiValue,
        })),
      }
    : null

  // ── Dichtstbijzijnde actieve brand ──────────────────────────────────────
  const fireRows = await prisma.$queryRaw<FireRow[]>`
    SELECT
      id, name, slug, status, trend, severity,
      "centroidLat" AS "centroidLat", "centroidLon" AS "centroidLon",
      ST_Distance(
        "geomCentroid"::geography,
        ST_SetSRID(ST_MakePoint(${lon}, ${lat}), 4326)::geography
      ) / 1000 AS "distanceKm"
    FROM "FireEvent"
    WHERE  status != 'CLOSED'
      AND  "geomCentroid" IS NOT NULL
      AND  ST_DWithin(
             "geomCentroid"::geography,
             ST_SetSRID(ST_MakePoint(${lon}, ${lat}), 4326)::geography,
             ${MAX_FIRE_KM * 1000}
           )
    ORDER BY "distanceKm" ASC
    LIMIT 1
  `
  const nearestFire = fireRows[0]
    ? {
        id:         fireRows[0].id,
        name:       fireRows[0].name ?? '(onbekend)',
        slug:       fireRows[0].slug,
        status:     fireRows[0].status,
        trend:      fireRows[0].trend,
        severity:   fireRows[0].severity,
        distanceKm: Math.round(fireRows[0].distanceKm * 10) / 10,
        bearingDeg: Math.round(bearing(lat, lon, fireRows[0].centroidLat, fireRows[0].centroidLon)),
      }
    : null

  // ── Waarschuwingen: regiospecifiek + land-brede fallback ────────────────
  // EMMA_ID-landen (Spanje, Portugal, Polen, ...) matchen vaak niet op onze
  // Region-tabel (zie apps/worker/src/warnings.ts) — zonder deze fallback
  // zouden die landen nooit een waarschuwing te zien krijgen.
  const warningRows = await prisma.$queryRaw<WarningRow[]>`
    SELECT "awarenessType" AS "awarenessType", level, expires, headline, "regionId" AS "regionId"
    FROM "Warning"
    WHERE  expires > NOW()
      AND  "awarenessType" IN ('forest_fire', 'extreme_temp')
      AND  (
             "regionId" = ${regionId}
             OR ("regionId" IS NULL AND "countryCode" = ${countryCode})
           )
    ORDER BY expires ASC
  `
  const warnings = warningRows.map(w => ({
    type:     w.awarenessType,
    level:    w.level,
    expires:  w.expires.toISOString(),
    headline: w.headline,
    scope:    w.regionId === regionId && regionId !== null ? 'region' as const : 'country' as const,
  }))

  // ── Wind/temp (Open-Meteo, gecached) ────────────────────────────────────
  const wind = await getWindAndTemp(lat, lon)

  return NextResponse.json({
    location: { lat, lon, countryCode, regionId },
    danger,
    nearestFire,
    warnings,
    wind,
    attribution: [
      'NASA FIRMS',
      '© European Union, Copernicus/EFFIS',
      'MeteoAlarm',
      'Eurostat GISCO (NUTS)',
      'Open-Meteo',
      'Geen officieel waarschuwingsplatform — volg altijd lokale autoriteiten',
    ],
  }, {
    // Zonder expliciete charset defaulten sommige HTTP-clients (bv. Python
    // requests) op Latin-1, wat platsnamen/headlines met accenten
    // (Graça, Regiões) corrumpeert terwijl de bytes prima UTF-8 zijn.
    headers: { 'Cache-Control': 'no-store', 'Content-Type': 'application/json; charset=utf-8' },
  })
}
