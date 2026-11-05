# Flere regioner, først Bergen – implementeringsplan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Bergen på livetrafikk.no med samme innhold som Oslo, bygget slik at neste region i hovedsak er config + innhold.

**Architecture:** `shared/regions.js` beskriver regionene. Tjenester som i dag er modul-singletoner for Oslo (ET-cache, ET-kjøretøy, rutekart, linjegeometri, live-svar) blir fabrikker med én instans per region, eid av et register i `server/region-runtime.js`, som også holder styr på aktiv/hvilende/avlastet. GPS-kjøretøy hentes i ett GraphQL-kall med ett alias per region. Klienten leser regionen fra stien og sender `?region=` på alle regionsensitive kall.

**Tech Stack:** Node 20, Express, Leaflet + Vite, `node:test`. Ingen nye avhengigheter.

**Spec:** `docs/superpowers/specs/2026-11-05-regioner-bergen-design.md`

## Global Constraints

- Hver forespørsel til Entur sender `ET-Client-Name: ruterlive-web` (`server/entur-client.js` `CLIENT_NAME`).
- Kommentarer, loggmeldinger og UI-tekst på norsk.
- Ingen nye npm-avhengigheter.
- Oslo-URL-er uendret: `/`, `/linje/…`, `/guider/…`, `/holdeplass/…`. Nye regioner: `/<region>`, `/<region>/linje/<slug>`, `/<region>/holdeplass/<slug>`, `/<region>/guider/<slug>`.
- `?region=` mangler → `oslo` (gamle klienter). Ukjent region → 400.
- Kartsider (alle regioner) laster aldri AdSense.
- Tilstander: aktiv (besøk siste 10 min eller `alwaysActive`), hvilende (10–60 min), avlastet (> 60 min: ET-turer slippes; rutelinjer og holdeplasser beholdes).
- To ET-parsinger kjører aldri samtidig.
- Bergen-linjesider uten egen tekst får `noindex` og står ikke i sitemap. Bestillingslinjer («Skyss Bestilling») får ingen side.
- Tekster: kort, ingen standardinnledninger, fyllfraser, oppsummering til slutt eller oppdiktet forfatter; byline «livetrafikk.no»; fakta sjekket mot Entur, ellers utelatt.
- `start` beholder `--max-old-space-size=384`. Målt topp-RSS med Oslo og Bergen aktive må være godt under 512 MB før push (mål: < 420 MB).
- Bergen holdes ute av velger, sitemap og stier (404) til siste oppgave (`public: false`).
- `/api/route-shapes-all` per region ≤ ~500 KB br (byte-budsjettet i `test/line-geometry.test.js` gjelder hver region).

## Review Focus

1. `?region=bergen` mot en region med `public: false`, eller søppel som `?region=__proto__` → 400, aldri krasj eller Oslo-data. Test i Task 6.
2. Gamle bufrede klienter uten `?region=` → nøyaktig samme Oslo-svar og ETag som før. Test i Task 6.
3. Første besøk i avlastet Bergen: `/api/vehicles-live?region=bergen` svarer med GPS-kjøretøy uten å vente på ET (ET kommer ved neste poll). Test i Task 6.
4. Samme slug i to regioner (`buss-2`): lenken fra kartet og `/bergen/linje/buss-2` går til Bergen-linja, `/linje/buss-2` til Oslo (eller 404). Test i Task 8.
5. Lagret region i `localStorage` som er ugyldig eller ikke lenger offentlig → ingen omdirigering, ingen løkke mellom `/` og `/bergen`. Test i Task 10.

---

### Task 1: Regionmodell

**Files:**
- Modify: `shared/regions.js`
- Test: `test/regions.test.js` (ny eller utvid eksisterende)

