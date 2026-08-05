/**
 * Verzending: Resend (e-mail) en webhook-POST met retry + backoff.
 * Plain fetch, geen Resend-SDK — zelfde stijl als de rest van dit project.
 */

const RESEND_FROM = 'Wildfire Alerts <alerts@vuuralert.nl>'

export async function sendEmail(to: string, subject: string, text: string): Promise<boolean> {
  const apiKey = process.env.RESEND_API_KEY
  if (!apiKey) {
    console.error('[notify] RESEND_API_KEY ontbreekt — e-mail niet verstuurd')
    return false
  }

  try {
    const res = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ from: RESEND_FROM, to: [to], subject, text }),
    })
    if (!res.ok) {
      console.error(`[notify] e-mail mislukt: HTTP ${res.status} ${await res.text()}`)
      return false
    }
    return true
  } catch (err) {
    console.error('[notify] e-mail fetch mislukt:', err)
    return false
  }
}

const WEBHOOK_BACKOFF_MS = [1_000, 4_000, 16_000]

/**
 * POST naar een webhook-URL met 3 pogingen en exponentiële backoff.
 * Geen retry over cron-runs heen (geen queue in dit project) — een
 * mislukte send wordt gelogd; de volgende event-statuswijziging levert
 * vanzelf een nieuwe poging op.
 */
export async function sendWebhook(url: string, payload: unknown): Promise<boolean> {
  for (let attempt = 0; attempt < WEBHOOK_BACKOFF_MS.length; attempt++) {
    try {
      const res = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
        signal: AbortSignal.timeout(10_000),
      })
      if (res.ok) return true
      console.error(`[notify] webhook ${url} → HTTP ${res.status} (poging ${attempt + 1}/${WEBHOOK_BACKOFF_MS.length})`)
    } catch (err) {
      console.error(`[notify] webhook ${url} mislukt (poging ${attempt + 1}/${WEBHOOK_BACKOFF_MS.length}):`, err)
    }

    if (attempt < WEBHOOK_BACKOFF_MS.length - 1) {
      await new Promise(resolve => setTimeout(resolve, WEBHOOK_BACKOFF_MS[attempt]))
    }
  }
  return false
}
