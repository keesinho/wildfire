/**
 * Herstelscript: herbereken elk bestaand FireEvent opnieuw via recalculateEvent().
 *
 * Nodig omdat clusterAndRecalculate() vroeger één mislukte recalculatie liet
 * cascaderen: een enkele fout in de herbereken-loop brak de hele batch af, en
 * events die daardoor werden overgeslagen kregen nooit een nieuwe kans (alleen
 * een NIEUWE detectie in de buurt triggert opnieuw herberekening). Gevolg:
 * events met totalFrp=0/detectionCount=0/name=null/countryCode=null die dat
 * voor altijd bleven, óók als ze in werkelijkheid tientallen detecties hadden
 * — en dus een te lage severity, waardoor een echte brand onder de alert-
 * drempel bleef en geen melding opleverde. clusterAndRecalculate() vangt die
 * fout nu per event af (zie cluster.ts), maar bestaande kapotte events
 * repareert dat niet met terugwerkende kracht — vandaar dit script.
 *
 * Gebruik: pnpm --filter worker repair
 */
import 'dotenv/config'
import { prisma } from '@wildfire/db'
import { recalculateEvent } from './cluster.js'

async function main() {
  const events = await prisma.$queryRaw<{ id: string }[]>`SELECT id FROM "FireEvent" ORDER BY "createdAt" ASC`
  console.log(`[repair] ${events.length} events te herberekenen…`)

  let ok = 0
  const failed: { id: string; error: string }[] = []

  for (let i = 0; i < events.length; i++) {
    const { id } = events[i]
    try {
      await recalculateEvent(id)
      ok++
    } catch (err) {
      failed.push({ id, error: err instanceof Error ? err.message : String(err) })
    }
    if ((i + 1) % 25 === 0 || i === events.length - 1) {
      process.stdout.write(`\r[repair] ${i + 1}/${events.length}  ok: ${ok}  mislukt: ${failed.length}   `)
    }
  }
  console.log()

  if (failed.length > 0) {
    console.log(`[repair] ${failed.length} events konden niet herberekend worden:`)
    for (const f of failed.slice(0, 20)) console.log(`  ${f.id}: ${f.error}`)
    if (failed.length > 20) console.log(`  … en ${failed.length - 20} meer`)
  }

  console.log(`[repair] klaar — ${ok}/${events.length} succesvol herberekend`)
}

main()
  .catch((err) => { console.error('[repair] fatal:', err); process.exit(1) })
  .finally(() => prisma.$disconnect())
