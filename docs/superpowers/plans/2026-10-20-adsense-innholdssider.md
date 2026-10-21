# Innholdssider for AdSense – implementeringsplan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Serverrenderte linjesider og guider med Auto ads, kart uten annonser, sitemap og ekte 404.

**Architecture:** Express rendrer alle innholdssider med én felles mal (`server/pages/layout.js`). Linjesider henter stoppliste fra Entur JP (`line(id).journeyPatterns`, cache 24t) og antall kjøretøy fra samme sammenslåtte data som `/api/initial-data`. Guidetekster ligger som HTML-fragmenter i `content/guider/` og pakkes inn i malen av serveren.

**Tech Stack:** Node 20, Express 4, `node:test`. Ingen nye avhengigheter.

**Spec:** `docs/superpowers/specs/2026-10-20-adsense-innholdssider-design.md`

**Avvik fra spec (begrunnet):**
- Guider og `/om` rendres av serveren fra fragmenter i stedet for Vite-inngangspunkter: én mal, ett sted for AdSense-script og footer.
- Linjesider bruker JP `journeyPatterns` i stedet for `getAllShapes()`: rutedataene mangler stoppnavn for tog og dekker ikke alle linjer.
- Faktisk linjeliste fra Entur 2026-10-20: T-bane 1–5; trikk 12, 13, 15, 17, 18, 19; tog L1, L2, R12, R13, R14, R21, R22, R23, RE10, RE11, RE20, RE30; Flytoget FLY1, FLY2; flybuss FB1, FB3, FB5. 28 sider.

## Global Constraints

- All sidetekst på norsk bokmål. Kort, konkret. Ingen standardinnledninger, fyllfraser, oppsummering til slutt, punktlister overalt eller superlativer.
- Byline «livetrafikk.no» + dato. Ingen oppdiktet forfatter eller opplevelser.
- Fakta i tekst skal være verifisert mot Entur JP; uverifiserbart utelates.
- AdSense: kun `<script async src="https://pagead2.googlesyndication.com/pagead/js/adsbygoogle.js?client=ca-pub-1298230222793785" crossorigin="anonymous"></script>` i `<head>` på innholdssider. Ingen `<ins>`, ingen slot. Aldri på kartet, 404 eller personvern.
- Alle Entur-kall: header `ET-Client-Name: ruterlive-web`.
- Alle dynamiske strenger i HTML går gjennom `escapeHtml`.
- Nye ruter i `server.js` står før `express.static` og catch-all.
- Ingen nye npm-avhengigheter.

## Review Focus

- Kald start (JP ikke svart ennå / JP nede): linjesiden gir 200 med intro og «Stoppliste lastes, prøv igjen om litt», aldri 500 eller tom side. → Task 2 test `renderLinePage uten stopp`.
- Stoppnavn med `&`, `<`, `"` (f.eks. «Jernbanetorget [4311]»): escapes korrekt. → Task 1 test `escapeHtml`.
- Ukjent slug `/linje/finnes-ikke` og `/guider/finnes-ikke`: 404-side, ikke kartet. → Task 4 test `isMapPath` + lokal verifisering.
- Kart-URL med query (`/?lat=59.9&lng=10.7&z=13`) og `/index.html`: fortsatt kartet. → Task 4 test `isMapPath`.
- x-varianter (R13x, L2x, R23x, RX11): kjøretøy telles på hovedlinjens side. → Task 2 test `countVehiclesForLine`.

---

### Task 1: Felles sidemal og testoppsett

**Files:**
- Create: `server/pages/layout.js`, `public/content.css`, `test/layout.test.js`
- Modify: `package.json` (script `"test": "node --test"`)

**Interfaces:**
- Produces: `escapeHtml(value: unknown) -> string`; `renderPage({ title: string, description: string, path: string, body: string, ads?: boolean, noindex?: boolean }) -> string` (komplett HTML-dokument).

