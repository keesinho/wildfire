import type { Metadata } from 'next'

export const metadata: Metadata = {
  title: 'Wildfire',
  description: 'Real-time wildfire monitoring for Europe',
}

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="nl">
      <body>{children}</body>
    </html>
  )
}
