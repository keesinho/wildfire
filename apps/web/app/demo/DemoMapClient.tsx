'use client'
import { useEffect, useRef } from 'react'
import maplibregl from 'maplibre-gl'
import 'maplibre-gl/dist/maplibre-gl.css'

const EVT_COLOR  = { ACTIVE: '#ef4444', COOLING: '#f97316', CANDIDATE: '#6b7280' }
const TREND_ICON = { GROWING: '↑', STABLE: '→', DECLINING: '↓', UNKNOWN: '?' }

function fmtHa(ha: number | null): string {
  if (!ha) return '—'
  return ha >= 10_000 ? `${(ha / 10_000).toFixed(1)} kha` : `${ha.toLocaleString()} ha`
}

interface Props {
  initialData: GeoJSON.FeatureCollection
}

/**
 * Kaart voor de publieke demo-pagina — toont data die écht via /api/v1/fires
 * binnenkwam (server-side, met de demo-key). Alleen de event-hulls, geen
 * losse detecties/debug-controls: dit is bewijsmateriaal, geen debug-tool
 * (die blijft op /map staan).
 */
export default function DemoMapClient({ initialData }: Props) {
  const containerRef = useRef<HTMLDivElement>(null)
  const mapRef        = useRef<maplibregl.Map | null>(null)

  useEffect(() => {
    if (!containerRef.current || mapRef.current) return

    const map = new maplibregl.Map({
      container: containerRef.current,
      style: 'https://tiles.openfreemap.org/styles/dark',
      center: [5, 42], zoom: 4.5,
    })
    map.addControl(new maplibregl.NavigationControl(), 'top-right')
    mapRef.current = map

    map.on('load', () => {
      map.addSource('events', { type: 'geojson', data: initialData })

      for (const [status, color] of Object.entries(EVT_COLOR)) {
        map.addLayer({
          id: `evt-fill-${status.toLowerCase()}`,
          type: 'fill', source: 'events',
          filter: ['all', ['==', ['geometry-type'], 'Polygon'], ['==', ['get', 'status'], status]],
          paint: { 'fill-color': color, 'fill-opacity': 0.18 },
        })
        map.addLayer({
          id: `evt-outline-${status.toLowerCase()}`,
          type: 'line', source: 'events',
          filter: ['all', ['==', ['geometry-type'], 'Polygon'], ['==', ['get', 'status'], status]],
          paint: { 'line-color': color, 'line-width': 1.5, 'line-opacity': 0.8 },
        })
      }

      map.addLayer({
        id: 'evt-point', type: 'circle', source: 'events',
        filter: ['==', ['geometry-type'], 'Point'],
        paint: {
          'circle-radius': 6,
          'circle-color': ['match', ['get', 'status'],
            'ACTIVE', EVT_COLOR.ACTIVE, 'COOLING', EVT_COLOR.COOLING, EVT_COLOR.CANDIDATE],
          'circle-opacity': 0.9, 'circle-stroke-width': 2, 'circle-stroke-color': '#fff',
        },
      })

      const clickLayers = ['evt-fill-active', 'evt-fill-cooling', 'evt-fill-candidate', 'evt-point']
      for (const layer of clickLayers) {
        map.on('click', layer, (e) => {
          const p = e.features?.[0]?.properties as Record<string, unknown> | undefined
          if (!p) return
          const trend = TREND_ICON[p['trend'] as keyof typeof TREND_ICON] ?? '?'
          const statusColor = EVT_COLOR[p['status'] as keyof typeof EVT_COLOR] ?? '#aaa'
          new maplibregl.Popup({ maxWidth: '280px' })
            .setLngLat(e.lngLat)
            .setHTML(`
              <b>${p['name']}</b> ${trend}<br/>
              <span style="color:${statusColor}">${p['status']}</span>
              &nbsp;·&nbsp; sev <b>${p['severity']}</b> &nbsp;·&nbsp; ${p['countryCode'] ?? '—'}<br/>
              Oppervlak: ${fmtHa(p['estAreaHa'] as number | null)}<br/>
              Detecties: ${p['detectionCount']} &nbsp; FRP: ${p['totalFrp']} MW
            `)
            .addTo(map)
        })
        map.on('mouseenter', layer, () => { map.getCanvas().style.cursor = 'pointer' })
        map.on('mouseleave', layer, () => { map.getCanvas().style.cursor = '' })
      }
    })

    return () => { map.remove(); mapRef.current = null }
  }, [initialData])

  return (
    <div style={{ position: 'relative', width: '100%', height: '100vh', fontFamily: 'monospace' }}>
      <div ref={containerRef} style={{ width: '100%', height: '100%' }} />
      <div style={{
        position: 'absolute', top: 12, left: 12,
        background: 'rgba(10,10,10,0.84)', color: '#e5e5e5',
        padding: '10px 14px', borderRadius: 8, fontSize: 12, maxWidth: 240,
      }}>
        <div style={{ fontWeight: 'bold', fontSize: 13, marginBottom: 4 }}>Wildfire API — live demo</div>
        <div style={{ color: '#888' }}>
          Deze data komt binnen via <code>GET /api/v1/fires</code> — dezelfde publieke API die
          je op <a href="/dashboard" style={{ color: '#f97316' }}>/dashboard</a> een key voor kunt maken.
        </div>
        <div style={{ marginTop: 6 }}>
          <span style={{ color: EVT_COLOR.ACTIVE }}>■</span> ACTIVE &nbsp;
          <span style={{ color: EVT_COLOR.COOLING }}>■</span> COOLING &nbsp;
          <span style={{ color: EVT_COLOR.CANDIDATE }}>■</span> CANDIDATE
        </div>
      </div>
    </div>
  )
}
