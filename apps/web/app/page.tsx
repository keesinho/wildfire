import { headers } from 'next/headers'
import { ATTRIBUTION } from '@/lib/attribution'

export const dynamic = 'force-dynamic'

const section: React.CSSProperties = { maxWidth: 760, margin: '0 auto 3rem', padding: '0 1rem' }
const box: React.CSSProperties = {
  maxWidth: 480, margin: '0 auto', padding: '1.5rem',
  border: '1px solid #333', borderRadius: 8, textAlign: 'center',
}
const buttonRow: React.CSSProperties = {
  display: 'flex', flexWrap: 'wrap', gap: '0.75rem', justifyContent: 'center', marginTop: '1.5rem',
}
const primaryButton: React.CSSProperties = {
  padding: '0.6rem 1.25rem', background: '#ef4444', color: '#fff', border: 'none',
  borderRadius: 4, textDecoration: 'none', fontWeight: 'bold',
}
const secondaryButton: React.CSSProperties = {
  padding: '0.6rem 1.25rem', background: '#1a1a1a', color: '#eee', border: '1px solid #555',
  borderRadius: 4, textDecoration: 'none',
}
const stepGrid: React.CSSProperties = {
  display: 'flex', flexWrap: 'wrap', gap: '1rem', justifyContent: 'center',
}
const stepCard: React.CSSProperties = {
  flex: '1 1 220px', maxWidth: 260, padding: '1.25rem',
  border: '1px solid #333', borderRadius: 8,
}
const pre: React.CSSProperties = {
  background: '#1a1a1a', border: '1px solid #333', borderRadius: 6,
  padding: '1rem', overflowX: 'auto', fontSize: '0.85rem', textAlign: 'left',
}
const muted: React.CSSProperties = { color: '#aaa', fontSize: '0.85rem' }

/**
 * Zelfde patroon als /demo: server-side call met de DEMO_API_KEY, zodat de
 * teller op echte API-data draait (en de key nooit naar de browser gaat).
 */
async function fetchActiveFireCount(): Promise<number | null> {
  const demoKey = process.env.DEMO_API_KEY
  if (!demoKey) return null

  const h     = await headers()
  const host  = h.get('host') ?? 'localhost:3000'
  const proto = h.get('x-forwarded-proto') ?? 'http'

  try {
    const res = await fetch(`${proto}://${host}/api/v1/fires?status=ACTIVE`, {
      headers: { Authorization: `Bearer ${demoKey}` },
      cache:   'no-store',
    })
    if (!res.ok) return null
    const geojson = await res.json()
    return Array.isArray(geojson.features) ? geojson.features.length : null
  } catch {
    return null
  }
}

export default async function Home() {
  const count = await fetchActiveFireCount()
  const sources    = ATTRIBUTION.slice(0, -1)
  const disclaimer = ATTRIBUTION[ATTRIBUTION.length - 1]

  return (
    <main style={{
      padding: '3rem 1rem', fontFamily: 'sans-serif', lineHeight: 1.5,
      background: '#0a0a0a', color: '#e5e5e5', minHeight: '100vh',
    }}>
      {/* 1. Hero */}
      <div style={{ ...section, textAlign: 'center' }}>
        <h1 style={{ marginBottom: '0.5rem' }}>Vuuralert</h1>
        <p style={{ maxWidth: 560, margin: '0 auto', color: '#ccc' }}>
          Actuele brandhaarden in Europa, opgebouwd uit satellietdata en officiële
          waarschuwingen — te bekijken op de kaart, per e-mail of via een API.
        </p>
        <div style={buttonRow}>
          <a href="/alerts" style={primaryButton}>Ontvang meldingen per e-mail</a>
          <a href="/demo" style={secondaryButton}>Bekijk de live demo</a>
        </div>
      </div>

      {/* 2. Live teller */}
      <div style={section}>
        <div style={box}>
          <div style={{ fontSize: '0.85rem', color: '#aaa', textTransform: 'uppercase', letterSpacing: '0.05em' }}>
            Actieve branden nu
          </div>
          <div style={{ fontSize: '3rem', fontWeight: 'bold', margin: '0.25rem 0' }}>
            {count ?? '—'}
          </div>
          <p style={{ ...muted, margin: '0 0 1rem' }}>
            {count === null
              ? 'Actuele telling tijdelijk niet beschikbaar.'
              : 'op basis van de meest recente satellietdetecties, via /api/v1/fires.'}
          </p>
          <a href="/demo" style={{ color: '#f97316' }}>Bekijk ze op de kaart →</a>
        </div>
      </div>

      {/* 3. Hoe het werkt */}
      <div style={section}>
        <h2 style={{ textAlign: 'center', marginBottom: '1.5rem' }}>Hoe het werkt</h2>
        <div style={stepGrid}>
          <div style={stepCard}>
            <div style={{ color: '#f97316', fontWeight: 'bold', marginBottom: '0.5rem' }}>1. Geef je locatie op</div>
            <p style={muted}>
              Adres of coördinaten, plus de straal die je wilt bewaken.
            </p>
          </div>
          <div style={stepCard}>
            <div style={{ color: '#f97316', fontWeight: 'bold', marginBottom: '0.5rem' }}>2. Wij monitoren continu</div>
            <p style={muted}>
              Satellieten scannen Europa meerdere keren per dag op hittesignalen.
            </p>
          </div>
          <div style={stepCard}>
            <div style={{ color: '#f97316', fontWeight: 'bold', marginBottom: '0.5rem' }}>3. Je krijgt bericht</div>
            <p style={muted}>
              Een e-mail met afstand, richting, windrichting en het actuele brandgevaar.
            </p>
          </div>
        </div>
      </div>

      {/* 4. Voor ontwikkelaars */}
      <div style={section}>
        <div style={{ ...box, textAlign: 'left', maxWidth: 560 }}>
          <h2 style={{ marginTop: 0 }}>Voor ontwikkelaars</h2>
          <p style={muted}>
            Dezelfde data staat als JSON beschikbaar via een REST-API — inclusief brandevents,
            fire-danger per locatie en officiële waarschuwingen.
          </p>
          <pre style={pre}><code>{`curl -H "Authorization: Bearer wf_..." \\
  "https://<host>/api/v1/fires?status=ACTIVE"`}</code></pre>
          <p style={{ margin: 0 }}>
            <a href="/docs" style={{ color: '#f97316' }}>Volledige documentatie →</a>
            {' · '}
            <a href="/dashboard" style={{ color: '#f97316' }}>Maak een gratis API-key aan →</a>
          </p>
        </div>
      </div>

      {/* 5. Bronvermelding & disclaimer */}
      <div style={{ ...section, textAlign: 'center', marginBottom: 0 }}>
        <p style={muted}>Bronnen: {sources.join(' · ')}.</p>
        <p style={{ ...muted, marginTop: '0.5rem' }}>{disclaimer}.</p>
      </div>
    </main>
  )
}
