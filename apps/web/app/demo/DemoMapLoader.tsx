'use client'
import dynamic from 'next/dynamic'
import { NAV_HEIGHT } from '../Nav'

// MapLibre gebruikt browser-API's → ssr: false (moet in een Client Component)
const DemoMapClient = dynamic(() => import('./DemoMapClient'), {
  ssr:     false,
  loading: () => (
    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', height: `calc(100vh - ${NAV_HEIGHT}px)`, background: '#111', color: '#888', fontFamily: 'monospace' }}>
      kaart laden…
    </div>
  ),
})

interface Props {
  initialData: GeoJSON.FeatureCollection
  error: boolean
}

export default function DemoMapLoader({ initialData, error }: Props) {
  return <DemoMapClient initialData={initialData} error={error} />
}
