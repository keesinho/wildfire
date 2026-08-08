/**
 * Bouwt de inhoud van één alert-bericht (nieuw/update/all-clear) voor één
 * (subscription, event)-paar: afstand + windrichting, trend, FWI-klasse van
 * de regio van de abonnee, en actieve waarschuwingen — zie PLAN.md §4.
 *
 * Cross-app kanttekening: deze context/lookup-logica bestaat ook al in
 * apps/web/lib/ (risk.ts, openmeteo.ts), maar apps/worker kan daar niet uit
 * importeren (geen gedeeld package-grenzen tussen de apps — zie ook
 * warnings.ts/danger.ts, die om dezelfde reden niets uit web/ hergebruiken).
 * Hier dus bewust gedupliceerd i.p.v. een cross-app afhankelijkheid.
 */
import { prisma } from '@wildfire/db'

// ------------------------------------------------------------------ types

export interface EventLike {
  id: string
  name: string | null
  slug: string
  status: string
  severity: number
  trend: string
  centroidLat: number
  centroidLon: number
}

export interface SubscriptionLike {
  id: string
  lat: number
  lon: number
  target: string
}

export type AlertKind = 'new' | 'update' | 'all_clear'

export interface AlertContext {
  distanceKm: number
  bearingDeg: number
  bearingCompass: string
  trend: string
  fwiClass: string | null
  windSpeedKmh: number | null
  windDirectionCompass: string | null
  warnings: {
    type: string; level: string; headline: string | null; scope: 'region' | 'country'
    senderName: string | null; issuedAt: string | null
  }[]
}

// ------------------------------------------------------------------ geo helpers

const CELL_DEG = 0.25 // moet gelijk zijn aan apps/worker/src/danger.ts

function toRad(d: number): number { return d * Math.PI / 180 }

function haversineKm(lat1: number, lon1: number, lat2: number, lon2: number): number {
  const R = 6371
  const dLat = toRad(lat2 - lat1)
  const dLon = toRad(lon2 - lon1)
  const a = Math.sin(dLat / 2) ** 2 + Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLon / 2) ** 2
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a))
}

/** Kompasrichting (0-360, 0 = N) van punt A naar punt B. */
function bearing(latA: number, lonA: number, latB: number, lonB: number): number {
  const φ1 = toRad(latA), φ2 = toRad(latB)
  const Δλ = toRad(lonB - lonA)
  const y = Math.sin(Δλ) * Math.cos(φ2)
  const x = Math.cos(φ1) * Math.sin(φ2) - Math.sin(φ1) * Math.cos(φ2) * Math.cos(Δλ)
  return (Math.atan2(y, x) * 180 / Math.PI + 360) % 360
}

const COMPASS = ['N', 'NO', 'O', 'ZO', 'Z', 'ZW', 'W', 'NW']
function toCompass(deg: number): string {
  return COMPASS[Math.round(deg / 45) % 8]
}

function roundToCell(v: number): number {
  return Math.round(v / CELL_DEG) * CELL_DEG
}

// ------------------------------------------------------------------ wind (Open-Meteo, gecached)

const WIND_CACHE_TTL_MS = 60 * 60 * 1000
const windCache = new Map<string, { value: { speedKmh: number | null; dirDeg: number | null }; expiresAt: number }>()

async function getWind(lat: number, lon: number): Promise<{ speedKmh: number | null; dirDeg: number | null }> {
  const key = `${lat.toFixed(1)},${lon.toFixed(1)}`
  const cached = windCache.get(key)
  if (cached && cached.expiresAt > Date.now()) return cached.value

  let value: { speedKmh: number | null; dirDeg: number | null } = { speedKmh: null, dirDeg: null }
  try {
    const res = await fetch(
      `https://api.open-meteo.com/v1/forecast?latitude=${lat}&longitude=${lon}&current=wind_speed_10m,wind_direction_10m`,
    )
    if (res.ok) {
      const data = await res.json() as { current?: { wind_speed_10m?: number; wind_direction_10m?: number } }
      value = {
        speedKmh: data?.current?.wind_speed_10m ?? null,
        dirDeg: data?.current?.wind_direction_10m ?? null,
      }
    }
  } catch {
    // Open-Meteo onbereikbaar — geef null terug, geen crash
  }
  windCache.set(key, { value, expiresAt: Date.now() + WIND_CACHE_TTL_MS })
  return value
}

// ------------------------------------------------------------------ danger + warnings lookup

async function getFwiClass(lat: number, lon: number): Promise<string | null> {
  const cellLat = roundToCell(lat)
  const cellLon = roundToCell(lon)
  const today = new Date(); today.setUTCHours(0, 0, 0, 0)

  const exact = await prisma.dangerReading.findFirst({
    where: { cellLat, cellLon, date: { gte: today } },
    orderBy: { date: 'asc' },
    select: { fwiClass: true },
  })
  if (exact) return exact.fwiClass

  const nearest = await prisma.$queryRaw<{ fwiClass: string }[]>`
    SELECT "fwiClass" AS "fwiClass"
    FROM "DangerReading"
    WHERE date >= ${today}
    ORDER BY (("cellLat" - ${lat})^2 + ("cellLon" - ${lon})^2) ASC, date ASC
    LIMIT 1
  `
  return nearest[0]?.fwiClass ?? null
}

