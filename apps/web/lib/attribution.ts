/**
 * Verplicht doorvertalen naar afnemers — zie PLAN.md §8.
 *
 * "EUMETNET – MeteoAlarm" (i.p.v. kaal "MeteoAlarm") staat hier altijd,
 * ook in single-location responses: dit veld beschrijft het aggregatiesysteem
 * waar de data vandaan komt, niet de individuele bron. De nationale
 * weerdienst per waarschuwing (verplicht bij één-land-info) wordt apart
 * getoond via Warning.senderName, niet via dit veld.
 */
export const ATTRIBUTION = [
  'NASA FIRMS',
  '© European Union, Copernicus/EFFIS',
  'EUMETNET – MeteoAlarm',
  'Eurostat GISCO (NUTS)',
  'Open-Meteo',
  'Geen officieel waarschuwingsplatform — volg altijd lokale autoriteiten',
]
