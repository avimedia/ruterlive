# Fase 0: minne, datamengde og Kartverket – implementeringsplan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Prosessens toppminne (RSS) godt under Renders 512 MB, kartets datafeed ned fra 2,4 MB hvert 30. s, og bakgrunnskart fra Kartverket – slik at innholdssidene kan publiseres igjen.

**Architecture:** ET-XML parses én gang per henting med en strømmende/lett parser (ingen DOM) og deles mellom kjøretøy- og rutekarttjenesten. GTFS leser bare `stops.txt` fra zip-en med HTTP Range. Klienten henter rutekart én gang og poller bare kjøretøy; JSON-svar forhåndskomprimeres én gang per cache-oppdatering.

**Tech Stack:** Node 20+, Express 4, `node:test`, `node:zlib`. Ingen nye avhengigheter.

**Spec:** `ROADMAP.md` (Fase 0) og `docs/utvidelse-utover-oslo.md` §3. Bakgrunn: produksjon krasjet 2026-10-21 (RSS-topper ~780 MB lokalt med innholdssidene, ~630 MB før; Render har 512 MB). Rullet tilbake med d1ad287; arbeidet skjer på grenen `innholdssider`.

## Global Constraints

- Ingen nye npm-avhengigheter.
- Norske kommentarer/logger/UI-tekst.
- Alle Entur-kall: header `ET-Client-Name: ruterlive-web`. Ingen flere kall mot Entur enn i dag.
- Funksjoner som i dag aldri avviser (GTFS-lasting, ET-beregning) skal fortsatt aldri avvise.
- Kartet (`/`) skal aldri laste AdSense.
- Akseptkriterium for hele planen: `npm run memcheck` (Task 1) viser topp-RSS < 350 MB over 90 s med samtidige forespørsler under oppstart.

## Review Focus

- ET-parser gir samme turer/kall som dagens DOM-parser på ekte data (paritetstest mot lagret XML-utdrag).
- GTFS Range-leser: zip med data descriptor / ulike kompresjonsmetoder; Range ikke støttet → fallback til dagens nedlasting.
- Klient som har gammel JS i cache (service worker) mot ny server: `/api/initial-data` må fortsatt fungere.
- Komprimering: klient uten `Accept-Encoding` får ukomprimert; riktig `Vary: Accept-Encoding`.
- Mørkt tema-filter skal bare påvirke flislaget, ikke rutelinjer/markører.

---

### Task 1: Minnemåling (`npm run memcheck`)

**Files:** Create `scripts/memcheck.mjs`; Modify `package.json` (script `memcheck`).

- [ ] Script starter `node --max-old-space-size=384 server.js` på ledig port, sampler RSS (`ps -o rss= -p <pid>`) hvert 2. s i 90 s, sender samtidige forespørsler (`/api/initial-data`, `/`, `/linje/t-bane-1`, `/guider`, nye endepunkter fra Task 5) hvert 5. s, skriver tidsserie + topp, avslutter serveren, exit 1 hvis topp ≥ terskel (`--max-mb`, standard 350).
- [ ] Kjør på nåværende kode og noter baseline i rapporten (forventet ~780 MB).
- [ ] Commit.

### Task 2: Lett ET-parser, parset én gang

**Files:** Create `server/et-parse.js`, `test/et-parse.test.js`, `test/fixtures/et-sample.xml` (≤ 200 KB utdrag av ekte ET, inkl. turer med og uten VehicleRef, RecordedCall/EstimatedCall); Modify `server/et-cache.js`, `server/et-vehicles-service.js`, `server/shape-service.js`.

**Interfaces:** `parseEtJourneys(xml: string) -> Journey[]` med samme felter som dagens `parseSiriXml` i begge tjenester (`vehicleId` via `journeyVehicleId`, `mode`, `lineRef`, `destinationName`, `recordedCalls[{quayId,name,time}]`, `estimatedCalls[{quayId,name,arrTime,depTime}]`, `datedVehicleJourneyRef`). `et-cache.js` eksporterer `getEtJourneys() -> Promise<Journey[]>` som parser én gang per ny XML og cacher resultatet.

- [ ] Paritetstest: for fixture gir `parseEtJourneys` dypt likt resultat som dagens DOM-parser (behold gammel parser kun i testen, eller lagre forventet JSON som fixture).
- [ ] Implementer uten DOM: skann `<EstimatedVehicleJourney>`-blokker med indeksering/regex, dekod XML-entiteter i tekst.
- [ ] Bytt begge tjenester til `getEtJourneys()`; fjern `@xmldom/xmldom`-bruk på server (avhengigheten kan stå til klient-sti er avklart; klienten bruker nettleserens DOMParser).
- [ ] `npm test`, commit.

