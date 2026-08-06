'use client'
import { useState } from 'react'

/** Vaste hoogte i.v.m. de kaartpagina's (/map, /demo), die er `calc(100vh - NAV_HEIGHT)` mee reserveren. */
export const NAV_HEIGHT = 56

const LINKS = [
  { href: '/demo',      label: 'Kaart' },
  { href: '/alerts',    label: 'Meldingen' },
  { href: '/dashboard', label: 'API' },
  { href: '/docs',      label: 'Docs' },
]

const linkStyle: React.CSSProperties = { color: '#ccc', textDecoration: 'none', fontSize: '0.95rem' }

export default function Nav() {
  const [open, setOpen] = useState(false)

  return (
    <nav style={{
      position: 'relative', zIndex: 30, height: NAV_HEIGHT,
      display: 'flex', alignItems: 'center', justifyContent: 'space-between',
      padding: '0 1rem', background: '#0a0a0a', borderBottom: '1px solid #222',
    }}>
      <a href="/" style={{ color: '#fff', fontWeight: 700, textDecoration: 'none', fontSize: '1.2rem' }}>
        Vuuralert
      </a>

      <div className="nav-links" style={{ display: 'flex', gap: '1.5rem' }}>
        {LINKS.map(l => <a key={l.href} href={l.href} style={linkStyle}>{l.label}</a>)}
      </div>

      <button
        className="nav-toggle"
        onClick={() => setOpen(o => !o)}
        aria-label="Menu"
        aria-expanded={open}
        style={{
          display: 'none', background: 'transparent', border: '1px solid #444', borderRadius: 4,
          color: '#e5e5e5', width: 36, height: 32, cursor: 'pointer', fontSize: 16,
        }}
      >
        ☰
      </button>

      {open && (
        <div style={{
          position: 'absolute', top: NAV_HEIGHT, left: 0, right: 0,
          background: '#0a0a0a', borderBottom: '1px solid #222',
          display: 'flex', flexDirection: 'column', padding: '0.25rem 1rem 0.75rem',
        }}>
          {LINKS.map(l => (
            <a key={l.href} href={l.href} style={{ ...linkStyle, padding: '0.6rem 0' }} onClick={() => setOpen(false)}>
              {l.label}
            </a>
          ))}
        </div>
      )}

      <style>{`
        @media (max-width: 640px) {
          .nav-links { display: none !important; }
          .nav-toggle { display: inline-flex !important; align-items: center; justify-content: center; }
        }
      `}</style>
    </nav>
  )
}