**Interfaces:**
- Produces:
  - `REGIONS.bergen` med feltene i spec-tabellen, pluss `public: false`, `path: '/bergen'`, `alwaysActive: false`, `etDatasets: ['SKY']`, `authorities: ['SKY']`, `lineNumberFallback: null`. Oslo får `path: ''`, `public: true`, `alwaysActive: true`, `authorities: ['RUT']`.
  - `getRegion(id)` uendret (ukjent → Oslo).
  - `findRegion(id: string): Region | null` – bare kjente id-er (bruk `Object.hasOwn`), ellers null.
  - `publicRegions(regions = REGIONS): Region[]` – Oslo først. `regionFromPath` og `regionAt` tar også `regions = REGIONS` som siste argument.
  - `regionFromPath(pathname: string): { region: Region, rest: string }` – `/bergen/linje/x` → bergen, `/linje/x`; `/` → oslo, `/`. Ikke-offentlige regioner gjenkjennes ikke (gir Oslo og hele stien som `rest`).
  - `regionPath(region: Region, sub = ''): string` – `regionPath(oslo, '/linje/x')` → `/linje/x`, `regionPath(bergen)` → `/bergen`.
  - `regionAt(lat: number, lon: number): Region | null` – første offentlige region der punktet ligger innenfor `vehicleBounds`.

- [ ] **Step 1:** Skriv tester: `findRegion('__proto__') === null`; `regionFromPath('/bergen/linje/buss-2')` gir `bergen`/`/linje/buss-2` når `public: true` (funksjonene tar et valgfritt siste argument `regions = REGIONS`; testene sender inn en kopi der Bergen har `public: true`); `regionAt(60.39, 5.32)` er Bergen (offentlig), `regionAt(59.91, 10.75)` er Oslo, `regionAt(63.4, 10.4)` er null.
- [ ] **Step 2:** Kjør `node --test test/regions.test.js`, forvent FAIL.
- [ ] **Step 3:** Implementer. Bergens grenser: `center` Byparken `[60.3925, 5.3240]`, `defaultZoom: 14`, `vehicleBounds { minLat: 60.15, maxLat: 60.65, minLon: 4.85, maxLon: 5.75 }`, `stopsBounds { minLat: 60.0, maxLat: 60.8, minLon: 4.7, maxLon: 5.9 }`, `geometryBounds { s: 59.95, n: 60.85, w: 4.6, e: 6.0 }`. Juster boksene mot SKY-kjøretøyene i Entur (ett kall til Vehicles uten bbox, `codespaceId: "SKY"`) og noter faktisk min/maks i commit-meldingen.
- [ ] **Step 4:** `npm test`, forvent PASS (alle eksisterende tester grønne).
- [ ] **Step 5:** Commit `Regioner: Bergen i regionmodellen (ikke offentlig ennå)`.

### Task 2: Region-kjøretid (aktiv/hvilende/avlastet)

**Files:**
- Create: `server/region-runtime.js`
- Test: `test/region-runtime.test.js`

**Interfaces:**
- Produces: `createRegionRuntime({ regions, now = Date.now, restAfterMs = 600_000, unloadAfterMs = 3_600_000 })` →
  - `touch(id: string): void` – registrerer besøk.
  - `stateOf(id: string): 'active' | 'resting' | 'unloaded'` – `alwaysActive` er alltid `'active'`; region uten besøk siden start er `'resting'` de første `unloadAfterMs` (så Bergen er lastet etter oppstart).
  - `onUnload(fn: (id) => void)` – kalles én gang ved overgang til `'unloaded'` (sjekkes av `tick()`).
  - `tick(): void` – kalles hvert minutt fra server.js.
  - `runExclusive(fn: () => Promise<T>): Promise<T>` – kø så bare én ET-parsing kjører om gangen.

- [ ] **Step 1:** Tester med falsk klokke: aktiv → hvilende etter 10 min → avlastet etter 60 min (`onUnload` kalt nøyaktig én gang) → `touch` gir aktiv igjen; Oslo alltid aktiv; `runExclusive` med to løfter starter det andre først når det første er ferdig (også når det første avviser).
- [ ] **Step 2:** Kjør, forvent FAIL.
- [ ] **Step 3:** Implementer.
- [ ] **Step 4:** Kjør, forvent PASS.
- [ ] **Step 5:** Commit.

