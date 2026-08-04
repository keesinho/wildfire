import { NextResponse } from 'next/server'
import { computeRisk } from '@/lib/risk'

export const dynamic = 'force-dynamic'

/** Interne/onbeveiligde variant voor lokaal debuggen — zie /api/v1/risk voor de publieke, key-beveiligde versie. */
export async function GET(request: Request) {
  const { searchParams } = new URL(request.url)
  const lat = parseFloat(searchParams.get('lat') ?? '')
  const lon = parseFloat(searchParams.get('lon') ?? '')

  if (isNaN(lat) || isNaN(lon)) {
    return NextResponse.json({ error: 'lat en lon zijn verplicht en moeten numeriek zijn' }, { status: 400 })
  }

  const result = await computeRisk(lat, lon)

  return NextResponse.json(result, {
    // Zonder expliciete charset defaulten sommige HTTP-clients (bv. Python
    // requests) op Latin-1, wat plaatsnamen/headlines met accenten
    // (Graça, Regiões) corrumpeert terwijl de bytes prima UTF-8 zijn.
    headers: { 'Cache-Control': 'no-store', 'Content-Type': 'application/json; charset=utf-8' },
  })
}