- [ ] **Step 1: Skriv test** `test/layout.test.js`:
  - `escapeHtml('A & B <"x">')` === `'A &amp; B &lt;&quot;x&quot;&gt;'`; `escapeHtml(null)` === `''`.
  - `renderPage({title:'T', description:'D', path:'/om', body:'<p>x</p>'})` inneholder `adsbygoogle.js?client=ca-pub-1298230222793785`, `<link rel="canonical" href="https://livetrafikk.no/om">`, `<meta name="description" content="D">`, `<p>x</p>`.
  - Med `ads:false` og `noindex:true`: inneholder ikke `adsbygoogle`, inneholder `<meta name="robots" content="noindex">`.
- [ ] **Step 2:** `npm test` → FAIL (modul finnes ikke).
- [ ] **Step 3: Implementer.** `ads` default `true`. Mal: `lang="nb"`, samme tema-script og favicon som `index.html`, `<link rel="stylesheet" href="/content.css">`. Header: «livetrafikk.no» (lenke `/`), nav: Kart `/`, Guider og linjer `/guider`, Om `/om`. Footer: Personvern `/personvern.html`, Kontakt `https://apptastic.no/pages/contact/`, «Data fra Entur». `content.css`: les-vennlig kolonne (maks ~42rem), samme fargevariabler som `css/style.css` (lys/mørk via `data-theme`), tabeller/lister for stopplister, systemfont, relative størrelser.
- [ ] **Step 4:** `npm test` → PASS.
- [ ] **Step 5:** Commit «Felles sidemal for innholdssider».

### Task 2: Linjekatalog, stopplister og kjøretøytelling

**Files:**
- Create: `server/line-catalog.js`, `server/live-vehicles.js`, `server/pages/line-page.js`, `test/line-catalog.test.js`, `test/line-page.test.js`
- Modify: `server.js` (`/api/initial-data` bruker `getMergedVehicles()`; ny rute `GET /linje/:slug`; prewarm ved oppstart)

**Interfaces:**
- Produces:
  - `LINES: Array<{ slug, code, aliases: string[], authority: 'RUT'|'VYG'|'FLT'|'NBU', mode: 'metro'|'tram'|'rail'|'flytog'|'flybuss', title, intro }>`; slugs: `t-bane-1`…`t-bane-5`, `trikk-12`…, `tog-l1`, `tog-r12`…, `flytoget-fly1`, `flytoget-fly2`, `flybuss-fb1`, `flybuss-fb3`, `flybuss-fb5`. `aliases`: `R13→['R13x']`, `L2→['L2x']`, `R23→['R23x']`, `RE11→['RX11']`, `RE20→['RX20']`.
  - `getLineBySlug(slug) -> line | undefined`
  - `pickMainPattern(journeyPatterns) -> { stops: string[], from, to } | null` — mønsteret med flest `serviceJourneys`; ved likhet flest quays.
  - `async getLineStops(line) -> { stops, from, to } | null` — slår opp JP-ID via `lines(publicCodes:[...])` filtrert på `id.startsWith(authority + ':')` (én spørring for alle linjer, cache 24t), deretter `line(id){ journeyPatterns { quays { name } serviceJourneys { id } } }`, cache 24t per linje, timeout 5 s, `null` ved feil.
  - `prewarmLineStops() -> Promise<void>` — henter alle sekvensielt.
  - `server/live-vehicles.js`: `async getMergedVehicles() -> vehicle[]` = `(await getLiveData()).vehicles`; `async getLiveData() -> { vehicles, routeShapes }` er logikken flyttet uendret fra `/api/initial-data`, som nå kaller den (`mergeShapes`/`getAllShapes` flyttes med eller sendes inn); `countVehiclesForLine(vehicles, line) -> number` (match `line.publicCode` mot `code` + `aliases`, case-insensitive).
  - `renderLinePage(line, stopsResult | null, vehicleCount: number) -> string`.

- [ ] **Step 1: Skriv tester.**
  - `pickMainPattern` med tre mønstre (566/43 quays, 550/43, 16/19) → stopp fra det første; `[]` → `null`.
  - `countVehiclesForLine([{line:{publicCode:'R13x'}},{line:{publicCode:'r13'}},{line:{publicCode:'R14'}}], R13)` === 2.
  - `getLineBySlug('t-bane-5').code === '5'`; alle slugs unike; `LINES.length === 28`; ingen tom `intro`.
  - `renderLinePage(T-bane 5, {stops:['A & B','C'],from:'A & B',to:'C'}, 3)`: inneholder `<ol>`, `A &amp; B`, `3`, `href="/?lat=59.925&amp;lng=10.75&amp;z=12"`, adsbygoogle. Samme for en toglinje: `z=10`. (Fast kartutsnitt per modus: metro/trikk `z=12`, tog/flytog/flybuss `z=10`, alltid `lat=59.925&lng=10.75`.)
  - `renderLinePage uten stopp` (`null`, 0): inneholder `Stoppliste lastes, prøv igjen om litt` og intro.