### Task 3: ET-cache per region

**Files:**
- Modify: `server/et-cache.js` (blir fabrikk)
- Modify: `server/et-vehicles-service.js`, `server/shape-service.js` (importerer fra fabrikken, se Task 4)
- Test: `test/et-cache.test.js`

**Interfaces:**
- Consumes: `createRegionRuntime` (Task 2): `stateOf`, `runExclusive`.
- Produces: `createEtCache({ datasetId, isActive: () => boolean, runExclusive, fetchFn = fetchWithRetry, now = Date.now, refreshMs = 90_000 })` →
  `{ getJourneys(): Promise<object[]>, getVersion(): number, getAge(): number|null, refreshNow(): Promise<void>, drop(): void, start(): void }`.
  - Henter bare i bakgrunnen når `isActive()`; `getJourneys()` i hvilende region returnerer siste kopi og starter én henting.
  - `drop()` setter turene til null (avlastet); neste `getJourneys()` returnerer `[]` umiddelbart og starter henting i bakgrunnen (ikke vent – Review Focus 3).
  - 429-backoff (5 min) og «én henting om gangen» som i dag.
  - Logger en advarsel når svaret har `<MoreData>true</MoreData>` (`maxSize=3000` var for lite).
- Behold en Oslo-instans som standard-eksport (`getEtJourneys`, `getEtVersion`, `getEtAge`, `startEtCachePoll`) til Task 6 har flyttet alle brukere.

- [ ] **Step 1:** Tester med falsk `fetchFn` som strømmer en liten ET-XML (to turer): `getJourneys()` gir 2 turer; ikke-aktiv region henter ikke på `start()`-intervallet; `drop()` + `getJourneys()` gir `[]` uten å vente og deretter 2 turer etter at hentingen er ferdig; `MoreData=true` gir `console.warn` (stub).
- [ ] **Step 2:** FAIL.
- [ ] **Step 3:** Implementer; parse-steget kjøres i `runExclusive`.
- [ ] **Step 4:** `npm test` PASS.
- [ ] **Step 5:** Commit.

### Task 4: ET-kjøretøy og rutekart per region

**Files:**
- Modify: `server/et-vehicles-service.js`, `server/shape-service.js`, `server/line-geometry.js`
- Test: `test/et-vehicles-service.test.js`, `test/line-geometry.test.js`

**Interfaces:**
- Consumes: `createEtCache` (Task 3).
- Produces:
  - `createEtVehiclesService({ region, etCache })` → `{ getVehiclesAndShapes(): Promise<{ vehicles, shapes }> }` (samme oppførsel som dagens `getEtVehiclesAndShapes`).
  - `createShapeService({ region, etCache })` → `{ getCachedShapes(), refresh() }`. `fetchJpRoutes` (tog fra Oslo S) brukes bare når `region.jpRailFallback === true` (nytt felt, bare Oslo).
  - `createLineGeometryService({ region, lines, timeoutMs })` – `lines` er regionens linjer med `geometry !== false`; `REGION_BBOX` erstattes av `region.geometryBounds`.
  - Linjenummer-fallback (`getLinePublicCode`, `getModeFromLineNumFallback`) brukes bare når `region.lineNumberFallback === 'ruter'`.

- [ ] **Step 1:** Tester: SKY-tur med `lineRef: 'SKY:Line:2'` og JP-modus `tram` blir `tram` (ikke `metro`); samme tur uten JP-modus får modus fra ET, ikke fra linjenummer; Oslo-tester uendret. `line-geometry`: Bergen-trasé klippes til Bergens `geometryBounds`; byte-budsjettet sjekkes per region.
- [ ] **Step 2:** FAIL.
- [ ] **Step 3:** Implementer.
- [ ] **Step 4:** `npm test` PASS.
- [ ] **Step 5:** Commit.

