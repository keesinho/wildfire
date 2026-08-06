import type { Metadata } from 'next'
import Nav from './Nav'

export const metadata: Metadata = {
  title: 'Vuuralert',
  description: 'Real-time wildfire monitoring for Europe',
}

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="nl">
      <body style={{ margin: 0, background: '#0a0a0a', color: '#e5e5e5', fontFamily: 'sans-serif' }}>
        <Nav />
        {children}
      </body>
    </html>
  )
}
