# Wildfire Pipeline — Bouwplan v1

Eén pijplijn, drie producten erbovenop:

- **Punt 3** — consumentensite "is mijn bestemming veilig?" (SEO + affiliate)
- **Punt 4** — Unified Wildfire API (self-serve SaaS)
- **Punt 1** — premium alerts voor tweedehuisbezitters (e-mail, later WhatsApp)

Stack: TypeScript, Next.js, Prisma, PostgreSQL + PostGIS (**Neon**), hosting op **Vercel**, cron via **GitHub Actions**, mail via Resend.

---

## 0. Architectuur in één oogopslag

```
                 ┌─────────────────────────────────────────────┐
                 │              INGESTIE-WORKERS (cron)         │
                 │                                             │
  NASA FIRMS ───▶│  fetchFirms()      elke 15 min              │
  MeteoAlarm ───▶│  fetchWarnings()   elke 20 min              │
  EFFIS FWI  ───▶│  fetchDanger()     2x per dag + on-demand   │
  Open-Meteo ───▶│  (on-demand, met cache)                     │
                 └──────────────┬──────────────────────────────┘
                                ▼
                 ┌─────────────────────────────────────────────┐
                 │   POSTGRES + POSTGIS                        │
                 │   detections → clusterWorker() → fire_events│
                 │   warnings ⟵ join op regions (NUTS/EMMA)    │
                 └──────┬───────────────┬──────────────────────┘
                        ▼               ▼
              ┌──────────────┐  ┌──────────────────┐
              │ ALERT-WORKER │  │  API-LAAG (Next) │
              │ subscriptions│  │  /v1/risk        │
              │ → Resend /   │  │  /v1/fires       │
              │   webhooks   │  │  /v1/history     │
              └──────────────┘  └────────┬─────────┘
                                         ▼
                              ┌─────────────────────┐
                              │ CONSUMENTENSITE      │
                              │ status per bestemming│
                              │ (programmatic SEO)   │
                              └─────────────────────┘
```

Geen queue-infrastructuur in v1: cron-jobs die idempotent zijn (upserts op unieke keys) zijn genoeg. Redis/queues pas als het schuurt.

**Hoe de cron draait.** Vercel's gratis tier staat maar één cron-run per dag toe, dus de 15-minuten-ingest wordt extern getriggerd: een GitHub Actions-workflow (`schedule: '*/15 * * * *'`, 2.000 gratis minuten p/mnd is ruim voldoende) doet een `POST` naar `/api/cron/ingest`, beveiligd met een `CRON_SECRET` in de header. Belangrijk gevolg: elke worker-run moet binnen de functietimeout blijven (10 s op Vercel Hobby, 60 s op Pro). Daarom verwerkt elke run een begrensde batch en slaat voortgang op in de database — de volgende run pakt de rest. Alternatief zonder timeoutzorgen: de worker volledig ín de GitHub Action draaien (`tsx apps/worker/ingest.ts`, praat rechtstreeks met Neon) en Vercel puur voor de site + API gebruiken. Dat is de simpelste route en heeft mijn voorkeur voor fase 1.

---

## 1. Databronnen

| Bron | Wat | Formaat | Frequentie | Auth | Kosten | Let op |
|---|---|---|---|---|---|---|
| **NASA FIRMS** (Area API) | Actieve hotspots VIIRS (375 m) + MODIS (1 km) | CSV over HTTPS | Nieuwe data ± elke satellietpas, ~3 u vertraging; poll elke 15 min | Gratis MAP_KEY (per e-mail aanvragen) | €0 | Ruwe pixels, geen "branden". Valse positieven: fabrieken, gasfakkels, zonneparken. Day-range max 10 dagen per call. |
| **EFFIS / GWIS** (Copernicus JRC) | Fire Weather Index-klassen (very low → very extreme), vandaag + meerdaagse forecast; verbrande gebieden | WMS/WFS-kaartlagen; GetFeatureInfo voor puntwaarden | Forecast dagelijks ververst; 2x per dag ophalen volstaat | Geen | €0 | Geen nette JSON-API — jouw normalisatie ís de meerwaarde. Verifieer actuele endpoint in de EFFIS-docs. |
| **MeteoAlarm** | Officiële waarschuwingen nationale weerdiensten, incl. type *forest fire* en *extreme temperature*; niveaus geel/oranje/rood | CAP/XML-feeds per land | Poll elke 20–30 min | Geen | €0 | Gebieden komen als regiocodes (EMMA/NUTS-achtig) → koppelen aan eigen regions-tabel. **Actiepunt: herdistributievoorwaarden lezen vóór commerciële launch.** |
| **Open-Meteo** | Wind (richting/kracht), temperatuur; Air Quality API (CAMS-rook/PM2.5) | JSON | On-demand + cache 1 u | API-key | Gratis niet-commercieel; **commercieel plan ± €29/mnd zodra je live gaat** | Enige betaalde bron. Alternatief: ECMWF open data (gratis, meer werk). |
| **Eurostat GISCO (NUTS)** | Regiogrenzen (polygonen) heel Europa | GeoJSON/Shapefile, eenmalige download | Statisch | Geen | €0 | Vrij te gebruiken met bronvermelding. Basis voor regio-join van warnings én "in welke regio ligt deze brand". |
| **GeoNames** (cities500) | Plaatsnamen + coördinaten + inwonertal | TSV, eenmalige download | Statisch | Geen | €0 (CC-BY) | Voor het benoemen van events: "Brand bij Le Porge (Gironde)". |
| *Fase 2:* Fogos.pt API (PT), IPMA brandrisico per concelho (PT), regionale feeds ES | Nationale verrijking | JSON | — | Geen | €0 | Pas toevoegen als de kern draait. |