### Task 5: GPS-kjøretøy og holdeplasser for alle regioner

**Files:**
- Modify: `server/vehicles-cache.js`, `server/gtfs-stops-loader.js`, `server/stop-search.js`
- Test: `test/vehicles-cache.test.js`, `test/gtfs-stops.test.js`

**Interfaces:**
- Produces:
  - `getCachedVehicles(regionId = 'oslo')` – ett GraphQL-kall per 20 s med ett alias per offentlig region (`oslo: vehicles(boundingBox: …) { … } bergen: vehicles(…) { … }`), resultatet delt per alias i samme form som i dag (`{ data: { vehicles } }`). Ikke-offentlige regioner tas med når `process.env.REGIONS_PREVIEW` inneholder id-en (for lokal testing før lansering).
  - GTFS-holdeplasser filtreres mot summen av alle regioners `stopsBounds` (ett pass over `stops.txt`).
  - `createStopPlaceLookup().search(q, { lat, lng })` uendret; klienten sender regionens senter som `lat/lng` når brukeren ikke har posisjon (Task 10).

- [ ] **Step 1:** Tester: spørringen har ett alias per region; svar med to alias gir riktig liste per region; ukjent region gir tom liste. GTFS: en quay i Bergen beholdes, en i Trondheim filtreres bort.
- [ ] **Step 2:** FAIL.
- [ ] **Step 3:** Implementer.
- [ ] **Step 4:** `npm test` PASS.
- [ ] **Step 5:** Commit.

### Task 6: Live-svar og API per region

**Files:**
- Create: `server/region-services.js` (registeret: én instans av ET-cache, ET-kjøretøy, rutekart, linjegeometri og memo-entries per region)
- Modify: `server.js` (live-endepunktene, `getLiveSources`/`getLiveEntries`, `/api/vehicle-route`, `/api/stops-search`), `server/live-vehicles.js`, `server/vehicle-route.js`
- Test: `test/region-api.test.js`, eksisterende `test/live-*.test.js`

**Interfaces:**
- Consumes: Task 2–5.
- Produces:
  - `parseRegionParam(query): Region | null` – mangler → Oslo; ukjent eller ikke offentlig (utenom `REGIONS_PREVIEW`) → null → 400 `{ error: 'ukjent region' }`.
  - `getRegionServices(id)` → `{ etCache, etVehicles, shapes, lineGeometry, live: { getLiveSources(), getLiveEntries() } }`.
  - `getLiveData(regionId = 'oslo')`, `getMergedVehicles(regionId = 'oslo')` i `live-vehicles.js`.
  - `createVehicleRouteService` foretrekker `region.authorities[0]` der den i dag foretrekker `RUT`.
  - `runtime.touch(id)` i `/api/vehicles-live`, `/api/route-shapes-all`, `/api/initial-data` og regionale innholdssider. `runtime.onUnload(id => etCache.drop())`. `setInterval(runtime.tick, 60_000)`.
  - `shapesVersion` og ETag er per region (egen memo-entry per region gir det automatisk).

- [ ] **Step 1:** Tester mot `server.js`-appen med stubbede tjenester (følg mønsteret i eksisterende server-tester): `?region=__proto__` → 400; `?region=bergen` med `public: false` → 400; uten `region` → samme body og ETag som `?region=oslo`; avlastet Bergen (`REGIONS_PREVIEW=bergen`) svarer GPS-kjøretøy innen 200 ms når ET-hentingen henger.
- [ ] **Step 2:** FAIL.
- [ ] **Step 3:** Implementer; fjern Oslo-standardeksportene fra Task 3 når ingen bruker dem.
- [ ] **Step 4:** `npm test` PASS.
- [ ] **Step 5:** Commit.

### Task 7: Linjekatalog for Bergen

