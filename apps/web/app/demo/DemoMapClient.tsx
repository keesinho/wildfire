'use client'
import { useEffect, useRef } from 'react'
import maplibregl from 'maplibre-gl'
import 'maplibre-gl/dist/maplibre-gl.css'
import { NAV_HEIGHT } from '../Nav'

const EVT_COLOR = { ACTIVE: '#ef4444', COOLING: '#f97316', CANDIDATE: '#6b7280' }

const STATUS_LABEL: Record<string, string> = {
  ACTIVE:    'Actief',
  COOLING:   'Afkoelend — geen nieuwe detecties',
  CANDIDATE: 'Niet bevestigd',
}

/**
 * Iets donkerder dan EVT_COLOR (die is afgestemd op de donkere kaart-overlays),
 * zodat statustekst op de witte popup-achtergrond van MapLibre genoeg contrast heeft.
 */
const STATUS_TEXT_COLOR: Record<string, string> = {
  ACTIVE: '#b91c1c', COOLING: '#9a3412', CANDIDATE: '#4b5563',
}
const LABEL_COLOR = '#666'
const VALUE_COLOR = '#111'
const UNNAMED_PLACEHOLDER = '(onbekend)'
const UNNAMED_TEXT = 'Nieuwe detectie — locatie wordt bepaald'

const HEAT_TOOLTIP =
  'Hoeveel warmte de satelliet op deze plek meet — een indicatie van intensiteit, geen directe temperatuurmeting.'

/** Banden uit apps/worker/src/cluster.ts: het cijfer zelf is intern en te precies om te tonen. */
function severityLabel(severity: number): string {
  if (severity >= 75) return 'Extreem'
  if (severity >= 50) return 'Hoog'
  if (severity >= 20) return 'Middel'
  return 'Laag'
}

function fmtHa(ha: number): string {
  return ha >= 10_000 ? `${(ha / 10_000).toFixed(1)} kha` : `${ha.toLocaleString()} ha`
}

function fmtDateNl(iso: string): string {
  return new Date(iso).toLocaleString('nl-NL', {
    day: 'numeric', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit',
  })
}

interface Props {
  initialData: GeoJSON.FeatureCollection
  error: boolean
}

/**
 * Kaart voor de publieke demo-pagina — toont data die écht via /api/v1/fires
 * binnenkwam (server-side, met de demo-key). Alleen de event-hulls, geen
 * losse detecties/debug-controls: dit is bewijsmateriaal, geen debug-tool
 * (die blijft op /map staan).
 */
export default function DemoMapClient({ initialData, error }: Props) {
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
          const status       = p['status'] as keyof typeof EVT_COLOR
          const statusColor = STATUS_TEXT_COLOR[status] ?? LABEL_COLOR
          const statusLabel = STATUS_LABEL[status] ?? String(p['status'])
          const sevLabel    = severityLabel(Number(p['severity']))
          const areaHa      = p['estAreaHa'] as number | null
          const heatMwValue = Number(p['totalFrp'])
          const name        = p['name'] === UNNAMED_PLACEHOLDER ? UNNAMED_TEXT : String(p['name'])

          const label = (text: string) => `<span style="color:${LABEL_COLOR}">${text}</span>`
          const value = (html: string) => `<span style="color:${VALUE_COLOR}">${html}</span>`

          const lines = [
            `<span style="color:${statusColor}; font-weight:600;">${statusLabel}</span>`,
            `${label('Ernst:')} ${value(`<b>${sevLabel}</b>`)} &nbsp;·&nbsp; ${value(String(p['countryCode'] ?? '—'))}`,
          ]
          if (areaHa) lines.push(`${label('Oppervlak:')} ${value(fmtHa(areaHa))}`)
          if (heatMwValue > 0) {
            const heatMw = String(p['totalFrp']).replace('.', ',')
            lines.push(
              `<span title="${HEAT_TOOLTIP}" style="color:${LABEL_COLOR}; border-bottom:1px dotted #999; cursor:help;">Warmte-uitstoot:</span> ${value(`${heatMw} MW`)}`,
            )
          }
          lines.push(`${label('Eerst gezien:')} ${value(fmtDateNl(p['firstSeen'] as string))}`)
          lines.push(`${label('Laatst gezien:')} ${value(fmtDateNl(p['lastSeen'] as string))}`)

          new maplibregl.Popup({ maxWidth: '280px' })
            .setLngLat(e.lngLat)
            .setHTML(`<div style="color:${VALUE_COLOR}"><b>${name}</b><br/>${lines.join('<br/>')}</div>`)
            .addTo(map)
        })
        map.on('mouseenter', layer, () => { map.getCanvas().style.cursor = 'pointer' })
        map.on('mouseleave', layer, () => { map.getCanvas().style.cursor = '' })
      }
    })

    return () => { map.remove(); mapRef.current = null }
  }, [initialData])

  return (
    <div style={{ position: 'relative', width: '100%', height: `calc(100vh - ${NAV_HEIGHT}px)`, fontFamily: 'monospace' }}>
      <div ref={containerRef} style={{ width: '100%', height: '100%' }} />
      {error && (
        <div style={{
          position: 'absolute', top: 12, left: '50%', transform: 'translateX(-50%)',
          background: 'rgba(127,29,29,0.92)', color: '#fff',
          padding: '8px 16px', borderRadius: 8, fontSize: 13, fontFamily: 'monospace',
          zIndex: 10,
        }}>
          Kaartdata tijdelijk niet beschikbaar
        </div>
      )}
      <div style={{
        position: 'absolute', top: 12, left: 12,
        background: 'rgba(10,10,10,0.84)', color: '#e5e5e5',
        padding: '10px 14px', borderRadius: 8, fontSize: 12, maxWidth: 240,
      }}>
        <div style={{ fontWeight: 'bold', fontSize: 13, marginBottom: 4 }}>Vuuralert — live demo</div>
        <div style={{ color: '#aaa' }}>
          Deze data komt binnen via <code>GET /api/v1/fires</code> — dezelfde publieke API die
          je op <a href="/dashboard" style={{ color: '#f97316' }}>/dashboard</a> een key voor kunt maken.
        </div>
      </div>
      <div style={{
        position: 'absolute', bottom: 12, left: 12,
        background: 'rgba(10,10,10,0.84)', color: '#e5e5e5',
        padding: '8px 14px', borderRadius: 8, fontSize: 12,
      }}>
        <span style={{ color: EVT_COLOR.ACTIVE }}>■</span> Actief &nbsp;
        <span style={{ color: EVT_COLOR.COOLING }}>■</span> Afkoelend &nbsp;
        <span style={{ color: EVT_COLOR.CANDIDATE }}>■</span> Niet bevestigd
      </div>
    </div>
  )
}
