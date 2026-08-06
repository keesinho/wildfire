'use client'
import { useEffect, useRef, useState } from 'react'
import maplibregl from 'maplibre-gl'
import 'maplibre-gl/dist/maplibre-gl.css'
import { NAV_HEIGHT } from '../Nav'

const DET_COLOR  = { HIGH: '#ef4444', NOMINAL: '#f97316', LOW: '#eab308' }
const EVT_COLOR  = { ACTIVE: '#ef4444', COOLING: '#f97316', CANDIDATE: '#6b7280' }
const TREND_ICON = { GROWING: '↑', STABLE: '→', DECLINING: '↓', UNKNOWN: '?' }

interface DetStats { total: number; high: number; nominal: number; low: number }
interface EvtStats { total: number; active: number; cooling: number; candidate: number }

function fmtHa(ha: number | null): string {
  if (!ha) return '—'
  return ha >= 10_000 ? `${(ha / 10_000).toFixed(1)} kha` : `${ha.toLocaleString()} ha`
}

function fmtDuration(h: number): string {
  if (h < 24) return `${h}u`
  return `${Math.floor(h / 24)}d ${h % 24}u`
}

export default function MapClient() {
  const containerRef = useRef<HTMLDivElement>(null)
  const mapRef       = useRef<maplibregl.Map | null>(null)
  const [hours, setHours]         = useState(72)
  const [loading, setLoading]     = useState(false)
  const [detStats, setDetStats]   = useState<DetStats | null>(null)
  const [evtStats, setEvtStats]   = useState<EvtStats | null>(null)
  const [showDet, setShowDet]     = useState(true)
  const [showEvt, setShowEvt]     = useState(true)

  // ── Data laden ────────────────────────────────────────────────────────────

  const loadAll = async (map: maplibregl.Map, h: number) => {
    setLoading(true)
    try {
      const [detRes, evtRes] = await Promise.all([
        fetch(`/api/detections?hours=${h}`),
        fetch('/api/events'),
      ])
      const [detData, evtData] = await Promise.all([detRes.json(), evtRes.json()])

      // Detecties
      const detSrc = map.getSource('detections') as maplibregl.GeoJSONSource | undefined
      if (detSrc) detSrc.setData(detData)
      else { map.addSource('detections', { type: 'geojson', data: detData }); addDetLayers(map) }

      // Events
      const evtSrc = map.getSource('events') as maplibregl.GeoJSONSource | undefined
      if (evtSrc) evtSrc.setData(evtData)
      else { map.addSource('events', { type: 'geojson', data: evtData }); addEvtLayers(map) }

      const dets = detData.features as { properties: { confidence: string } }[]
      setDetStats({
        total:   dets.length,
        high:    dets.filter(f => f.properties.confidence === 'HIGH').length,
        nominal: dets.filter(f => f.properties.confidence === 'NOMINAL').length,
        low:     dets.filter(f => f.properties.confidence === 'LOW').length,
      })

      const evts = evtData.features as { properties: { status: string } }[]
      setEvtStats({
        total:     evts.length,
        active:    evts.filter(f => f.properties.status === 'ACTIVE').length,
        cooling:   evts.filter(f => f.properties.status === 'COOLING').length,
        candidate: evts.filter(f => f.properties.status === 'CANDIDATE').length,
      })
    } finally {
      setLoading(false)
    }
  }

  // ── Detectie-lagen ────────────────────────────────────────────────────────

  const addDetLayers = (map: maplibregl.Map) => {
    const layers = [
      { id: 'det-high',    conf: 'HIGH',    color: DET_COLOR.HIGH,    r: 5 },
      { id: 'det-nominal', conf: 'NOMINAL', color: DET_COLOR.NOMINAL, r: 4 },
      { id: 'det-low',     conf: 'LOW',     color: DET_COLOR.LOW,     r: 3 },
    ]
    for (const l of layers) {
      map.addLayer({
        id: l.id, type: 'circle', source: 'detections',
        filter: ['==', ['get', 'confidence'], l.conf],
        paint: {
          'circle-radius':       ['interpolate', ['linear'], ['zoom'], 4, l.r, 10, l.r * 2],
          'circle-color':        l.color,
          'circle-opacity':      l.conf === 'LOW' ? 0.45 : 0.7,
          'circle-stroke-width': 0.5,
          'circle-stroke-color': 'rgba(0,0,0,0.3)',
        },
      })
      map.on('click', l.id, (e) => {
        const p = e.features?.[0]?.properties as Record<string, unknown> | undefined
        if (!p) return
        new maplibregl.Popup({ maxWidth: '220px' })
          .setLngLat(e.lngLat)
          .setHTML(`<b>${p['source']}</b> <span style="color:${l.color}">${p['confidence']}</span><br/>
            FRP: ${p['frp'] != null ? `${p['frp']} MW` : '—'} &nbsp; ${p['daynight'] ?? ''}<br/>
            <small>${new Date(p['acquiredAt'] as string).toUTCString()}</small>`)
          .addTo(map)
      })
      map.on('mouseenter', l.id, () => { map.getCanvas().style.cursor = 'pointer' })
      map.on('mouseleave', l.id, () => { map.getCanvas().style.cursor = '' })
    }
  }

  // ── Event-lagen ───────────────────────────────────────────────────────────

  const addEvtLayers = (map: maplibregl.Map) => {
    // Hull-vulling per status
    for (const [status, color] of Object.entries(EVT_COLOR)) {
      map.addLayer({
        id: `evt-fill-${status.toLowerCase()}`,
        type: 'fill', source: 'events',
        filter: ['all',
          ['==', ['geometry-type'], 'Polygon'],
          ['==', ['get', 'status'], status],
        ],
        paint: {
          'fill-color':   color,
          'fill-opacity': 0.18,
        },
      })
      map.addLayer({
        id: `evt-outline-${status.toLowerCase()}`,
        type: 'line', source: 'events',
        filter: ['all',
          ['==', ['geometry-type'], 'Polygon'],
          ['==', ['get', 'status'], status],
        ],
        paint: {
          'line-color':   color,
          'line-width':   1.5,
          'line-opacity': 0.8,
        },
      })
    }

    // Centroid-punt voor events zonder hull (CANDIDATE of enkel-punt)
    map.addLayer({
      id: 'evt-point', type: 'circle', source: 'events',
      filter: ['==', ['geometry-type'], 'Point'],
      paint: {
        'circle-radius':       6,
        'circle-color':        ['match', ['get', 'status'],
          'ACTIVE', EVT_COLOR.ACTIVE,
          'COOLING', EVT_COLOR.COOLING,
          EVT_COLOR.CANDIDATE,
        ],
        'circle-opacity':      0.9,
        'circle-stroke-width': 2,
        'circle-stroke-color': '#fff',
      },
    })

    // Popup bij klik op hull of punt
    const clickLayers = [
      'evt-fill-active', 'evt-fill-cooling', 'evt-fill-candidate', 'evt-point',
    ]
    for (const layer of clickLayers) {
      map.on('click', layer, (e) => {
        const p = e.features?.[0]?.properties as Record<string, unknown> | undefined
        if (!p) return
        const trend = TREND_ICON[p['trend'] as keyof typeof TREND_ICON] ?? '?'
        const area  = fmtHa(p['estAreaHa'] as number | null)
        const dur   = fmtDuration(p['durationH'] as number)
        const statusColor = EVT_COLOR[p['status'] as keyof typeof EVT_COLOR] ?? '#aaa'
        new maplibregl.Popup({ maxWidth: '280px' })
          .setLngLat(e.lngLat)
          .setHTML(`
            <b>${p['name']}</b> ${trend}<br/>
            <span style="color:${statusColor}">${p['status']}</span>
            &nbsp;·&nbsp; sev <b>${p['severity']}</b>
            &nbsp;·&nbsp; ${p['countryCode'] ?? '—'}<br/>
            Oppervlak: ${area} &nbsp; Duur: ${dur}<br/>
            Detecties: ${p['detectionCount']} &nbsp; FRP: ${p['totalFrp']} MW<br/>
            <small>Laatste: ${new Date(p['lastSeen'] as string).toUTCString()}</small>
          `)
          .addTo(map)
      })
      map.on('mouseenter', layer, () => { map.getCanvas().style.cursor = 'pointer' })
      map.on('mouseleave', layer, () => { map.getCanvas().style.cursor = '' })
    }
  }

  // ── Zichtbaarheid-toggle ──────────────────────────────────────────────────

  const setLayerVisibility = (map: maplibregl.Map, prefix: string, visible: boolean) => {
    const vis = visible ? 'visible' : 'none'
    map.getStyle().layers
      .filter(l => l.id.startsWith(prefix))
      .forEach(l => map.setLayoutProperty(l.id, 'visibility', vis))
  }

  // ── Mount ─────────────────────────────────────────────────────────────────

  useEffect(() => {
    if (!containerRef.current || mapRef.current) return

    const map = new maplibregl.Map({
      container: containerRef.current,
      style: 'https://tiles.openfreemap.org/styles/dark',
      center: [0, 42], zoom: 5,
    })
    map.addControl(new maplibregl.NavigationControl(), 'top-right')
    mapRef.current = map
    map.on('load', () => loadAll(map, hours))
    return () => { map.remove(); mapRef.current = null }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const handleHoursChange = (h: number) => {
    setHours(h)
    if (mapRef.current) loadAll(mapRef.current, h)
  }

  const toggleDet = () => {
    const next = !showDet
    setShowDet(next)
    if (mapRef.current) setLayerVisibility(mapRef.current, 'det-', next)
  }

  const toggleEvt = () => {
    const next = !showEvt
    setShowEvt(next)
    if (mapRef.current) {
      setLayerVisibility(mapRef.current, 'evt-fill-', next)
      setLayerVisibility(mapRef.current, 'evt-outline-', next)
      setLayerVisibility(mapRef.current, 'evt-point', next)
    }
  }

  // ── Render ────────────────────────────────────────────────────────────────

  const btn = (label: string, active: boolean, onClick: () => void) => (
    <button onClick={onClick} style={{
      padding: '2px 8px', borderRadius: 4, border: 'none', cursor: 'pointer', fontSize: 11,
      background: active ? '#fff' : '#333', color: active ? '#000' : '#777',
    }}>{label}</button>
  )

  return (
    <div style={{ position: 'relative', width: '100%', height: `calc(100vh - ${NAV_HEIGHT}px)`, fontFamily: 'monospace' }}>
      <div ref={containerRef} style={{ width: '100%', height: '100%' }} />

      <div style={{
        position: 'absolute', top: 12, left: 12,
        background: 'rgba(10,10,10,0.84)', color: '#e5e5e5',
        padding: '10px 14px', borderRadius: 8, fontSize: 12,
        display: 'flex', flexDirection: 'column', gap: 7, minWidth: 210,
      }}>
        <div style={{ fontWeight: 'bold', fontSize: 13 }}>Wildfire — debug kaart</div>

        {/* tijdvenster detecties */}
        <div>
          <div style={{ color: '#888', marginBottom: 3 }}>Detecties (tijdvenster)</div>
          <div style={{ display: 'flex', gap: 4, flexWrap: 'wrap' }}>
            {[6, 24, 48, 72].map(h => (
              <button key={h} onClick={() => handleHoursChange(h)} style={{
                padding: '2px 8px', borderRadius: 4, border: 'none', cursor: 'pointer',
                background: hours === h ? '#fff' : '#333',
                color: hours === h ? '#000' : '#aaa', fontSize: 11,
              }}>{h}u</button>
            ))}
            {loading && <span style={{ color: '#888', alignSelf: 'center' }}>laden…</span>}
          </div>
        </div>

        {/* lagen toggles */}
        <div style={{ display: 'flex', gap: 6 }}>
          {btn('● detecties', showDet, toggleDet)}
          {btn('⬡ events',    showEvt, toggleEvt)}
        </div>

        {/* detectie-stats */}
        {detStats && showDet && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 1 }}>
            <div style={{ color: '#888' }}>Detecties: {detStats.total.toLocaleString()}</div>
            <div><span style={{ color: DET_COLOR.HIGH }}>●</span> HIGH    {detStats.high}</div>
            <div><span style={{ color: DET_COLOR.NOMINAL }}>●</span> NOMINAL {detStats.nominal}</div>
            <div><span style={{ color: DET_COLOR.LOW }}>●</span> LOW     {detStats.low}</div>
          </div>
        )}

        {/* event-stats */}
        {evtStats && showEvt && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 1 }}>
            <div style={{ color: '#888' }}>Events: {evtStats.total}</div>
            <div><span style={{ color: EVT_COLOR.ACTIVE }}>■</span> ACTIVE    {evtStats.active}</div>
            <div><span style={{ color: EVT_COLOR.COOLING }}>■</span> COOLING   {evtStats.cooling}</div>
            <div><span style={{ color: EVT_COLOR.CANDIDATE }}>■</span> CANDIDATE {evtStats.candidate}</div>
          </div>
        )}

        {/* legenda hulls */}
        {showEvt && (
          <div style={{ borderTop: '1px solid #333', paddingTop: 5, color: '#888', fontSize: 11 }}>
            Hull = convex hull detecties<br/>
            Klik op hull/punt voor details
          </div>
        )}
      </div>
    </div>
  )
}