**Files:**
- Create: `scripts/build-line-catalog.mjs`, `shared/lines/bergen.js` (generert)
- Modify: `server/line-catalog.js`, `shared/line-list.js`
- Test: `test/line-catalog.test.js`, `test/line-search.test.js`

**Interfaces:**
- Produces:
  - `scripts/build-line-catalog.mjs --region bergen` henter `lines(authorities: […])` fra JP for `region.authorities`, dropper linjer der `publicCode` mangler eller navnet starter med «Skyss Bestilling», og skriver `shared/lines/bergen.js`: `export default [{ slug, code, mode, authority, title }]`, sortert som `MODE_ORDER`. Slug: samme regel som `lineSlug` (`buss-2`, `bybanen-1` for tram i Bergen via `SLUG_PREFIX` per region: `{ tram: 'bybanen' }` overstyrer for Bergen), unik innen regionen. Tittel: «Bybanen linje 1», «Buss 2», «Båt 1047».
  - Hver linje i `LINES` får `region` (`'oslo'` for alle eksisterende, også de nasjonale togene). `getLineBySlug(slug, regionId = 'oslo')`.
  - `getLineText(slug, regionId)` leser `content/linje/<slug>.html` for Oslo og `content/<region>/linje/<slug>.html` ellers.
  - `line.indexed`: Oslo alltid `true`; andre regioner `true` bare når teksten finnes.
  - `prewarmLineStops()` varmer bare `indexed` linjer.
  - `shared/line-list.js`: `linesFor(regionId): Promise<Line[]>` – Oslo synkront fra `LINE_LIST`, Bergen via `import('./lines/bergen.js')` (egen Vite-chunk). `linePageFor(v, mode, regionId)` gir `{ path, title }` med `path = regionPath(region, '/linje/' + slug)`.

- [ ] **Step 1:** Tester: genererte linjer har unike slugs; ingen tittel inneholder «Bestilling»; `getLineBySlug('buss-2', 'bergen')` og `getLineBySlug('buss-2')` er forskjellige (eller den siste undefined); `linePageFor` med `SKY:Line:2` i Bergen gir `/bergen/linje/buss-2`; Oslo-likhetstesten mellom `LINE_LIST` og Oslo-delen av `LINES` består.
- [ ] **Step 2:** Kjør skriptet, sjekk antall linjer per modus mot `lines`-spørringen (forvent ~2 tram, ~58 water, resten bus minus bestilling), commit generert fil sammen med koden.
- [ ] **Step 3:** FAIL → implementer → PASS.
- [ ] **Step 4:** Commit.

### Task 8: Regionale sider, sitemap og 404

**Files:**
- Modify: `server.js` (ruter), `server/pages/sitemap.js`, `server/pages/line-page.js`, `server/pages/stop-page.js`, `server/pages/guide-index.js`, `server/pages/layout.js`, `server/guide-catalog.js`, `server/stop-catalog.js`, `scripts/build-stop-catalog.mjs`
- Test: `test/seo.test.js`, `test/stops.test.js`, `test/line-page.test.js`

**Interfaces:**
- Consumes: `regionFromPath`, `regionPath` (Task 1); `getLineBySlug(slug, regionId)`, `line.indexed` (Task 7).
- Produces:
  - Ruter for hver offentlig region utenom Oslo: `/<id>` (kartet, samme `index.html`), `/<id>/linje/:slug`, `/<id>/holdeplass/:slug`, `/<id>/guider/:slug`. Registreres før `express.static`/catch-all.
  - `isMapPath(path)` sann for `/`, `/index.html` og `regionPath(r)` for alle offentlige regioner.
  - `renderPage({ …, noindex })`: linjeside får `noindex: !line.indexed`.
  - `buildSitemap` tar med regionale linjer bare når `indexed`, regionale holdeplasser og guider.
  - `GUIDES` og `stop-catalog` får `region` (standard `'oslo'`); `getStopBySlug(slug, regionId)`, `findStopForPlace` uendret.
  - `scripts/build-stop-catalog.mjs --region bergen` skriver `server/stop-catalog-bergen.json`.
  - `/guider` og `/holdeplasser` viser en seksjon per offentlig region, Oslo først. Brødsmuler: «Bergen › Linjer › Buss 2».

