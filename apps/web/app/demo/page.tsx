import { headers } from 'next/headers'
import DemoMapLoader from './DemoMapLoader'

export const dynamic = 'force-dynamic'

/**
 * Genuine server-side call naar onze eigen publieke /api/v1/fires — met een
 * echte Authorization-header en dus een echte usage-increment. Dit bewijst
 * dat de API werkt; een directe Prisma-call vanuit deze pagina zou dat niet
 * doen. De DEMO_API_KEY blijft server-side (nooit naar de browser gestuurd).
 */
async function fetchFires(): Promise<GeoJSON.FeatureCollection> {
  const h     = await headers()
  const host  = h.get('host') ?? 'localhost:3000'
  const proto = h.get('x-forwarded-proto') ?? 'http'

  const demoKey = process.env.DEMO_API_KEY
  if (!demoKey) {
    console.error('[demo] DEMO_API_KEY ontbreekt — draai `pnpm seed:demo-key` en zet de key in .env')
    return { type: 'FeatureCollection', features: [] }
  }

  const res = await fetch(`${proto}://${host}/api/v1/fires`, {
    headers: { Authorization: `Bearer ${demoKey}` },
    cache:   'no-store',
  })
  if (!res.ok) {
    console.error(`[demo] /api/v1/fires → HTTP ${res.status}`)
    return { type: 'FeatureCollection', features: [] }
  }
  return res.json()
}

export default async function DemoPage() {
  const geojson = await fetchFires()
  return <DemoMapLoader initialData={geojson} />
}