---

## 2. Datamodel (Prisma)

PostGIS-kanttekening: Prisma kent geen native geometry-type. Patroon: `lat`/`lon` als gewone floats voor app-logica, plus een `geom`-kolom als `Unsupported(...)` die je met een SQL-trigger vult. Alle afstandsqueries via `$queryRaw` met `ST_DWithin`.

```prisma
enum HotspotSource { VIIRS_SNPP  VIIRS_NOAA20  VIIRS_NOAA21  MODIS }
enum Confidence    { LOW  NOMINAL  HIGH }
enum EventStatus   { CANDIDATE  ACTIVE  COOLING  CLOSED }
enum Trend         { GROWING  STABLE  DECLINING  UNKNOWN }
enum WarnLevel     { YELLOW  ORANGE  RED }
enum SubChannel    { EMAIL  WEBHOOK }          // WhatsApp/push later

model Detection {
  id           String        @id @default(cuid())
  source       HotspotSource
  lat          Float
  lon          Float
  geom         Unsupported("geometry(Point,4326)")?
  acquiredAt   DateTime      // satelliet-timestamp, niet fetch-tijd
  confidence   Confidence
  frp          Float?        // Fire Radiative Power (MW)
  brightness   Float?
  daynight     String?
  filtered     Boolean       @default(false)
  filterReason String?       // "static_heat_source" | "low_conf_isolated"
  eventId      String?
  event        FireEvent?    @relation(fields: [eventId], references: [id])
  createdAt    DateTime      @default(now())

  @@unique([source, acquiredAt, lat, lon])   // dedupe-key
  @@index([acquiredAt])
  @@index([eventId])
}

model FireEvent {
  id             String      @id @default(cuid())
  slug           String      @unique       // "2026-le-porge-gironde"
  name           String?                    // "Brand bij Le Porge"
  centroidLat    Float
  centroidLon    Float
  geomCentroid   Unsupported("geometry(Point,4326)")?
  geomHull       Unsupported("geometry(Polygon,4326)")?
  firstSeen      DateTime
  lastSeen       DateTime
  detectionCount Int         @default(0)
  totalFrp       Float       @default(0)
  maxFrp         Float       @default(0)
  estAreaHa      Float?                     // hull-oppervlak, indicatief
  trend          Trend       @default(UNKNOWN)
  status         EventStatus @default(CANDIDATE)
  severity       Int         @default(0)    // 0–100
  countryCode    String?
  regionId       String?
  region         Region?     @relation(fields: [regionId], references: [id])
  detections     Detection[]
  createdAt      DateTime    @default(now())
  updatedAt      DateTime    @updatedAt

  @@index([status, lastSeen])
  @@index([countryCode])
}

model Region {
  id          String      @id @default(cuid())
  code        String      @unique          // NUTS-code of EMMA-id
  name        String
  countryCode String
  level       Int                           // NUTS-niveau
  geom        Unsupported("geometry(MultiPolygon,4326)")?
  events      FireEvent[]
  warnings    Warning[]
}

model Warning {
  id            String    @id @default(cuid())
  externalId    String    @unique          // CAP identifier
  countryCode   String
  awarenessType String                      // "forest_fire" | "extreme_temp" | ...
  level         WarnLevel
  onset         DateTime
  expires       DateTime
  headline      String?
  regionId      String?
  region        Region?   @relation(fields: [regionId], references: [id])
  raw           Json
  fetchedAt     DateTime  @default(now())

  @@index([countryCode, expires])
  @@index([awarenessType, level])
}

model DangerReading {
  id        String   @id @default(cuid())
  cellLat   Float                           // afgerond op 0.25°
  cellLon   Float
  date      DateTime @db.Date
  fwiClass  String                           // "very_low".."very_extreme"
  fwiValue  Float?
  fetchedAt DateTime @default(now())

  @@unique([cellLat, cellLon, date])        // cache-key
}

model StaticHeatSource {
  id     String  @id @default(cuid())
  lat    Float
  lon    Float
  radiusM Int    @default(750)
  type   String                              // "industrial" | "flare" | "solar" | "volcano"
  note   String?
}

model Place {                                 // GeoNames-subset voor naamgeving
  id          String @id
  name        String
  lat         Float
  lon         Float
  population  Int
  countryCode String
  admin1      String?
  @@index([countryCode])
}

model Subscription {                          // punt 1 én API-webhooks, één model
  id             String     @id @default(cuid())
  channel        SubChannel
  target         String                       // e-mailadres of webhook-URL
  label          String?                      // "Huis Moraira"
  lat            Float
  lon            Float
  radiusKm       Int        @default(30)
  minSeverity    Int        @default(20)
  active         Boolean    @default(true)
  apiKeyId       String?
  createdAt      DateTime   @default(now())
  notifications  NotificationLog[]
}

model NotificationLog {
  id             String       @id @default(cuid())
  subscriptionId String
  subscription   Subscription @relation(fields: [subscriptionId], references: [id])
  eventId        String
  kind           String                        // "new" | "update" | "all_clear"
  sentAt         DateTime     @default(now())
  @@index([subscriptionId, eventId])
}

model ApiKey {
  id        String   @id @default(cuid())
  keyHash   String   @unique
  ownerMail String
  plan      String   @default("free")          // free | starter | pro
  createdAt DateTime @default(now())
  usage     ApiUsage[]
}

model ApiUsage {
  id       String   @id @default(cuid())
  apiKeyId String
  apiKey   ApiKey   @relation(fields: [apiKeyId], references: [id])
  date     DateTime @db.Date
  count    Int      @default(0)
  @@unique([apiKeyId, date])                   // upsert-increment per dag
}
```