- [ ] **Step 1:** Tester: `/bergen/linje/buss-2` (med en stub-region som er offentlig) → 200 og `noindex` uten tekst, uten `noindex` med tekst; `/bergen/linje/t-bane-5` → 404; `/linje/buss-2` → Oslo-siden eller 404, aldri Bergen; `isMapPath('/bergen')` sann; sitemap har ikke ikke-indekserte Bergen-linjer; ingen side under `/bergen` uten innhold laster AdSense når den er kart.
- [ ] **Step 2:** FAIL → implementer → PASS.
- [ ] **Step 3:** Commit.

### Task 9: Lenker og søk i klienten per region

**Files:**
- Create: `js/region.js`
- Modify: `js/main.js`, `js/map.js`, `js/api.js`, `js/et-api.js`, `js/routes.js`, `js/line-search.js`, `js/markers.js`, `js/search.js`
- Test: `test/region-client.test.js` (ren logikk i `js/region.js`)

**Interfaces:**
- Consumes: `regionFromPath`, `regionPath`, `linesFor`, `linePageFor` (Task 1, 7).
- Produces:
  - `js/region.js`: `currentRegion(): Region` (fra `location.pathname`), `withRegion(url: string): string` (legger til `region=<id>` unntatt for Oslo, så Oslo-URL-ene og Cloudflare-cachen er uendret).
  - Alle kall til `/api/vehicles-live`, `/api/route-shapes-all`, `/api/initial-data`, `/api/vehicle-route`, `/api/stops-search`, `/api/rail-shapes`, `/api/route-shapes`, `/api/static-network-shapes` går via `withRegion`.
  - Kartet starter på `currentRegion().center`/`defaultZoom`. Linjesøket bruker `linesFor(currentRegion().id)`. Popup-lenken bruker `linePageFor(v, mode, regionId).path`.
  - Dev-reserveveien (`js/api.js`, `js/et-api.js`) bruker regionens `vehicleBounds` og `etDatasets[0]`.

- [ ] **Step 1:** Tester: `withRegion('/api/vehicles-live')` på `/` er uendret; på `/bergen` blir `/api/vehicles-live?region=bergen`; med eksisterende query (`/api/route-shapes-all?v=abc`) blir `&region=bergen`.
- [ ] **Step 2:** FAIL → implementer → PASS.
- [ ] **Step 3:** Commit.

### Task 10: Regionvelger og valg fra posisjon

**Files:**
- Modify: `index.html`, `js/region.js`, `js/main.js` (eller der «Vis min posisjon» håndteres), `css/style.css`
- Test: `test/region-client.test.js`

**Interfaces:**
- Produces:
  - `chooseStartRegion({ pathname, stored, permission, position }): string | null` – ren funksjon, returnerer stien det skal byttes til eller null:
    - sti er en regionsti (`/bergen`) → null (lenken vinner);
    - `stored` er en gyldig offentlig region ≠ stiens → den regionens sti; ugyldig/ikke offentlig `stored` → ignoreres;
    - ellers `permission === 'granted'` og `regionAt(position)` er en annen region → den regionens sti;
    - ellers null.
  - Velger i kartmenyen (`<select id="region-select">` med `publicRegions()`; skjult når bare én region er offentlig). Valg lagres i `localStorage['livetrafikk.region']` (try/catch) og navigerer med `location.assign(regionPath(r))` (full innlasting; enklere og tryggere enn `pushState` med all tilstanden i `main.js` – avvik fra spec, oppdater spec-linja).
  - Når «Vis min posisjon» gir en posisjon i en annen region: bytt region (samme `location.assign`), og lagre valget.

