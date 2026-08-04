/**
 * Filtert ruwe detecties vóór clustering.
 *
 * Stap 1 — StaticHeatSource
 *   Detectie binnen radiusM van een bekende statische warmtebron
 *   → filtered=true, filterReason='static_heat_source'
 *
 * Stap 2 — low_conf_isolated
 *   LOW-confidence detectie zonder buur binnen EPS_KM en 24u
 *   → filtered=true, filterReason='low_conf_isolated'
 *   (Reversibel: een toekomstige buurdetectie kan dit ongedaan maken.)
 */
import { prisma } from '@wildfire/db'
import { DEFAULT_CONFIG, type ClusterConfig } from './cluster.js'

export interface FilterResult {
  staticHeatFiltered: number
  lowConfFiltered:    number
}

export async function filterNewDetections(
  cfg: ClusterConfig = DEFAULT_CONFIG,
): Promise<FilterResult> {
  // ── 1. StaticHeatSource-filter ───────────────────────────────────────────
  // Raakt alleen unfiltered + unattached detecties met een bekende geom.
  const staticCount = await prisma.$executeRaw`
    UPDATE "Detection" d
    SET    filtered = true, "filterReason" = 'static_heat_source'
    WHERE  d.filtered   = false
      AND  d."eventId"  IS NULL
      AND  d.geom       IS NOT NULL
      AND  EXISTS (
             SELECT 1 FROM "StaticHeatSource" s
             WHERE  ST_DWithin(
                      d.geom::geography,
                      ST_SetSRID(ST_MakePoint(s.lon, s.lat), 4326)::geography,
                      s."radiusM"::double precision
                    )
           )
  `

  // ── 2. low_conf_isolated-filter ──────────────────────────────────────────
  // Buur = elke andere unfiltered detectie binnen EPS_KM en ±24u.
  const epsM = cfg.epsKm * 1000

  const lowCount = await prisma.$executeRaw`
    UPDATE "Detection" d
    SET    filtered = true, "filterReason" = 'low_conf_isolated'
    WHERE  d.filtered    = false
      AND  d."eventId"   IS NULL
      AND  d.confidence  = CAST('LOW' AS "Confidence")
      AND  d.geom        IS NOT NULL
      AND  NOT EXISTS (
             SELECT 1 FROM "Detection" d2
             WHERE  d2.id        != d.id
               AND  d2.filtered  = false
               AND  d2.geom      IS NOT NULL
               AND  d2."acquiredAt" > d."acquiredAt" - INTERVAL '24 hours'
               AND  d2."acquiredAt" < d."acquiredAt" + INTERVAL '24 hours'
               AND  ST_DWithin(d.geom::geography, d2.geom::geography, ${epsM})
           )
  `

  return {
    staticHeatFiltered: Number(staticCount),
    lowConfFiltered:    Number(lowCount),
  }
}

/**
 * Maakt low_conf_isolated-filter ongedaan voor detecties die nu wél
 * een buur hebben (bv. na een nieuwe satellietpas).
 * Aanroepen vóór de clustering-stap.
 */
export async function unfilterLowConfWithNeighbors(
  cfg: ClusterConfig = DEFAULT_CONFIG,
): Promise<number> {
  const epsM = cfg.epsKm * 1000

  const count = await prisma.$executeRaw`
    UPDATE "Detection" d
    SET    filtered = false, "filterReason" = NULL
    WHERE  d.filtered      = true
      AND  d."filterReason" = 'low_conf_isolated'
      AND  d."eventId"     IS NULL
      AND  EXISTS (
             SELECT 1 FROM "Detection" d2
             WHERE  d2.id        != d.id
               AND  d2.filtered  = false
               AND  d2.geom      IS NOT NULL
               AND  d2."acquiredAt" > d."acquiredAt" - INTERVAL '24 hours'
               AND  d2."acquiredAt" < d."acquiredAt" + INTERVAL '24 hours'
               AND  ST_DWithin(d.geom::geography, d2.geom::geography, ${epsM})
           )
  `
  return Number(count)
}