SQL-migratie naast Prisma (raw): `CREATE EXTENSION postgis;`, trigger die `geom` vult uit lat/lon, en GIST-indexen op alle geom-kolommen.

---

## 3. Clusterlogica (de kern-IP)

Doel: losse hotspot-pixels → persistente **FireEvents** met levensloop. In essentie incrementele DBSCAN met een tijdvenster.

### Parameters (startwaarden, tunen via replay — zie §7)

| Parameter | Waarde | Betekenis |
|---|---|---|
| `EPS_KM` | 2,5 | Max. afstand om detectie aan event/cluster te hechten |
| `ATTACH_WINDOW_H` | 48 | Event telt als "hechtbaar" zolang lastSeen < 48 u geleden |
| `MIN_PTS` | 2 | Detecties nodig om CANDIDATE → ACTIVE te promoveren |
| `SOLO_PROMOTE` | conf = HIGH én FRP ≥ 20 MW | Eén sterke detectie mag direct ACTIVE worden |
| `COOLING_H` / `CLOSED_H` | 36 / 72 | Statusovergangen bij stilte |

### Pipeline per batch (elke 15 min)

```ts
// 1. INGEST — idempotent
//    CSV parsen, upsert op (source, acquiredAt, lat, lon).

// 2. FILTER
//    a. binnen radius van StaticHeatSource  → filtered, reason "static_heat_source"
//    b. LOW-confidence zonder buur (<EPS_KM, <24u) → voorlopig filtered,
//       reason "low_conf_isolated" (kan later alsnog gehecht worden)

// 3. HECHTEN
for (const d of newDetections) {
  const ev = await nearestActiveEvent(d, EPS_KM, ATTACH_WINDOW_H); // ST_DWithin
  if (ev) { attach(d, ev); continue; }

  const buddies = await unattachedNearby(d, EPS_KM, 24 /*h*/);
  if (buddies.length + 1 >= MIN_PTS || soloPromote(d)) {
    createEvent([d, ...buddies], { status: soloPromote(d) ? "ACTIVE" : "CANDIDATE" });
  }
  // anders: blijft los liggen tot een volgende pas hem bevestigt
}

// 4. HERBEREKENEN per geraakt event
//    centroid, convex hull (ST_ConvexHull), estAreaHa,
//    totalFrp/maxFrp, detectionCount, lastSeen
//    trend: detecties laatste 6u vs. de 6u ervoor → GROWING/STABLE/DECLINING
//    naam: dichtstbijzijnde Place (population-gewogen) + Region via ST_Contains

// 5. STATUSMACHINE
//    CANDIDATE --(≥MIN_PTS of soloPromote)--> ACTIVE
//    ACTIVE    --(geen detectie > COOLING_H)--> COOLING
//    COOLING   --(nieuwe detectie)-----------> ACTIVE
//    COOLING   --(geen detectie > CLOSED_H)--> CLOSED

// 6. SEVERITY (0–100)
//    sev = clamp( 25*log10(totalFrp+1) + 3*detecties6u + trendBonus , 0, 100 )
//    trendBonus: GROWING +15, DECLINING −10
//    Banden: <20 laag · 20–50 middel · 50–75 hoog · >75 extreem
```

