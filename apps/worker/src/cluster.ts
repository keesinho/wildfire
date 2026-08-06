/**
 * Clustering-engine: losse Detection-pixels → persistente FireEvents.
 * Incrementele DBSCAN met tijdvenster (zie PLAN.md §3).
 */
import { prisma } from '@wildfire/db'
import type { EventStatus, Trend } from '@wildfire/db'

// ── Config ──────────────────────────────────────────────────────────────────

export interface ClusterConfig {
  epsKm:         number   // max. afstand voor hechting/clustering
  attachWindowH: number   // hoe lang is een event "hechtbaar" (uren)
  minPts:        number   // min. detecties om CANDIDATE → ACTIVE te promoveren
  soloFrpMw:     number   // FRP-drempel voor directe soloPromote
  coolingH:      number   // uren stilte voordat ACTIVE → COOLING
  closedH:       number   // uren stilte voordat COOLING → CLOSED
}

export const DEFAULT_CONFIG: ClusterConfig = {
  epsKm:         2.5,
  attachWindowH: 48,
  minPts:        2,
  soloFrpMw:     20,
  coolingH:      36,
  closedH:       72,
}

/**
 * Eurostat/NUTS gebruikt voor twee landen een code die afwijkt van ISO 3166-1,
 * dat de Place-tabel (GeoNames) gebruikt: Verenigd Koninkrijk = "UK" (Eurostat)
 * vs. "GB" (ISO), Griekenland = "EL" (Eurostat) vs. "GR" (ISO). Zonder deze
 * mapping levert de dichtstbijzijnde-plaats-query voor die twee landen altijd
 * 0 rijen op — Region.countryCode ("UK"/"EL") matcht dan nooit Place.countryCode
 * ("GB"/"GR"), ook al is de stad wél gezaaid.
 */
const NUTS_TO_ISO_COUNTRY: Record<string, string> = { UK: 'GB', EL: 'GR' }

// ── Types ───────────────────────────────────────────────────────────────────

export interface DetectionLike {
  id:         string
  lat:        number
  lon:        number
  frp:        number | null
  confidence: string
  acquiredAt: Date
}

// ── Hulpfuncties ─────────────────────────────────────────────────────────────

export function soloPromote(d: DetectionLike, cfg: ClusterConfig): boolean {
  return d.confidence === 'HIGH' && (d.frp ?? 0) >= cfg.soloFrpMw
}

function slugify(text: string): string {
  return text
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')  // diacrieten
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '')
}

function makeSlug(year: number, place: string): string {
  const rand = Math.random().toString(36).slice(2, 10)
  return `${year}-${slugify(place)}-${rand}`
}

function clamp(v: number, lo: number, hi: number): number {
  return Math.max(lo, Math.min(hi, v))
}

// ── Ruimtelijke queries ──────────────────────────────────────────────────────

/** Dichtstbijzijnde hechtbaar event binnen epsKm + attachWindowH. */
async function nearestEvent(
  lon: number, lat: number, acquiredAt: Date, cfg: ClusterConfig,
): Promise<{ id: string } | null> {
  const epsM  = cfg.epsKm * 1000
  const since = new Date(acquiredAt.getTime() - cfg.attachWindowH * 3_600_000)

  const rows = await prisma.$queryRaw<{ id: string }[]>`
    SELECT id FROM "FireEvent"
    WHERE  status IN ('CANDIDATE', 'ACTIVE', 'COOLING')
      AND  "lastSeen" >= ${since}
      AND  "geomCentroid" IS NOT NULL
      AND  ST_DWithin(
             "geomCentroid"::geography,
             ST_SetSRID(ST_MakePoint(${lon}, ${lat}), 4326)::geography,
             ${epsM}
           )
    ORDER BY ST_Distance(
               "geomCentroid"::geography,
               ST_SetSRID(ST_MakePoint(${lon}, ${lat}), 4326)::geography
             )
    LIMIT 1
  `
  return rows[0] ?? null
}

/** Unattached detecties binnen epsKm en 24u (voor drempel-check). */
async function nearbyUnattached(
  excludeId: string, lon: number, lat: number, acquiredAt: Date, cfg: ClusterConfig,
): Promise<DetectionLike[]> {
  const epsM  = cfg.epsKm * 1000
  const since = new Date(acquiredAt.getTime() - 24 * 3_600_000)

  return prisma.$queryRaw<DetectionLike[]>`
    SELECT id, lat, lon, frp, confidence, "acquiredAt"
    FROM   "Detection"
    WHERE  "eventId"    IS NULL
      AND  filtered     = false
      AND  id          != ${excludeId}
      AND  "acquiredAt" >= ${since}
      AND  "acquiredAt" <= ${acquiredAt}
      AND  geom IS NOT NULL
      AND  ST_DWithin(
             geom::geography,
             ST_SetSRID(ST_MakePoint(${lon}, ${lat}), 4326)::geography,
             ${epsM}
           )
  `
}

