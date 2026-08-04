'use client'
import { useEffect, useRef, useState } from 'react'
import maplibregl from 'maplibre-gl'
import 'maplibre-gl/dist/maplibre-gl.css'

const COLOR = { HIGH: '#ef4444', NOMINAL: '#f97316', LOW: '#eab308' }

interface Stats { total: number; high: number; nominal: number; low: number }

export default function MapClient() {
  const containerRef = useRef<HTMLDivElement>(null)
  const mapRef       = useRef<maplibregl.Map | null>(null)
  const [stats, setStats]   = useState<Stats | null>(null)
  const [hours, setHours]   = useState(24)
  const [loading, setLoading] = useState(false)

  const loadData = async (map: maplibregl.Map, h: number) => {
    setLoading(true)
    try {
      const res  = await fetch(`/api/detections?hours=${h}`)
      const data = await res.json()

      const src = map.getSource('detections') as maplibregl.GeoJSONSource | undefined
      if (src) {
        src.setData(data)
      } else {
        map.addSource('detections', { type: 'geojson', data })
        addLayers(map)
      }

      const features = data.features as { properties: { confidence: string } }[]
      setStats({
        total:   features.length,
        high:    features.filter(f => f.properties.confidence === 'HIGH').length,
        nominal: features.filter(f => f.properties.confidence === 'NOMINAL').length,
        low:     features.filter(f => f.properties.confidence === 'LOW').length,
      })
    } finally {
      setLoading(false)
    }
  }

  const addLayers = (map: maplibregl.Map) => {
    const layers: { id: string; conf: string; color: string; baseR: number }[] = [
      { id: 'det-high',    conf: 'HIGH',    color: COLOR.HIGH,    baseR: 5 },
      { id: 'det-nominal', conf: 'NOMINAL', color: COLOR.NOMINAL, baseR: 4 },
      { id: 'det-low',     conf: 'LOW',     color: COLOR.LOW,     baseR: 3 },
    ]

    for (const l of layers) {
      map.addLayer({
        id:     l.id,
        type:   'circle',
        source: 'detections',
        filter: ['==', ['get', 'confidence'], l.conf],
        paint:  {
          'circle-radius':  ['interpolate', ['linear'], ['zoom'], 4, l.baseR, 10, l.baseR * 2],
          'circle-color':   l.color,
          'circle-opacity': l.conf === 'LOW' ? 0.55 : 0.8,
          'circle-stroke-width': 0.5,
          'circle-stroke-color': 'rgba(0,0,0,0.4)',
        },
      })

      map.on('click', l.id, (e) => {
        const f = e.features?.[0]
        if (!f) return
        const p = f.properties as Record<string, unknown>
        const acquired = new Date(p['acquiredAt'] as string)
        new maplibregl.Popup({ maxWidth: '240px' })
          .setLngLat(e.lngLat)
          .setHTML(`
            <b>${p['source']}</b><br/>
            Conf: <b style="color:${l.color}">${p['confidence']}</b><br/>
            FRP: ${p['frp'] != null ? `${p['frp']} MW` : '—'}<br/>
            Brightness: ${p['brightness'] ?? '—'}<br/>
            Day/Night: ${p['daynight'] ?? '—'}<br/>
            <small>${acquired.toUTCString()}</small>
          `)
          .addTo(map)
      })

      map.on('mouseenter', l.id, () => { map.getCanvas().style.cursor = 'pointer' })
      map.on('mouseleave', l.id, () => { map.getCanvas().style.cursor = '' })
    }
  }

  useEffect(() => {
    if (!containerRef.current || mapRef.current) return

    const map = new maplibregl.Map({
      container: containerRef.current,
      // Gratis OpenFreeMap-stijl, geen API-key nodig
      style: 'https://tiles.openfreemap.org/styles/dark',
      center: [0, 42],
      zoom:   5,
    })

    map.addControl(new maplibregl.NavigationControl(), 'top-right')
    mapRef.current = map

    map.on('load', () => loadData(map, hours))

    return () => { map.remove(); mapRef.current = null }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const handleHoursChange = (h: number) => {
    setHours(h)
    if (mapRef.current) loadData(mapRef.current, h)
  }

  return (
    <div style={{ position: 'relative', width: '100%', height: '100vh', fontFamily: 'monospace' }}>
      <div ref={containerRef} style={{ width: '100%', height: '100%' }} />

      {/* HUD */}
      <div style={{
        position: 'absolute', top: 12, left: 12,
        background: 'rgba(10,10,10,0.82)', color: '#e5e5e5',
        padding: '10px 14px', borderRadius: 8, fontSize: 12,
        display: 'flex', flexDirection: 'column', gap: 6, minWidth: 200,
      }}>
        <div style={{ fontWeight: 'bold', fontSize: 13 }}>Wildfire — debug kaart</div>

        {/* tijdvenster */}
        <div style={{ display: 'flex', gap: 4 }}>
          {[6, 24, 48, 72].map(h => (
            <button
              key={h}
              onClick={() => handleHoursChange(h)}
              style={{
                padding: '2px 8px', borderRadius: 4, border: 'none', cursor: 'pointer',
                background: hours === h ? '#fff' : '#333',
                color: hours === h ? '#000' : '#aaa',
                fontSize: 11,
              }}
            >
              {h}u
            </button>
          ))}
          {loading && <span style={{ color: '#888', alignSelf: 'center' }}>laden…</span>}
        </div>

        {/* tellingen */}
        {stats && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
            <div>Totaal: <b>{stats.total.toLocaleString()}</b> detecties</div>
            <div><span style={{ color: COLOR.HIGH }}>●</span> HIGH    {stats.high.toLocaleString()}</div>
            <div><span style={{ color: COLOR.NOMINAL }}>●</span> NOMINAL {stats.nominal.toLocaleString()}</div>
            <div><span style={{ color: COLOR.LOW }}>●</span> LOW     {stats.low.toLocaleString()}</div>
          </div>
        )}
      </div>
    </div>
  )
}