### Task 3: GTFS – bare stops.txt, ingen kopiering

**Files:** Create `server/zip-range.js`, `test/zip-range.test.js`; Modify `server/gtfs-stops-loader.js`.

**Interfaces:** `readZipEntry(url, name, fetchFn) -> Promise<Buffer>`: HEAD/Range for EOCD (siste 64 KB) → sentralkatalog → lokal header → Range for entry → `zlib.inflateRawSync` (metode 8) eller rå (metode 0). Kaster ved manglende Range-støtte. `getGtfsQuayCache()` returnerer samme `Map<id,[lat,lon]>` hver gang (bygges én gang per lasting).

- [ ] Tester med zip laget i testen av `adm-zip` (eksisterende avhengighet) servert via fake fetch som støtter Range; test fallback når fake fetch ignorerer Range.
- [ ] `loadGtfsStops`: prøv `readZipEntry`, fallback til dagens fulle nedlasting ved feil. Behold tidsgrense og «avviser aldri».
- [ ] `getGtfsQuayCache` uten kopiering; sjekk at ingen kaller muterer Map-en.
- [ ] `npm test`, commit.

### Task 4: Kartverket-bakgrunnskart

**Files:** Modify `js/map.js`, `css/style.css`, `public/personvern.html`, `DEPLOY.md`, `ROADMAP.md`, `CLAUDE.md`.

- [ ] Fliser: `https://cache.kartverket.no/v1/wmts/1.0.0/topograatone/default/webmercator/{z}/{y}/{x}.png`, attribusjon `&copy; <a href="https://www.kartverket.no/">Kartverket</a>`, maks zoom 18 (sjekk at z=18 gir 200; ellers lavere).
- [ ] Mørkt tema: samme fliser med CSS-filter på flislaget (`.leaflet-tile-pane`) – utgangspunkt `invert(1) hue-rotate(180deg) brightness(.75) contrast(1.05) grayscale(1)`; temabytte setter klasse, ikke nytt lag. OpenRailwayMap-overlay skal ikke inverteres (eget pane eller unntak).
- [ ] Fjern CARTO og `VITE_CARTO_API_KEY` fra kode og docs; personvern nevner Kartverket som kilde for kartfliser (i stedet for CARTO).
- [ ] Skjermbilde lyst/mørkt via headless Chrome (localhost); `npm test`, `npm run build`, commit.

### Task 5: Datafeed – bare kjøretøy hvert 30. s, komprimert

**Files:** Create `server/json-cache.js` (forhåndskomprimert JSON), `test/json-cache.test.js`; Modify `server.js`, `server/live-vehicles.js`, `js/main.js`.

**Interfaces:**
- `GET /api/vehicles-live` → `{ vehicles, shapesVersion }` (kun kjøretøy; `shapesVersion` = hash av rutekartsettet).
- `GET /api/route-shapes-all?v=<shapesVersion>` → alle rutekart (dagens `routeShapes` fra initial-data), `Cache-Control: public, max-age=86400, immutable` når `v` matcher.
- `/api/initial-data` beholdes uendret for gamle klienter.
- `sendJson(req, res, entry)` der `entry = { json, gzip, br, etag }` lages én gang per cache-oppdatering (`zlib.gzipSync`, `brotliCompressSync` kvalitet 5); velger ut fra `Accept-Encoding`, setter `Content-Encoding`, `Vary: Accept-Encoding`, `ETag`, svarer 304 på `If-None-Match`.
- [ ] Tester: `sendJson` velger br/gzip/rå riktig; 304 på ETag; `shapesVersion` endres bare når rutekartene endres.
- [ ] Klient: ved oppstart `/api/vehicles-live` + `/api/route-shapes-all?v=…`; deretter hvert 30. s bare `/api/vehicles-live`; hent rutekart på nytt bare når `shapesVersion` endres. Fallback-stien (dev / feil) uendret.
- [ ] Mål og rapporter bytes per poll før/etter (ukomprimert og komprimert) mot lokal server.
- [ ] `npm test`, `npm run build`, commit.

### Task 6: Verifisering og publisering (controller)

- [ ] `npm run memcheck` < 350 MB (rapporter tidsserie), alle sider og endepunkter som i forrige lokale kjøring, kart i nettleser (lyst/mørkt, rutelinjer, kjøretøy).
- [ ] Merge `innholdssider` til `main`, push, overvåk: `/health` hvert 20. s i 10 min etter deploy, ny-versjon-signal = 404 på ukjent URL.