// ── Event aanmaken / hechten ─────────────────────────────────────────────────

async function attachDetection(detectionId: string, eventId: string): Promise<void> {
  await prisma.detection.update({ where: { id: detectionId }, data: { eventId } })
}

async function createFireEvent(
  members: DetectionLike[],
  status:  EventStatus,
): Promise<string> {
  const first     = members[0]
  const year      = first.acquiredAt.getFullYear()
  const firstSeen = members.reduce((m, d) => d.acquiredAt < m ? d.acquiredAt : m, first.acquiredAt)
  const lastSeen  = members.reduce((m, d) => d.acquiredAt > m ? d.acquiredAt : m, first.acquiredAt)

  const event = await prisma.fireEvent.create({
    data: {
      slug:        makeSlug(year, 'onbekend'),
      centroidLat: first.lat,
      centroidLon: first.lon,
      firstSeen,
      lastSeen,
      status,
      trend: 'UNKNOWN',
    },
  })

  await prisma.detection.updateMany({
    where: { id: { in: members.map(d => d.id) } },
    data:  { eventId: event.id },
  })

  return event.id
}

// ── Herbereken event ──────────────────────────────────────────────────────────

type StatsRow = {
  cx: number; cy: number
  det_count:  number | bigint
  total_frp:  number
  max_frp:    number
  first_seen: Date
  last_seen:  Date
  recent6h:   number | bigint
  prev6h:     number | bigint
}