- [ ] **Step 2:** `npm test` → FAIL.
- [ ] **Step 3: Implementer** modulene. Intro-tekster (2–4 setninger hver) skrives i `LINES` etter at faktaene er hentet: kjør spørringen fra `getLineStops` for alle 28 linjer, noter endestopp, antall stopp, operatør, og skriv kun det som står der eller er allment kjent og sjekkbart (f.eks. hvilke områder linjen betjener ut fra stoppnavnene). Ingen reisetider eller frekvenser som ikke er hentet fra Entur.
  - Sidens innhold: h1 `title`, byline «livetrafikk.no · oppdatert <dato for siste vellykkede JP-henting, ellers dagens dato>», intro, «Ute akkurat nå: N kjøretøy» (utelates for flybuss hvis 0, da flybuss ikke alltid har sanntid), stoppliste `<ol>` med «Fra X til Y, N stopp», knapp «Se linjen på kartet», lenker til de andre linjene av samme modus.
  - `server.js`: `app.get('/linje/:slug')` → 404 via `renderNotFound` (Task 4) hvis ukjent; ellers `Promise.all([getLineStops(line), getMergedVehicles().catch(() => [])])`, `Cache-Control: public, max-age=300`. Til Task 4 finnes: bruk `res.status(404).send('Ikke funnet')`.
  - Oppstart: `setTimeout(prewarmLineStops, 20000)` etter `listen`.
- [ ] **Step 4:** `npm test` → PASS.
- [ ] **Step 5:** Commit «Linjesider med stoppliste fra Entur og antall kjøretøy».

### Task 3: Guider, /guider og /om

**Files:**
- Create: `server/guide-catalog.js`, `server/pages/guide-index.js`, `content/guider/*.html` (6 stk), `content/om.html`, `test/guides.test.js`
- Modify: `server.js` (ruter `GET /guider`, `GET /guider/:slug`, `GET /om`)

**Interfaces:**
- Produces: `GUIDES: Array<{ slug, title, description, published: 'YYYY-MM-DD', updated: 'YYYY-MM-DD' }>`; `getGuideBySlug(slug)`; `async loadGuideBody(slug) -> string` (leser `content/guider/<slug>.html`, cache i minnet); `renderGuidePage(guide, body) -> string`; `renderGuideIndex(GUIDES, LINES) -> string`; `renderAboutPage(body) -> string`.
- Slugs: `sanntidsposisjoner`, `t-banen-i-oslo`, `trikken-i-oslo`, `flytoget-eller-flybussen`, `lokaltog-og-regiontog`, `slik-bruker-du-kartet`.

- [ ] **Step 1: Skriv tester.** Hver `GUIDES`-slug har fil i `content/guider/`; hver fil har 600–1200 ord (strip tags, split på whitespace); ingen fil inneholder frasene «I en verden», «Det er viktig å merke seg», «Oppsummering», «Konklusjon», «Alt i alt», «Kort fortalt»; `renderGuideIndex` inneholder lenke til hver guide og hver linje.
- [ ] **Step 2:** `npm test` → FAIL.
- [ ] **Step 3: Hent fakta** fra Entur JP (linjer, endestopp, antall stopp, operatører, Flytogets stopp) og fra koden (hvordan posisjoner beregnes: `server/et-vehicles-service.js`, `server/vehicles-cache.js`, polling hvert 30 s, ET hvert 90 s).
- [ ] **Step 4: Skriv tekstene** etter Global Constraints. Variert setningslengde, mest løpende tekst, mellomtitler der de hjelper, lenker til relevante linjesider. `sanntidsposisjoner` forklarer ærlig at Ruter-kjøretøy vises med beregnet posisjon og hva det betyr for nøyaktigheten. `om.html` bygger på dagens om-tekst i `index.html`, synlig og utvidet til ~300 ord.
- [ ] **Step 5: Implementer** katalog, rendering og ruter. `/guider` viser guider (tittel + beskrivelse) og linjer gruppert per modus. Ukjent slug → 404.
- [ ] **Step 6:** `npm test` → PASS.
- [ ] **Step 7:** Commit «Guider, guideoversikt og Om-side».

