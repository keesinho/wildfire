import { prisma } from '@wildfire/db'

export const dynamic = 'force-dynamic'

async function confirm(token: string | undefined): Promise<'ok' | 'invalid'> {
  if (!token) return 'invalid'

  const sub = await prisma.subscription.findUnique({ where: { confirmToken: token } })
  if (!sub) return 'invalid'

  await prisma.subscription.update({
    where: { id: sub.id },
    data:  { active: true, confirmToken: null },
  })
  return 'ok'
}

export default async function ConfirmPage({ searchParams }: { searchParams: Promise<{ token?: string }> }) {
  const { token } = await searchParams
  const result = await confirm(token)

  return (
    <main style={{ padding: '3rem 1rem', fontFamily: 'sans-serif', textAlign: 'center' }}>
      {result === 'ok' ? (
        <>
          <h1>Inschrijving bevestigd</h1>
          <p>Je ontvangt vanaf nu brandwaarschuwingen voor je opgegeven locatie.</p>
        </>
      ) : (
        <>
          <h1>Ongeldige of al gebruikte link</h1>
          <p>Deze bevestigingslink is niet (meer) geldig. Schrijf je opnieuw in op <a href="/">de homepage</a>.</p>
        </>
      )}
    </main>
  )
}