- [ ] **Step 1:** Tester for `chooseStartRegion`: alle grenene over, inkludert `stored: 'bergen'` på `/bergen` → null (ingen løkke), `stored: 'xyz'` → null, `stored: 'oslo'` på `/` → null.
- [ ] **Step 2:** FAIL → implementer → PASS.
- [ ] **Step 3:** Oppdater spec-linja om `pushState` til `location.assign`.
- [ ] **Step 4:** Commit.

### Task 11: Minnemåling med to regioner (port)

**Files:**
- Modify: `scripts/memcheck.mjs`

**Interfaces:**
- Produces: `npm run memcheck -- --regions oslo,bergen` setter `REGIONS_PREVIEW=bergen`, gjør `/api/vehicles-live` og `/api/route-shapes-all` mot hver region hvert 10. s under målingen, og skriver topp-RSS.

- [ ] **Step 1:** Implementer flagget.
- [ ] **Step 2:** `npm run build && npm run memcheck -- --regions oslo,bergen --seconds 300`. Forventet: topp-RSS < 420 MB. Noter også tid fra første Bergen-kall i avlastet tilstand til ET-kjøretøy (Bybanen) er med.
- [ ] **Step 3:** Over 420 MB: STOPP. Rapporter tallene til brukeren med de største postene (`/health/details` + heap-snapshot) før videre arbeid.
- [ ] **Step 4:** Commit skriptet og tallene i commit-meldingen.

### Task 12: Bergen-innhold – holdeplasser

**Files:**
- Create: `server/stop-catalog-bergen.json` (generert, Task 8-skriptet), `content/bergen/holdeplass/<slug>.html`

- [ ] **Step 1:** Generer katalogen; merk 8–12 knutepunkter `featured` (kandidater: Byparken, Bergen busstasjon, Flesland, Nesttun terminal, Åsane terminal, Strandkaien; bekreft at hvert finnes i Entur og hvilke linjer som stopper).
- [ ] **Step 2:** Skriv tekst per holdeplass etter tekstreglene; bare fakta fra Entur.
- [ ] **Step 3:** `npm test` (eksisterende test sjekker at alle `featured` har tekstfil) PASS. Commit.

### Task 13: Bergen-innhold – guider og linjetekster

**Files:**
- Create: `content/bergen/guider/{bybanen-i-bergen,bat-og-ferje-skyss,til-og-fra-flesland}.html`, `content/bergen/linje/<slug>.html` for 20–30 linjer
- Modify: `server/guide-catalog.js`

- [ ] **Step 1:** Tre guider, 600–1200 ord, etter tekstreglene; fakta (endestasjoner, antall stopp, frekvens) hentet fra Entur JP.
- [ ] **Step 2:** Linjetekster for Bybanen 1 og 2, flybussen hvis den finnes, og busslinjene og båtrutene med flest avganger per døgn i JP (velg toppen av listen, 20–30 totalt).
- [ ] **Step 3:** `npm test` PASS; sjekk at disse linjene er `indexed` og står i sitemap. Commit.

### Task 14: Lansering

**Files:**
- Modify: `shared/regions.js` (`public: true` for Bergen), `CLAUDE.md`, `README.md`, `ROADMAP.md`

- [ ] **Step 1:** `public: true`; `npm test` PASS.
- [ ] **Step 2:** `npm run build && npm run start`, sjekk lokalt: `/bergen` med kjøretøy, Bybanen, rutelinjer, tavle, popup-lenke; `/bergen/linje/bybanen-1`; en `noindex`-linje; `/sitemap.xml`; `/` er fortsatt Oslo; velgeren bytter region.
- [ ] **Step 3:** Ny minnemåling (Task 11) med Bergen offentlig. < 420 MB.
- [ ] **Step 4:** Oppdater dokumentasjonen (regionmodell, `?region=`, tilstander, innholdsstier).
- [ ] **Step 5:** Commit; push bare etter brukerens ja. Etter deploy: `/health`, `/bergen`, én Bergen-linjeside, én guide, `/sitemap.xml`, `/`.
