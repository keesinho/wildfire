/**
 * Open-Meteo on-demand: wind + temperatuur voor één punt.
 * Gratis, geen API-key nodig bij niet-commercieel volume (PLAN.md §1) —
 * bij commerciële launch overstappen op het betaalde plan + key.
 * Cache 1u in-memory per afgerond punt (0,1°), zoals PLAN.md voorschrijft;
 * geen DB-tabel nodig, dit is puur een goedkope voorgevel voor de API-call.
 */

const CACHE_TTL_MS = 60 * 60 * 1000

export interface WindTemp {
  temperatureC: number | null
  windSpeedKmh: number | null
  windDirectionDeg: number | null
}

const cache = new Map<string, { value: WindTemp; expiresAt: number }>()

function cacheKey(lat: number, lon: number): string {
  return `${lat.toFixed(1)},${lon.toFixed(1)}`
}

export async function getWindAndTemp(lat: number, lon: number): Promise<WindTemp> {
  const key    = cacheKey(lat, lon)
  const cached = cache.get(key)
  if (cached && cached.expiresAt > Date.now()) return cached.value

  const url = `https://api.open-meteo.com/v1/forecast` +
    `?latitude=${lat}&longitude=${lon}` +
    `&current=temperature_2m,wind_speed_10m,wind_direction_10m`

  let value: WindTemp = { temperatureC: null, windSpeedKmh: null, windDirectionDeg: null }

  try {
    const res = await fetch(url)
    if (res.ok) {
      const data = await res.json()
      const current = data?.current ?? {}
      value = {
        temperatureC:     current.temperature_2m     ?? null,
        windSpeedKmh:     current.wind_speed_10m      ?? null,
        windDirectionDeg: current.wind_direction_10m  ?? null,
      }
    }
  } catch {
    // Open-Meteo down/onbereikbaar — geef null-waarden terug, geen crash
  }

  cache.set(key, { value, expiresAt: Date.now() + CACHE_TTL_MS })
  return value
}
