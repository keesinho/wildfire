'use client'
import { useState } from 'react'

const box: React.CSSProperties = {
  maxWidth: 480, margin: '0 auto 1.5rem', padding: '1.5rem',
  border: '1px solid #333', borderRadius: 8,
}
const input: React.CSSProperties = {
  width: '100%', padding: '0.5rem', marginTop: '0.5rem', marginBottom: '0.75rem',
  background: '#111', color: '#eee', border: '1px solid #444', borderRadius: 4,
}
const labelStyle: React.CSSProperties = { display: 'block', marginTop: '0.75rem' }
const button: React.CSSProperties = {
  padding: '0.5rem 1rem', background: '#ef4444', color: '#fff', border: 'none',
  borderRadius: 4, cursor: 'pointer',
}

// "52.37, 4.90" of "52.37 4.90" — twee getallen, komma/spatie gescheiden.
const COORD_RE = /^(-?\d+(?:\.\d+)?)\s*[,;]?\s+(-?\d+(?:\.\d+)?)$/

async function resolveLocation(raw: string): Promise<{ lat: number; lon: number }> {
  const trimmed = raw.trim()
  const match = COORD_RE.exec(trimmed)

  if (match) {
    const lat = Number(match[1])
    const lon = Number(match[2])
    if (lat < -90 || lat > 90) throw new Error('Breedtegraad moet tussen -90 en 90 liggen')
    if (lon < -180 || lon > 180) throw new Error('Lengtegraad moet tussen -180 en 180 liggen')
    return { lat, lon }
  }

  const res  = await fetch(`/api/geocode?q=${encodeURIComponent(trimmed)}`)
  const data = await res.json()
  if (!res.ok) throw new Error(data.error ?? 'Locatie niet gevonden')
  return { lat: data.lat, lon: data.lon }
}

export default function AlertsPage() {
  const [email, setEmail]       = useState('')
  const [location, setLocation] = useState('')
  const [radiusKm, setRadiusKm] = useState(30)
  const [labelText, setLabelText] = useState('')
  const [message, setMessage]   = useState<string | null>(null)
  const [error, setError]       = useState<string | null>(null)
  const [loading, setLoading]   = useState(false)

  async function submit(e: React.FormEvent) {
    e.preventDefault()
    setLoading(true); setError(null); setMessage(null)
    try {
      const { lat, lon } = await resolveLocation(location)
      const res  = await fetch('/api/subscribe', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email, lat, lon, radiusKm, label: labelText || undefined }),
      })
      const data = await res.json()
      if (!res.ok) setError(data.error ?? 'Onbekende fout')
      else setMessage(data.message ?? 'Check je inbox om je inschrijving te bevestigen.')
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Netwerkfout — probeer het opnieuw')
    } finally {
      setLoading(false)
    }
  }

  return (
    <main style={{ padding: '2rem 1rem', fontFamily: 'sans-serif' }}>
      <h1 style={{ textAlign: 'center' }}>Brandwaarschuwingen per e-mail</h1>
      <p style={{ maxWidth: 480, margin: '0 auto 1.5rem', textAlign: 'center', color: '#aaa' }}>
        Schrijf je in en krijg een melding zodra er een brand wordt gedetecteerd binnen jouw straal.
      </p>

      <div style={box}>
        <form onSubmit={submit}>
          <label style={labelStyle}>
            E-mailadres
            <input style={input} type="email" required value={email}
                   onChange={e => setEmail(e.target.value)} placeholder="jij@voorbeeld.nl" />
          </label>

          <label style={labelStyle}>
            Locatie (adres of coördinaten)
            <input style={input} type="text" required value={location}
                   onChange={e => setLocation(e.target.value)}
                   placeholder="bv. Alicante, Spanje of 38.34, -0.48" />
          </label>

          <label style={labelStyle}>
            Straal (km)
            <input style={input} type="number" min={1} max={200} required value={radiusKm}
                   onChange={e => setRadiusKm(Number(e.target.value))} />
          </label>

          <label style={labelStyle}>
            Label (optioneel)
            <input style={input} type="text" maxLength={80} value={labelText}
                   onChange={e => setLabelText(e.target.value)} placeholder="bv. Vakantiehuis" />
          </label>

          <button style={button} type="submit" disabled={loading}>
            {loading ? 'Bezig…' : 'Inschrijven'}
          </button>
        </form>

        {error && <p style={{ color: '#ef4444' }}>{error}</p>}
        {message && <p style={{ color: '#22c55e' }}>{message}</p>}
      </div>

      <p style={{ maxWidth: 480, margin: '0 auto', fontSize: '0.8rem', color: '#888', textAlign: 'center' }}>
        Dit is geen officieel waarschuwingsplatform — volg bij gevaar altijd de instructies van
        lokale autoriteiten. Je kunt je op elk moment uitschrijven via de link onderaan elke e-mail.
      </p>
    </main>
  )
}
