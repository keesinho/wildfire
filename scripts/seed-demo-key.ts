/**
 * Provisioneert één vaste API-key voor de publieke demo-kaartpagina
 * (apps/web/app/demo/page.tsx). Plan "pro" zodat de demo nooit 429't door
 * echt bezoekersverkeer. Idempotent: als er al een demo-key bestaat
 * (herkenbaar aan ownerMail) wordt er geen tweede aangemaakt — de ruwe key
 * is dan al eerder getoond en moet al in .env staan.
 *
 *   pnpm seed:demo-key
 */
import 'dotenv/config'
import { randomBytes, createHash } from 'node:crypto'
import { prisma } from '@wildfire/db'

const DEMO_OWNER_MAIL = 'demo@wildfire.internal'

function generateApiKey(): string {
  return `wf_${randomBytes(24).toString('base64url')}`
}

function hashKey(raw: string): string {
  return createHash('sha256').update(raw).digest('hex')
}

async function main() {
  const existing = await prisma.apiKey.findFirst({ where: { ownerMail: DEMO_OWNER_MAIL } })

  if (existing) {
    console.log('[seed-demo-key] demo-key bestaat al (aangemaakt op ' + existing.createdAt.toISOString() + ').')
    console.log('[seed-demo-key] de ruwe key is niet opnieuw op te vragen — als DEMO_API_KEY in .env kwijt is,')
    console.log('[seed-demo-key] verwijder deze ApiKey-rij handmatig en draai dit script opnieuw.')
    return
  }

  const raw = generateApiKey()
  await prisma.apiKey.create({
    data: { keyHash: hashKey(raw), ownerMail: DEMO_OWNER_MAIL, plan: 'pro' },
  })

  console.log('[seed-demo-key] demo-key aangemaakt (plan: pro).')
  console.log('[seed-demo-key] zet deze regel in .env — hij wordt niet nog een keer getoond:\n')
  console.log(`DEMO_API_KEY=${raw}`)
}

main()
  .catch((err) => { console.error('[seed-demo-key] fatal:', err); process.exit(1) })
  .finally(() => prisma.$disconnect())
