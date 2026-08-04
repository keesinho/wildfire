import { PLAN_LIMITS } from '@/lib/plans'

const pre: React.CSSProperties = {
  background: '#1a1a1a', border: '1px solid #333', borderRadius: 6,
  padding: '1rem', overflowX: 'auto', fontSize: '0.85rem',
}
const th: React.CSSProperties = { textAlign: 'left', borderBottom: '1px solid #444', padding: '0.4rem 0.8rem 0.4rem 0' }
const td: React.CSSProperties = { padding: '0.4rem 0.8rem 0.4rem 0', borderBottom: '1px solid #222' }
const section: React.CSSProperties = { maxWidth: 760, margin: '0 auto 2.5rem' }

const RISK_EXAMPLE = `{
  "location": { "lat": 40.5, "lon": 9.0, "countryCode": "IT", "regionId": "nuts_ITG2D" },
  "danger": {
    "today":    { "fwiClass": "extreme", "fwiValue": null },
    "forecast": [{ "date": "2026-08-05", "fwiClass": "high", "fwiValue": null }]
  },
  "nearestFire": {
    "id": "cmsenw...", "name": "Brand bij Bottidda", "slug": "2026-bottidda-...",
    "status": "COOLING", "trend": "STABLE", "severity": 75,
    "distanceKm": 10, "bearingDeg": 176
  },
  "warnings": [
    { "type": "extreme_temp", "level": "RED", "expires": "2026-08-04T17:59:00.000Z",
      "headline": "Red High-temperature Warning issued for Italy - Sardegna", "scope": "country" }
  ],
  "wind": { "temperatureC": 33.8, "windSpeedKmh": 16.7, "windDirectionDeg": 303 },
  "attribution": ["NASA FIRMS", "© European Union, Copernicus/EFFIS", "..."]
}`

const FIRES_EXAMPLE = `{
  "type": "FeatureCollection",
  "features": [{
    "type": "Feature",
    "geometry": { "type": "Polygon", "coordinates": [[...]] },
    "properties": {
      "id": "cmsenw...", "name": "Brand bij Bottidda", "slug": "2026-bottidda-...",
      "status": "ACTIVE", "severity": 75, "trend": "STABLE",
      "detectionCount": 12, "totalFrp": "340.2", "estAreaHa": 45,
      "countryCode": "IT", "durationH": 30, "lastSeen": "2026-08-04T16:00:00.000Z"
    }
  }],
  "attribution": ["NASA FIRMS", "© European Union, Copernicus/EFFIS", "..."]
}`

const FIRE_DETAIL_EXAMPLE = `{
  "id": "cmsenw...", "name": "Brand bij Bottidda", "slug": "2026-bottidda-...",
  "status": "ACTIVE", "severity": 75, "trend": "STABLE",
  "detectionCount": 12, "totalFrp": 340.2, "maxFrp": 48.1, "estAreaHa": 45,
  "countryCode": "IT", "centroid": { "lat": 40.4, "lon": 9.05 },
  "firstSeen": "2026-08-03T10:00:00.000Z", "lastSeen": "2026-08-04T16:00:00.000Z",
  "detections": [
    { "id": "cm...", "lat": 40.41, "lon": 9.06, "acquiredAt": "2026-08-04T13:51:00.000Z",
      "frp": 48.1, "confidence": "HIGH", "source": "MODIS" }
  ],
  "detectionsTruncated": false,
  "attribution": ["NASA FIRMS", "© European Union, Copernicus/EFFIS", "..."]
}`

