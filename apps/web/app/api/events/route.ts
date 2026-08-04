import { NextResponse } from 'next/server'
import { listFires } from '@/lib/fires'

export const dynamic = 'force-dynamic'

/** Interne/onbeveiligde variant voor lokaal debuggen — zie /api/v1/fires voor de publieke, key-beveiligde versie. */
export async function GET() {
  const geojson = await listFires()

  return NextResponse.json(geojson, {
    // Zonder expliciete charset defaulten sommige HTTP-clients op Latin-1,
    // wat event-namen met accenten corrumpeert terwijl de bytes UTF-8 zijn.
    headers: { 'Cache-Control': 'no-store', 'Content-Type': 'application/json; charset=utf-8' },
  })
}
