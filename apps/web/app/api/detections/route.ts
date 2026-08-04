import { NextResponse } from 'next/server'
import { prisma } from '@wildfire/db'

export const dynamic = 'force-dynamic'

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url)
  const hours = Math.min(72, Math.max(1, parseInt(searchParams.get('hours') ?? '24', 10)))
  const since = new Date(Date.now() - hours * 60 * 60 * 1000)

  const detections = await prisma.detection.findMany({
    where: {
      acquiredAt: { gte: since },
      filtered:   false,
    },
    select: {
      id:         true,
      lat:        true,
      lon:        true,
      source:     true,
      confidence: true,
      frp:        true,
      brightness: true,
      daynight:   true,
      acquiredAt: true,
    },
    orderBy: { acquiredAt: 'desc' },
    take: 10_000,
  })

  const geojson = {
    type: 'FeatureCollection',
    features: detections.map(d => ({
      type: 'Feature',
      geometry: { type: 'Point', coordinates: [d.lon, d.lat] },
      properties: {
        id:         d.id,
        source:     d.source,
        confidence: d.confidence,
        frp:        d.frp,
        brightness: d.brightness,
        daynight:   d.daynight,
        acquiredAt: d.acquiredAt.toISOString(),
      },
    })),
  }

  return NextResponse.json(geojson, {
    headers: { 'Cache-Control': 'no-store' },
  })
}
