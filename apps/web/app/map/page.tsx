'use client'
import dynamic from 'next/dynamic'
import { NAV_HEIGHT } from '../Nav'

// MapLibre gebruikt browser-API's → ssr: false
const MapClient = dynamic(() => import('./MapClient'), {
  ssr:     false,
  loading: () => (
    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', height: `calc(100vh - ${NAV_HEIGHT}px)`, background: '#111', color: '#888', fontFamily: 'monospace' }}>
      kaart laden…
    </div>
  ),
})

export default function MapPage() {
  return <MapClient />
}
