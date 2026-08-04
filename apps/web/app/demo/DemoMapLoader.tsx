'use client'
import dynamic from 'next/dynamic'

// MapLibre gebruikt browser-API's → ssr: false (moet in een Client Component)
const DemoMapClient = dynamic(() => import('./DemoMapClient'), {
  ssr:     false,
  loading: () => (
    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', height: '100vh', background: '#111', color: '#888', fontFamily: 'monospace' }}>
      kaart laden…
    </div>
  ),
})

export default function DemoMapLoader({ initialData }: { initialData: GeoJSON.FeatureCollection }) {
  return <DemoMapClient initialData={initialData} />
}
