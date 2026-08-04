import { prisma } from '@wildfire/db'

export const dynamic = 'force-dynamic'

async function unsubscribe(token: string | undefined): Promise<'ok' | 'invalid'> {
  if (!token) return 'invalid'

  const sub = await prisma.subscription.findUnique({ where: { unsubscribeToken: token } })
  if (!sub) return 'invalid'

  await prisma.subscription.update({ where: { id: sub.id }, data: { active: false } })
  return 'ok'
}

export default async function UnsubscribePage({ searchParams }: { searchParams: Promise<{ token?: string }> }) {
  const { token } = await searchParams
  const result = await unsubscribe(token)

  return (
    <main style={{ padding: '3rem 1rem', fontFamily: 'sans-serif', textAlign: 'center' }}>
      {result === 'ok' ? (
        <>
          <h1>Uitgeschreven</h1>
          <p>Je ontvangt geen brandwaarschuwingen meer voor deze inschrijving.</p>
        </>
      ) : (
        <>
          <h1>Ongeldige link</h1>
          <p>Deze uitschrijflink is niet geldig.</p>
        </>
      )}
    </main>
  )
}