### Belangrijke nuances

- **Coördinaat-jitter**: dezelfde brand levert per pas nét andere pixelcentra. Daarom dedupe op exacte tuple, maar hechten op afstand — nooit op coördinaat-gelijkheid.
- **Wolken ≠ geblust**: geen detectie kan bewolking zijn. Vandaar de ruime COOLING/CLOSED-vensters en in alerts nooit "brand is uit" maar "geen nieuwe detecties sinds X".
- **StaticHeatSource vullen**: query na 2 weken draaien: locaties met detecties op veel verschillende dagen verspreid over de periode = industrie → automatisch toevoegen. Handmatig aanvullen waar nodig.

---

## 4. Alerting & context

Regels per subscription:

1. Eerste alert zodra een event **ACTIVE** wordt binnen `radiusKm` én `severity ≥ minSeverity`.
2. Update-alert alleen bij: severity springt een band omhoog, óf afstand tot hull krimpt > 20%.
3. Max. 1 bericht per event per subscription per 6 uur (check `NotificationLog`).
4. "All clear"-bericht bij CLOSED (met de wolken-disclaimer).

Berichtinhoud = jouw onderscheidend vermogen: afstand + windrichting-context ("12 km ten NW van je locatie, wind ZW 4"), trend, FWI-klasse van de regio, actieve officiële waarschuwingen, link naar de statuspagina. Contextzin via Claude API genereren, met vaste fallback-template als de call faalt. Verzending: Resend (e-mail) en `POST` naar webhook-URL's; retries met backoff.

---

## 5. API-endpoints (v1)

```
GET  /v1/risk?lat=..&lon=..
     → { danger: { today, forecast[] },
         nearestFire: { id, name, distanceKm, bearing, status, trend, severity } | null,
         warnings: [ { type, level, expires } ],
         attribution: [...] }

GET  /v1/fires?bbox=w,s,e,n&status=active
     → GeoJSON FeatureCollection van FireEvents (hull + properties)

GET  /v1/fires/:id            → detail + detectiehistorie (samengevat)
GET  /v1/history?region=NUTS  → gesloten events + verbrande gebieden
POST /v1/watch                → subscription (webhook) aanmaken   [betaald]
```

Middleware: API-key check → `ApiUsage`-increment → simpele daglimiet per plan. Elke response bevat een `attribution`-veld (zie §8) — verplicht doorvertalen naar afnemers.

---

## 6. Bouwvolgorde