### Task 4: Sitemap, robots, 404 og kart uten annonser

**Files:**
- Create: `server/pages/sitemap.js`, `server/pages/not-found.js`, `test/sitemap.test.js`
- Modify: `server.js` (`/sitemap.xml`, robots-linje, catch-all), `index.html` (fjern AdSense-footer og skjult om-seksjon; lenke «Guider» i `.header-links`), `js/main.js` (fjern `initAboutSection`), `css/style.css` (fjern `.ad-footer`- og `.about-*`-regler som ikke lenger brukes)

**Interfaces:**
- Produces: `buildSitemap({ lines, guides, today }) -> string`; `isMapPath(path: string) -> boolean`; `renderNotFound() -> string` (`ads:false`, `noindex:true`, lenker til kart og guider).

- [ ] **Step 1: Skriv tester.** `buildSitemap` inneholder `https://livetrafikk.no/`, `/guider`, `/om`, `/personvern.html`, alle `/linje/<slug>` og `/guider/<slug>`, `<lastmod>` = `updated` for guider. `isMapPath('/')`, `isMapPath('/index.html')` → true; `isMapPath('/foo')`, `isMapPath('/linje/x')` → false (query er ikke del av `path`).
- [ ] **Step 2:** `npm test` → FAIL.
- [ ] **Step 3: Implementer.** Catch-all: `isMapPath(req.path)` → `dist/index.html`, ellers `404` + `renderNotFound()`. Bytt midlertidige 404-er fra Task 2–3 til `renderNotFound()`. robots.txt får `Sitemap: https://livetrafikk.no/sitemap.xml`. `/sitemap.xml`: `application/xml`, `max-age=3600`.
- [ ] **Step 4:** `npm test` → PASS.
- [ ] **Step 5:** Commit «Sitemap, 404-side og kart uten annonser».

### Task 5: Dokumentasjon, lokal verifisering, publisering

**Files:**
- Modify: `CLAUDE.md`, `README.md`, `DEPLOY.md`, `ADSENSE.md`

- [ ] **Step 1:** Oppdater docs: sidestruktur og hvor tekst/linjer ligger; Auto ads kun på innholdssider; rett «serveren cacher ikke kjøretøy» (README, DEPLOY) til 20 s cache; `npm test`. Commit `CLAUDE.md` (fortsatt usporet) sammen med dette.
- [ ] **Step 2:** `npm test && npm run build && PORT=3100 npm run start` i bakgrunnen.
- [ ] **Step 3:** Før JP-prewarm (første 20 s): `curl -s localhost:3100/linje/t-bane-5` inneholder intro (og enten stoppliste eller «Stoppliste lastes»). Etter ~60 s: alle 28 `/linje/*`, 6 `/guider/*`, `/guider`, `/om` → 200 med stoppliste/innhold og `adsbygoogle`; `/` → 200, ingen `adsbygoogle`; `/?lat=59.9&lng=10.7&z=13` → kartet; `/finnes-ikke`, `/linje/finnes-ikke` → 404 uten `adsbygoogle`; `/sitemap.xml` gyldig XML (`xmllint --noout`); `/robots.txt` har Sitemap-linje; `/personvern.html`, `/ads.txt` → 200.
- [ ] **Step 4:** Se én linjeside, én guide og kartet i nettleser ved 390 px og 1280 px bredde, lys og mørk.
- [ ] **Step 5:** Commit eventuelle rettelser. `git push origin main` (godkjent av bruker).
- [ ] **Step 6:** Vent på Render-deploy (poll `https://livetrafikk.no/sitemap.xml` til 200). Sjekk `/health`, `/linje/t-bane-1`, `/guider/sanntidsposisjoner`, `/finnes-ikke` (404) og at `/` ikke har `adsbygoogle`.