export async function recalculateEvent(eventId: string): Promise<void> {
  // 1. Aggregaat-stats + trend-tellingen
  const statsRows = await prisma.$queryRaw<StatsRow[]>`
    SELECT
      sub.cx, sub.cy,
      sub.det_count, sub.total_frp, sub.max_frp,
      sub.first_seen, sub.last_seen,
      (SELECT COUNT(*)::int FROM "Detection"
       WHERE  "eventId" = ${eventId}
         AND  "acquiredAt" > sub.last_seen - INTERVAL '6 hours') AS recent6h,
      (SELECT COUNT(*)::int FROM "Detection"
       WHERE  "eventId" = ${eventId}
         AND  "acquiredAt" BETWEEN sub.last_seen - INTERVAL '12 hours'
                                AND sub.last_seen - INTERVAL '6 hours')  AS prev6h
    FROM (
      SELECT
        ST_X(ST_Centroid(ST_Collect(geom))) AS cx,
        ST_Y(ST_Centroid(ST_Collect(geom))) AS cy,
        COUNT(*)::int                        AS det_count,
        COALESCE(SUM(frp), 0)               AS total_frp,
        COALESCE(MAX(frp), 0)               AS max_frp,
        MIN("acquiredAt")                   AS first_seen,
        MAX("acquiredAt")                   AS last_seen
      FROM "Detection"
      WHERE "eventId" = ${eventId}
        AND geom IS NOT NULL
    ) sub
  `

  const stats = statsRows[0]
  if (!stats || stats.cx == null) return

  // 2. Convex hull + oppervlak
  const hullRows = await prisma.$queryRaw<{ hull: string | null; area_ha: number | null }[]>`
    SELECT
      ST_AsText(ST_ConvexHull(ST_Collect(geom))) AS hull,
      CASE
        WHEN ST_GeometryType(ST_ConvexHull(ST_Collect(geom))) = 'ST_Polygon'
        THEN ST_Area(ST_Transform(ST_ConvexHull(ST_Collect(geom)), 3857)) / 10000
      END AS area_ha
    FROM "Detection"
    WHERE "eventId" = ${eventId}
      AND geom IS NOT NULL
  `

  const hullWkt     = hullRows[0]?.hull ?? null
  const hullPolygon = hullWkt?.startsWith('POLYGON') ? hullWkt : null
  const areaHa      = hullRows[0]?.area_ha ?? null

  // 3. Trend
  const recent = Number(stats.recent6h)
  const prev   = Number(stats.prev6h)
  let trend: Trend = 'UNKNOWN'
  if (recent > 0 || prev > 0) {
    if (prev === 0)              trend = 'STABLE'
    else if (recent > prev * 1.2) trend = 'GROWING'
    else if (recent < prev * 0.8) trend = 'DECLINING'
    else                          trend = 'STABLE'
  }

  // 4. Severity
  // Formule: 20·log10(totalFrp+1) + 2·min(recent6h,8) + trendBonus
  //   FRP-component loopt van 0 (0 MW) → 80 (10 GW); cap recent op 8 → max 16;
  //   trendBonus max +15 → theoretisch plafond ~111, bereikbaar alleen bij
  //   catastrofaal vuur. Geeft werkbare spreiding over het hele 0–100 bereik.
  const trendBonus    = trend === 'GROWING' ? 15 : trend === 'DECLINING' ? -10 : 0
  const recentCapped  = Math.min(recent, 8)
  const severity      = clamp(
    Math.round(20 * Math.log10(Number(stats.total_frp) + 1) + 2 * recentCapped + trendBonus),
    0, 100,
  )

  // 5. Regio (NUTS level 3) voor countryCode + regionId
  const regionRows = await prisma.$queryRaw<{ id: string; countryCode: string }[]>`
    SELECT id, "countryCode" FROM "Region"
    WHERE  level = 3
      AND  geom IS NOT NULL
      AND  ST_Contains(geom, ST_SetSRID(ST_MakePoint(${stats.cx}, ${stats.cy}), 4326))
    LIMIT 1
  `
  const regionId    = regionRows[0]?.id          ?? null
  const countryCode = regionRows[0]?.countryCode ?? null

  // 6. Dichtstbijzijnde stad (voor naamgeving)
  const placeCountryCode = countryCode ? (NUTS_TO_ISO_COUNTRY[countryCode] ?? countryCode) : null
  const placeRows = placeCountryCode
    ? await prisma.$queryRaw<{ name: string }[]>`
        SELECT name FROM "Place"
        WHERE  "countryCode" = ${placeCountryCode}
        ORDER BY ST_MakePoint(lon, lat) <-> ST_MakePoint(${stats.cx}, ${stats.cy})
        LIMIT 1
      `
    : await prisma.$queryRaw<{ name: string }[]>`
        SELECT name FROM "Place"
        ORDER BY ST_MakePoint(lon, lat) <-> ST_MakePoint(${stats.cx}, ${stats.cy})
        LIMIT 1
      `

  const placeName = placeRows[0]?.name ?? null
  const eventName = placeName ? `Brand bij ${placeName}` : null
  const year      = new Date(stats.last_seen).getFullYear()

  // 7. Sla op
  await prisma.$executeRaw`
    UPDATE "FireEvent"
    SET
      "centroidLat"    = ${stats.cy},
      "centroidLon"    = ${stats.cx},
      "estAreaHa"      = ${areaHa},
      "firstSeen"      = ${stats.first_seen},
      "lastSeen"       = ${stats.last_seen},
      "detectionCount" = ${Number(stats.det_count)},
      "totalFrp"       = ${Number(stats.total_frp)},
      "maxFrp"         = ${Number(stats.max_frp)},
      "trend"          = CAST(${trend} AS "Trend"),
      "severity"       = ${severity},
      "countryCode"    = ${countryCode},
      "regionId"       = ${regionId},
      "name"           = ${eventName},
      "updatedAt"      = NOW()
    WHERE id = ${eventId}
  `

  // Hull apart (geometry-type mag niet in gewone UPDATE-parameters)
  if (hullPolygon) {
    await prisma.$executeRaw`
      UPDATE "FireEvent"
      SET "geomHull" = ST_GeomFromText(${hullPolygon}, 4326)
      WHERE id = ${eventId}
    `
  }

  // Slug bijwerken zodra naam bekend is
  if (placeName) {
    try {
      await prisma.$executeRaw`
        UPDATE "FireEvent"
        SET slug = ${makeSlug(year, placeName)}
        WHERE id = ${eventId}
      `
    } catch {
      // Uiterst zeldzame slug-botsing; oud slug blijft staan
    }
  }
}

// ── Statusmachine ────────────────────────────────────────────────────────────

/**
 * Voer alle statustransities uit.
 * @param now  Simulatietijdstip (voor replay historische data; standaard = NOW())
 * @param cfg  Clusterparameters
 */