| Fase | Duur | Bouwt | Klaar wanneer |
|---|---|---|---|
| **0. Fundering** | 4–8 u | Neon-project + `CREATE EXTENSION postgis`, monorepo (`apps/web`, `apps/worker`, `packages/db`), Prisma-schema + migratie, Vercel-project gekoppeld, GitHub Actions cron-skelet, FIRMS MAP_KEY aanvragen, NUTS + GeoNames inladen | `SELECT PostGIS_Version()` werkt; regio's en plaatsen queryable; lege cron-run haalt de endpoint |
| **1. Ingest** | ± 1 week | FIRMS-worker + Detection-tabel + interne debugkaart (MapLibre) | Live hotspots van vandaag zichtbaar op de kaart, dedupe bewezen (2x draaien = 0 nieuwe rijen) |
| **2. Clustering** | ± 1 week | clusterWorker, statusmachine, naming, trend, severity, StaticHeatSource-filter | Actuele branden in ES/FR verschijnen als benoemde events met logische hulls |
| **3. Verrijking** | ± 1 week | MeteoAlarm-ingest + regio-join, EFFIS FWI-lookup met DangerReading-cache, Open-Meteo on-demand | `/v1/risk` intern werkend voor elke lat/lon in Europa |
| **4. Publiek** | ± 1 week | API-keys + metering, publieke statuspagina's per regio (punt 3-skelet, programmatic SEO), docs-pagina | Eerste externe dev kan met een key `/v1/risk` aanroepen; 20 regiopagina's live en geïndexeerd |
| **5. Alerts** | 1–2 weken | Subscriptions, alert-worker, Resend-mails, webhooks, "monitor mijn reis"-inschrijving op de site | Jij krijgt zelf betrouwbare mails over een testlocatie; beta-lijst open |

Elke fase apart deploybaar en testbaar — jouw gebruikelijke iteratieve ritme.

---

## 7. Validatie: replay juli 2026

De goedkoopste kwaliteitstest die er bestaat:

1. Haal via FIRMS archief/day-range de detecties op voor **20–31 juli 2026**, bbox Gironde en bbox Ávila/Madrid.
2. Draai de clusterworker over die batch alsof het live binnenkomt (gesorteerd op `acquiredAt`).
3. Check: reconstrueert het algoritme de bekende branden (Le Porge / Lège-Cap-Ferret, Navaluenga) als aparte events met plausibele omvang en tijdlijn? Vergelijk hulls met de EFFIS burnt-area-polygonen.
4. Tune `EPS_KM` en `MIN_PTS` tot naburige branden niet samensmelten en losse landbouwvuurtjes geen "megabrand" worden.

Dit lever je meteen demomateriaal op ("zo zag onze reconstructie van de Gironde-branden eruit") voor docs en sales.

---

## 8. Licenties & attributie — checklist

- [ ] **NASA FIRMS**: vrij te gebruiken; "NASA FIRMS" vermelden. Registreer MAP_KEY.
- [ ] **Copernicus/EFFIS**: vrij, ook commercieel, mét naamsvermelding ("© European Union, Copernicus/EFFIS").
- [ ] **MeteoAlarm**: attributie verplicht; **lees de herdistributievoorwaarden integraal vóór je warnings doorlevert via de API** (dit is het enige echte licentie-risico — een leesmiddag, geen jurist).
- [ ] **Eurostat GISCO / NUTS**: vrij met bronvermelding.
- [ ] **GeoNames**: CC-BY, vermelding in colofon/docs.
- [ ] **Open-Meteo**: commercieel abonnement afsluiten bij launch.
- [ ] Overal in site + API een vaste disclaimer: *geen officieel waarschuwingsplatform, volg altijd lokale autoriteiten* (het isdetunnelopen-model).

---

## 9. Kosten v1

| Post | p/mnd |
|---|---|
| Neon (Postgres + PostGIS, free tier) | €0 → €19 bij groei |
| Vercel (Hobby; Pro pas bij commerciële launch) | €0 → €20 |
| GitHub Actions (cron, binnen gratis minuten) | €0 |
| Open-Meteo commercieel (pas bij launch) | ± €29 |
| Resend | €0 → €20 bij volume |
| Domein(en) | ± €2 |
| Claude API (contextzinnen) | tientjes, volumeafhankelijk |
| **Totaal** | **< €50 tot launch, < €100 daarna** |

---

## 10. Openstaande beslissingen (dag 1)

1. ~~PostGIS-host~~ — **beslist**: Neon (database) + Vercel (site/API) + GitHub Actions (cron). Resterende keuze: draait de ingest-worker ín de Action (simpelst, geen timeout) of als Vercel-route die de Action aanroept (alles op één plek)? Zie §0.
2. **Regiocodes**: NUTS als ruggengraat; MeteoAlarm-gebiedscodes daarop mappen (eenmalige mapping-tabel, deels handwerk).
3. **WhatsApp-alerts**: bewust uitgesteld — Business-API-setup en templategoedkeuring zijn gedoe; e-mail + webhook eerst, WhatsApp als betaalde upgrade later.
4. **Naam/domein**: één merk voor site + API scheelt SEO-werk; API kan op `api.` subdomein.
