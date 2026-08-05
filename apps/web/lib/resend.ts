/**
 * Plain fetch naar de Resend REST-API — geen SDK, zelfde stijl als alle
 * andere externe calls in dit project (FIRMS, MeteoAlarm, EFFIS, Open-Meteo).
 */
const RESEND_FROM = 'Wildfire Alerts <alerts@vuuralert.nl>'

export async function sendEmail(to: string, subject: string, text: string): Promise<boolean> {
  const apiKey = process.env.RESEND_API_KEY
  if (!apiKey) {
    console.error('[resend] RESEND_API_KEY ontbreekt — e-mail niet verstuurd')
    return false
  }

  try {
    const res = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: {
        Authorization:  `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ from: RESEND_FROM, to: [to], subject, text }),
    })
    if (!res.ok) {
      console.error(`[resend] send mislukt: HTTP ${res.status} ${await res.text()}`)
      return false
    }
    return true
  } catch (err) {
    console.error('[resend] fetch mislukt:', err)
    return false
  }
}