type WarningRow = {
  awarenessType: string; level: string; headline: string | null
  senderName: string | null; issuedAt: Date | null
}

/** Dedupliceert op headline — MeteoAlarm publiceert dezelfde melding soms onder meerdere externalId's. */
function dedupeWarnings(rows: WarningRow[]): WarningRow[] {
  const seen = new Set<string>()
  const out: WarningRow[] = []
  for (const r of rows) {
    const key = (r.headline ?? '').trim().toLowerCase()
    if (key) {
      if (seen.has(key)) continue
      seen.add(key)
    }
    out.push(r)
  }
  return out
}

async function getActiveWarnings(
  lat: number, lon: number,
): Promise<{
  type: string; level: string; headline: string | null; scope: 'region' | 'country'
  senderName: string | null; issuedAt: string | null
}[]> {
  const region3 = await prisma.$queryRaw<{ id: string; countryCode: string }[]>`
    SELECT id, "countryCode" FROM "Region"
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

  // Regio-specifieke waarschuwingen hebben voorrang. Alleen als die er niet
  // zijn, vallen we terug op landelijke ("regionId IS NULL")  waarschuwingen
  // — en die labelen we expliciet als landelijk, want ze kunnen (door de
  // EMMA/NUTS-mismatch, zie PLAN.md §11) ook een niet-gemapte regionale
  // waarschuwing uit een heel ander deel van het land zijn.
  if (regionId) {
    const regional = await prisma.$queryRaw<WarningRow[]>`
      SELECT "awarenessType" AS "awarenessType", level, headline,
             "senderName" AS "senderName", "issuedAt" AS "issuedAt"
      FROM "Warning"
      WHERE  expires > NOW()
        AND  "awarenessType" IN ('forest_fire', 'extreme_temp')
        AND  "regionId" = ${regionId}
      ORDER BY expires ASC
    `
    if (regional.length > 0) {
      return dedupeWarnings(regional).slice(0, 2).map(r => ({
        type: r.awarenessType, level: r.level, headline: r.headline, scope: 'region' as const,
        senderName: r.senderName, issuedAt: r.issuedAt ? r.issuedAt.toISOString() : null,
      }))
    }
  }

  if (!countryCode) return []

  const countryWide = await prisma.$queryRaw<WarningRow[]>`
    SELECT "awarenessType" AS "awarenessType", level, headline,
           "senderName" AS "senderName", "issuedAt" AS "issuedAt"
    FROM "Warning"
    WHERE  expires > NOW()
      AND  "awarenessType" IN ('forest_fire', 'extreme_temp')
      AND  "regionId" IS NULL
      AND  "countryCode" = ${countryCode}
    ORDER BY expires ASC
  `
  return dedupeWarnings(countryWide).slice(0, 2).map(r => ({
    type: r.awarenessType, level: r.level, headline: r.headline, scope: 'country' as const,
    senderName: r.senderName, issuedAt: r.issuedAt ? r.issuedAt.toISOString() : null,
  }))
}

// ------------------------------------------------------------------ context

export async function buildContext(sub: SubscriptionLike, event: EventLike): Promise<AlertContext> {
  const distanceKm = haversineKm(sub.lat, sub.lon, event.centroidLat, event.centroidLon)
  const bearingDeg = bearing(sub.lat, sub.lon, event.centroidLat, event.centroidLon)

  const [wind, fwiClass, warnings] = await Promise.all([
    getWind(sub.lat, sub.lon),
    getFwiClass(sub.lat, sub.lon),
    getActiveWarnings(sub.lat, sub.lon),
  ])

  return {
    distanceKm: Math.round(distanceKm * 10) / 10,
    bearingDeg: Math.round(bearingDeg),
    bearingCompass: toCompass(bearingDeg),
    trend: event.trend,
    fwiClass,
    windSpeedKmh: wind.speedKmh,
    windDirectionCompass: wind.dirDeg != null ? toCompass(wind.dirDeg) : null,
    warnings,
  }
}

// ------------------------------------------------------------------ Claude context-zin + fallback

const TREND_NL: Record<string, string> = {
  GROWING: 'groeiend', STABLE: 'stabiel', DECLINING: 'afnemend', UNKNOWN: 'onbekend',
}

function formatIssuedAt(iso: string): string {
  return new Date(iso).toLocaleString('nl-NL', {
    day: 'numeric', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit',
    timeZone: 'UTC',
  }) + ' UTC'
}

function fallbackSentence(event: EventLike, ctx: AlertContext): string {
  const windPart = ctx.windSpeedKmh != null && ctx.windDirectionCompass
    ? `, wind ${ctx.windDirectionCompass} ${Math.round(ctx.windSpeedKmh)} km/u`
    : ''
  const fwiPart = ctx.fwiClass ? `, FWI ${ctx.fwiClass}` : ''
  return `${ctx.distanceKm} km ten ${ctx.bearingCompass} van je locatie${windPart}${fwiPart}, trend ${TREND_NL[ctx.trend] ?? ctx.trend}.`
}

async function generateContextSentence(event: EventLike, ctx: AlertContext): Promise<string> {
  const apiKey = process.env.ANTHROPIC_API_KEY
  if (!apiKey) return fallbackSentence(event, ctx)

  const prompt =
    `Schrijf ÉÉN korte Nederlandse zin (max 25 woorden, geen aanhalingstekens) die context geeft over een ` +
    `natuurbrand voor iemand die een waarschuwing ontvangt. Gegevens: ${ctx.distanceKm} km ten ${ctx.bearingCompass} ` +
    `van de locatie van de ontvanger, trend ${TREND_NL[ctx.trend] ?? ctx.trend}` +
    (ctx.windSpeedKmh != null ? `, wind ${ctx.windDirectionCompass} ${Math.round(ctx.windSpeedKmh)} km/u` : '') +
    (ctx.fwiClass ? `, brandgevaar-klasse (FWI) ${ctx.fwiClass}` : '') +
    `. Alleen de zin, verder niets.`

  try {
    const res = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'x-api-key': apiKey,
        'anthropic-version': '2023-06-01',
        'content-type': 'application/json',
      },
      body: JSON.stringify({
        model: 'claude-haiku-4-5',
        max_tokens: 100,
        messages: [{ role: 'user', content: prompt }],
      }),
      signal: AbortSignal.timeout(10_000),
    })

    if (!res.ok) throw new Error(`HTTP ${res.status}`)

    const data = await res.json() as { stop_reason?: string; content?: { type: string; text?: string }[] }
    if (data.stop_reason === 'refusal') throw new Error('refusal')

    const textBlock = data.content?.find(b => b.type === 'text')
    const text = textBlock?.text?.trim()
    if (!text) throw new Error('lege response')

    return text
  } catch (err) {
    console.error('[alertContext] Claude-call mislukt, gebruik fallback:', err)
    return fallbackSentence(event, ctx)
  }
}

// ------------------------------------------------------------------ bericht

export interface AlertMessage {
  subject: string
  text: string
}

const KIND_LABEL: Record<AlertKind, string> = {
  new: 'Nieuwe brand',
  update: 'Update',
  all_clear: 'Geen nieuwe detecties meer',
}

export async function buildMessage(
  sub: SubscriptionLike, event: EventLike, kind: AlertKind, ctx: AlertContext, unsubscribeUrl: string,
): Promise<AlertMessage> {
  const eventName = event.name ?? '(onbekende locatie)'
  const subject = `${KIND_LABEL[kind]}: ${eventName}`

  const contextSentence = kind === 'all_clear'
    ? `Geen nieuwe detecties meer sinds enige tijd bij ${eventName} — dit betekent niet noodzakelijk dat de brand geblust is (wolken kunnen detectie blokkeren).`
    : await generateContextSentence(event, ctx)

  const warningsLines = ctx.warnings.length > 0
    ? ctx.warnings.map(w => {
        const kind  = w.type === 'forest_fire' ? 'bosbrandwaarschuwing' : 'hitte-waarschuwing'
        const scope = w.scope === 'country' ? ' (landelijk — niet per se voor jouw regio)' : ''
        // Bron + uitgiftetijd verplicht te tonen bij MeteoAlarm-waarschuwingen (PLAN.md §8).
        const source = w.senderName ? `, bron: ${w.senderName}` : ''
        const issued = w.issuedAt ? `, uitgegeven ${formatIssuedAt(w.issuedAt)}` : ''
        return `- ${w.level} ${kind}${scope}: ${w.headline ?? ''}${source}${issued}`
      }).join('\n')
    : null

  const lines = [
    contextSentence,
    '',
    `Status: ${event.status}  ·  Severity: ${event.severity}  ·  Trend: ${TREND_NL[event.trend] ?? event.trend}`,
    `Afstand: ${ctx.distanceKm} km ten ${ctx.bearingCompass} van je locatie`,
  ]
  if (warningsLines) lines.push('', 'Actieve waarschuwingen:', warningsLines)
  lines.push(
    '',
    'Dit is geen officieel waarschuwingsplatform — volg altijd lokale autoriteiten. ' +
    'Geen nieuwe detecties betekent niet per se "brand is uit" (wolken kunnen detectie blokkeren).',
    '',
    `Uitschrijven: ${unsubscribeUrl}`,
  )

  return { subject, text: lines.join('\n') }
}