export async function runStatusMachine(
  now: Date = new Date(),
  cfg: ClusterConfig = DEFAULT_CONFIG,
): Promise<void> {
  const coolingCutoff = new Date(now.getTime() - cfg.coolingH * 3_600_000)
  const closedCutoff  = new Date(now.getTime() - cfg.closedH  * 3_600_000)

  // CANDIDATE → ACTIVE  (minPts bereikt) — eerst, zodat de cooling-check
  // in dezelfde run ook nieuw-gepromoveerde events pakt
  await prisma.$executeRaw`
    UPDATE "FireEvent" fe
    SET status = CAST('ACTIVE' AS "EventStatus"), "updatedAt" = NOW()
    WHERE fe.status = CAST('CANDIDATE' AS "EventStatus")
      AND (SELECT COUNT(*) FROM "Detection" WHERE "eventId" = fe.id) >= ${cfg.minPts}
  `

  // ACTIVE → COOLING  (lang geen nieuwe detectie)
  await prisma.$executeRaw`
    UPDATE "FireEvent"
    SET status = CAST('COOLING' AS "EventStatus"), "updatedAt" = NOW()
    WHERE status = CAST('ACTIVE' AS "EventStatus")
      AND "lastSeen" < ${coolingCutoff}
  `

  // COOLING → CLOSED  (nog langer niets)
  await prisma.$executeRaw`
    UPDATE "FireEvent"
    SET status = CAST('CLOSED' AS "EventStatus"), "updatedAt" = NOW()
    WHERE status = CAST('COOLING' AS "EventStatus")
      AND "lastSeen" < ${closedCutoff}
  `
}

// ── Batch cluster + herbereken ────────────────────────────────────────────────

/**
 * Verwerkt alle ongehechte, ongefilterde detecties:
 *  1. Loop processDetection op volgorde van acquiredAt
 *  2. Herbereken alle gerakte events
 *  3. Draai de statusmachine
 * @returns aantal nieuwe events dat aangemaakt is
 */
export async function clusterAndRecalculate(
  cfg: ClusterConfig = DEFAULT_CONFIG,
): Promise<number> {
  // Haal alle unattached + unfiltered detecties op, gesorteerd op tijd
  const detections = await prisma.$queryRaw<DetectionLike[]>`
    SELECT id, lat, lon, frp, confidence, "acquiredAt"
    FROM   "Detection"
    WHERE  "eventId"  IS NULL
      AND  filtered   = false
      AND  geom       IS NOT NULL
    ORDER BY "acquiredAt" ASC
  `

  if (detections.length === 0) return 0

  // Verwerk detectie voor detectie. Eén mislukte detectie mag de rest van de
  // batch niet blokkeren — anders blijven alle later-in-volgorde detecties
  // onaangeraakt (eventId blijft NULL) tot een volgende run.
  const touchedEvents = new Set<string>()
  for (const d of detections) {
    try {
      const eventId = await processDetection(d, cfg)
      if (eventId) touchedEvents.add(eventId)
    } catch (err) {
      console.error(`[cluster] processDetection mislukt voor detectie ${d.id}:`, err)
    }
  }

  // Herbereken alle gerakte events. Zelfde redenering: één stuk event mag niet
  // de herberekening van alle andere geraakte events in deze batch blokkeren —
  // dat liet events achter met eeuwig totalFrp=0/detectionCount=0 (en dus een
  // te lage severity, waardoor een echte brand onder de alert-drempel bleef).
  for (const eventId of touchedEvents) {
    try {
      await recalculateEvent(eventId)
    } catch (err) {
      console.error(`[cluster] recalculateEvent mislukt voor event ${eventId}:`, err)
    }
  }

  // Statusmachine met huidige tijd
  await runStatusMachine(new Date(), cfg)

  return touchedEvents.size
}

// ── Hoofd-clusterstap (één detectie) ────────────────────────────────────────

/**
 * Verwerk één detectie: hecht aan bestaand event of maak nieuw event.
 * @returns eventId als de detectie ergens aan gehecht is, anders null.
 */
export async function processDetection(
  d:   DetectionLike,
  cfg: ClusterConfig,
): Promise<string | null> {
  // 1. Probeer bestaand event
  const existing = await nearestEvent(d.lon, d.lat, d.acquiredAt, cfg)
  if (existing) {
    await attachDetection(d.id, existing.id)
    // COOLING → ACTIVE bij nieuwe detectie
    await prisma.$executeRaw`
      UPDATE "FireEvent"
      SET status = CAST('ACTIVE' AS "EventStatus"), "updatedAt" = NOW()
      WHERE id = ${existing.id}
        AND status = CAST('COOLING' AS "EventStatus")
    `
    return existing.id
  }

  // 2. Zoek buren zonder event
  const buddies = await nearbyUnattached(d.id, d.lon, d.lat, d.acquiredAt, cfg)
  const promote = soloPromote(d, cfg)

  if (buddies.length + 1 >= cfg.minPts || promote) {
    const status: EventStatus = promote && buddies.length + 1 < cfg.minPts
      ? 'ACTIVE'      // soloPromote zonder genoeg buren → direct ACTIVE
      : 'CANDIDATE'   // voldoende buren → start als CANDIDATE, statusmachine promoveert
    const members = [d, ...buddies]
    return createFireEvent(members, status)
  }

  // 3. Blijft los liggen
  return null
}
