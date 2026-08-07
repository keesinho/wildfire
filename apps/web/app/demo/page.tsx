import { headers } from 'next/headers'
import DemoMapLoader from './DemoMapLoader'

export const dynamic = 'force-dynamic'

type FiresResult = { geojson: GeoJSON.FeatureCollection; error: boolean }

const EMPTY: GeoJSON.FeatureCollection = { type: 'FeatureCollection', features: [] }

/**
 * Genuine server-side call naar onze eigen publieke /api/v1/fires — met een
 * echte Authorization-header en dus een echte usage-increment. Dit bewijst
 * dat de API werkt; een directe Prisma-call vanuit deze pagina zou dat niet
 * doen. De DEMO_API_KEY blijft server-side (nooit naar de browser gestuurd).
 *
 * Op de kale *.vercel.app-deploymenturl staat SSO/deployment-protection aan,
 * die deze self-fetch naar een HTML-loginpagina (HTTP 200) kan omleiden —
 * vandaar de content-type-check en de try/catch rond res.json().
 */
async function fetchFires(): Promise<FiresResult> {
  const h     = await headers()
  const host  = h.get('host') ?? 'localhost:3000'
  const proto = h.get('x-forwarded-proto') ?? 'http'

  const demoKey = process.env.DEMO_API_KEY
  if (!demoKey) {
    console.error('[demo] DEMO_API_KEY ontbreekt — draai `pnpm seed:demo-key` en zet de key in .env')
    return { geojson: EMPTY, error: true }
  }

  let res: Response
  try {
    res = await fetch(`${proto}://${host}/api/v1/fires`, {
      headers: { Authorization: `Bearer ${demoKey}` },
      cache:   'no-store',
    })
  } catch (err) {
    console.error('[demo] /api/v1/fires → fetch mislukt:', err)
    return { geojson: EMPTY, error: true }
  }

  if (!res.ok) {
    console.error(`[demo] /api/v1/fires → HTTP ${res.status}`)
    return { geojson: EMPTY, error: true }
  }

  const contentType = res.headers.get('content-type') ?? ''
  if (!contentType.includes('application/json')) {
    console.error(`[demo] /api/v1/fires → onverwachte content-type "${contentType}" (geen JSON)`)
    return { geojson: EMPTY, error: true }
  }

  try {
    return { geojson: await res.json(), error: false }
  } catch (err) {
    console.error('[demo] /api/v1/fires → response is geen geldige JSON:', err)
    return { geojson: EMPTY, error: true }
  }
}

export default async function DemoPage() {
  const { geojson, error } = await fetchFires()
  return <DemoMapLoader initialData={geojson} error={error} />
}
