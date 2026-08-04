'use client'
import { useState } from 'react'

const box: React.CSSProperties = {
  maxWidth: 480, margin: '0 auto 2rem', padding: '1.5rem',
  border: '1px solid #333', borderRadius: 8,
}
const input: React.CSSProperties = {
  width: '100%', padding: '0.5rem', marginTop: '0.5rem', marginBottom: '0.75rem',
  background: '#111', color: '#eee', border: '1px solid #444', borderRadius: 4,
}
const button: React.CSSProperties = {
  padding: '0.5rem 1rem', background: '#ef4444', color: '#fff', border: 'none',
  borderRadius: 4, cursor: 'pointer',
}
const keyBox: React.CSSProperties = {
  marginTop: '1rem', padding: '0.75rem', background: '#1a1a1a', border: '1px solid #444',
  borderRadius: 4, fontFamily: 'monospace', fontSize: '0.9rem', wordBreak: 'break-all',
}

function SignupForm() {
  const [email, setEmail]     = useState('')
  const [result, setResult]   = useState<{ apiKey: string; plan: string; dailyLimit: number } | null>(null)
  const [error, setError]     = useState<string | null>(null)
  const [loading, setLoading] = useState(false)

  async function submit(e: React.FormEvent) {
    e.preventDefault()
    setLoading(true); setError(null); setResult(null)
    try {
      const res  = await fetch('/api/signup', {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ email }),
      })
      const data = await res.json()
      if (!res.ok) setError(data.error ?? 'Onbekende fout')
      else setResult(data)
    } catch {
      setError('Netwerkfout — probeer het opnieuw')
    } finally {
      setLoading(false)
    }
  }

  return (
    <div style={box}>
      <h2>Get an API key</h2>
      <form onSubmit={submit}>
        <label>
          E-mailadres
          <input style={input} type="email" required value={email}
                 onChange={e => setEmail(e.target.value)} placeholder="you@example.com" />
        </label>
        <button style={button} type="submit" disabled={loading}>
          {loading ? 'Bezig…' : 'Maak API-key aan'}
        </button>
      </form>
      {error && <p style={{ color: '#ef4444' }}>{error}</p>}
      {result && (
        <div style={keyBox}>
          <div>{result.apiKey}</div>
          <p style={{ color: '#f97316', fontSize: '0.85rem', marginTop: '0.5rem' }}>
            Bewaar deze key nu — hij wordt niet nogmaals getoond.
            Plan: {result.plan} ({result.dailyLimit} requests/dag)
          </p>
        </div>
      )}
    </div>
  )
}

function UsageForm() {
  const [apiKey, setApiKey]   = useState('')
  const [result, setResult]   = useState<{ plan: string; dailyLimit: number; usedToday: number } | null>(null)
  const [error, setError]     = useState<string | null>(null)
  const [loading, setLoading] = useState(false)

  async function submit(e: React.FormEvent) {
    e.preventDefault()
    setLoading(true); setError(null); setResult(null)
    try {
      const res  = await fetch('/api/usage', {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ apiKey }),
      })
      const data = await res.json()
      if (!res.ok) setError(data.error ?? 'Onbekende fout')
      else setResult(data)
    } catch {
      setError('Netwerkfout — probeer het opnieuw')
    } finally {
      setLoading(false)
    }
  }

  return (
    <div style={box}>
      <h2>Check usage</h2>
      <form onSubmit={submit}>
        <label>
          API-key
          <input style={input} type="text" required value={apiKey}
                 onChange={e => setApiKey(e.target.value)} placeholder="wf_…" />
        </label>
        <button style={button} type="submit" disabled={loading}>
          {loading ? 'Bezig…' : 'Bekijk gebruik'}
        </button>
      </form>
      {error && <p style={{ color: '#ef4444' }}>{error}</p>}
      {result && (
        <div style={keyBox}>
          Plan: {result.plan}<br />
          Vandaag gebruikt: {result.usedToday} / {result.dailyLimit}
        </div>
      )}
    </div>
  )
}

export default function DashboardPage() {
  return (
    <main style={{ padding: '2rem 1rem', fontFamily: 'sans-serif' }}>
      <h1 style={{ textAlign: 'center' }}>Wildfire API — dashboard</h1>
      <SignupForm />
      <UsageForm />
    </main>
  )
}