export default function DocsPage() {
  return (
    <main style={{ padding: '2rem 1rem', fontFamily: 'sans-serif', lineHeight: 1.5 }}>
      <div style={section}>
        <h1>Wildfire API — docs</h1>
        <p>
          Real-time wildfire detections, fire-danger forecasts and official warnings for
          Europe. Get a key at <a href="/dashboard">/dashboard</a>.
        </p>
      </div>

      <div style={section}>
        <h2>Authenticatie</h2>
        <p>Elke request heeft een <code>Authorization</code>-header nodig:</p>
        <pre style={pre}><code>Authorization: Bearer wf_&lt;jouw-key&gt;</code></pre>
      </div>

      <div style={section}>
        <h2>Rate limits</h2>
        <p>Eén teller per key, per UTC-kalenderdag. Bij overschrijding: <code>429</code> met een <code>Retry-After</code>-header (seconden tot middernacht UTC).</p>
        <table>
          <thead><tr><th style={th}>Plan</th><th style={th}>Requests/dag</th></tr></thead>
          <tbody>
            {Object.entries(PLAN_LIMITS).map(([plan, limit]) => (
              <tr key={plan}><td style={td}>{plan}</td><td style={td}>{limit.toLocaleString('nl-NL')}</td></tr>
            ))}
          </tbody>
        </table>
      </div>

      <div style={section}>
        <h2>Foutcodes</h2>
        <table>
          <thead><tr><th style={th}>Status</th><th style={th}>Betekenis</th></tr></thead>
          <tbody>
            <tr><td style={td}>400</td><td style={td}>Ontbrekende/ongeldige parameters</td></tr>
            <tr><td style={td}>401</td><td style={td}>Ontbrekende of onbekende API-key</td></tr>
            <tr><td style={td}>404</td><td style={td}>Onbekend fire-event id/slug</td></tr>
            <tr><td style={td}>429</td><td style={td}>Daglimiet bereikt voor je plan</td></tr>
          </tbody>
        </table>
      </div>

      <div style={section}>
        <h2><code>GET /api/v1/risk</code></h2>
        <p>Brandrisico voor één punt: regio, fire-danger (vandaag + forecast), dichtstbijzijnde actieve brand, actieve waarschuwingen, wind/temperatuur.</p>
        <table>
          <thead><tr><th style={th}>Param</th><th style={th}>Type</th><th style={th}>Verplicht</th></tr></thead>
          <tbody>
            <tr><td style={td}>lat</td><td style={td}>float</td><td style={td}>ja</td></tr>
            <tr><td style={td}>lon</td><td style={td}>float</td><td style={td}>ja</td></tr>
          </tbody>
        </table>
        <p>Voorbeeld:</p>
        <pre style={pre}><code>{`curl -H "Authorization: Bearer wf_..." \\
  "https://<host>/api/v1/risk?lat=40.5&lon=9.0"`}</code></pre>
        <pre style={pre}><code>{RISK_EXAMPLE}</code></pre>
      </div>

      <div style={section}>
        <h2><code>GET /api/v1/fires</code></h2>
        <p>GeoJSON FeatureCollection van fire-events, optioneel gefilterd op regio en status.</p>
        <table>
          <thead><tr><th style={th}>Param</th><th style={th}>Type</th><th style={th}>Verplicht</th></tr></thead>
          <tbody>
            <tr><td style={td}>bbox</td><td style={td}>west,south,east,north</td><td style={td}>nee</td></tr>
            <tr><td style={td}>status</td><td style={td}>CANDIDATE / ACTIVE / COOLING / CLOSED</td><td style={td}>nee (standaard: alles behalve CLOSED)</td></tr>
          </tbody>
        </table>
        <p>Voorbeeld:</p>
        <pre style={pre}><code>{`curl -H "Authorization: Bearer wf_..." \\
  "https://<host>/api/v1/fires?bbox=-10,36,10,48&status=ACTIVE"`}</code></pre>
        <pre style={pre}><code>{FIRES_EXAMPLE}</code></pre>
      </div>

      <div style={section}>
        <h2><code>GET /api/v1/fires/:id</code></h2>
        <p>Detail van één fire-event (id of slug) inclusief de meest recente 200 detecties.</p>
        <p>Voorbeeld:</p>
        <pre style={pre}><code>{`curl -H "Authorization: Bearer wf_..." \\
  "https://<host>/api/v1/fires/2026-bottidda-n1xf0zrc"`}</code></pre>
        <pre style={pre}><code>{FIRE_DETAIL_EXAMPLE}</code></pre>
      </div>

      <div style={section}>
        <h2>Attributie</h2>
        <p>
          Elke response bevat een <code>attribution</code>-veld — verplicht doorvertalen naar
          je eigen gebruikers (NASA FIRMS, Copernicus/EFFIS, MeteoAlarm, Eurostat GISCO,
          Open-Meteo). Dit is geen officieel waarschuwingsplatform: volg altijd lokale
          autoriteiten.
        </p>
      </div>
    </main>
  )
}
