# Avvik for hele landet

Dato: 2026-11-05

## Mål

Vise avvik (SIRI SX «situations») fra hele Norge: på kartet, i avgangstavla, i kjøretøy-popupen, på linje- og holdeplassider og på en egen side `/avvik`. Bygget uten Oslo- eller Bergen-binding, så det virker uendret når kartet utvides til hele landet.

Avgjort med brukeren:

- Avvik for hele landet, pluss en egen side `/avvik`.
- `/avvik` har egen tekst (300–500 ord) og annonser (Auto ads), og indekseres.
- Sidebeskrivelser og sidenavn som bare nevner Oslo, oppdateres (se «Tekster om hele nettstedet»).

Utenfor: push-varsler, engelsk side, egne undersider per område, utvidelse av kartet til hele landet (eget prosjekt).

## Datakilde

Entur Vehicles-API (`https://api.entur.io/realtime/v2/vehicles/graphql`), `situations` uten `codespaceId` (hele landet), header `ET-Client-Name: ruterlive-web`. Entur ønsker ikke Journey Planner til avvik. Ingen ET-kvote brukes.

Målt 2026-11-05: 313 avvik (284 aktive), ~210 kB JSON. RUT 47, SKY 30, ATB 28, KOL 7, VYG 0. Felt: `situationNumber`, `codespace`, `severity` (`noImpact`, `slight`, `normal`, `severe`, `verySevere`, `undefined`), `reportType`, `progress`, `planned`, `validityPeriods { startTime endTime }`, `summary`/`description`/`advice { value language }` (språk `NO`, `EN` eller null), `infoLinks { uri }`, `affects { stopPoints { id name } affectedLines { line { lineRef publicCode } } }`.

## Server

`server/situations.js`:

- Henter hele landet hvert 2. minutt (ett kall, felles for alle brukere), timeout 15 s, `fetchWithRetry`.
- Normaliserer til `{ id, codespace, severity, planned, validity: [{ start, end }], summary, description, advice, links, lines: [{ ref, code }], stops: [{ id, name }] }`. Tekst: norsk (`NO`, `nb`, `nn` eller null) foran engelsk. Avvik uten oppsummering droppes. Lenker bare `http(s)`.
- Beholder avvik som gjelder nå eller starter innen 24 timer; `progress: closed` droppes.
- Indekser: per `lineRef`, per holdeplass-id (både `NSR:Quay` og `NSR:StopPlace` slik Entur sender dem; holdeplassider slår opp sine quay-id-er og stopPlace-id), per kodeområde.
- Feil hos Entur: forrige liste brukes i inntil 15 min, deretter tom liste (heller ingen avvik enn gamle). Logg på norsk.
- Minne: < 1 MB.

API:

- `/api/situations?region=<id>`: avvik for regionens kodeområder (`region.situationCodespaces`) pluss tog (`VYG`, `GOA`, `SJN`, `FLT`, `BNR`), sortert etter alvorlighet, så linjekode. Ukjent region gir 400 som de andre endepunktene. Forhåndskomprimert med ETag (`server/json-cache.js`), `Cache-Control: public, max-age=60`.
- Avgangstavla (`/api/departures`) og kjøretøyene trenger ikke nye felt: klienten slår opp linje og holdeplass i lista fra `/api/situations`.

`shared/regions.js` får `situationCodespaces` per region (Oslo `['RUT']`, Bergen `['SKY']`). `shared/situation-areas.js` gir navn og rekkefølge for kodeområdene på `/avvik` (f.eks. RUT «Ruter (Oslo og Akershus)», SKY «Skyss (Vestland)», ATB «AtB (Trøndelag)», KOL «Kolumbus (Rogaland)», tog samlet som «Tog»). Ukjente kodeområder vises under «Andre» med koden.

## Kart

- Knapp «Avvik» ved «Vis min posisjon»: varseltrekant-ikon og et tall (avvik med alvorlighet over `noImpact` i regionen). Mobil: bare ikon og tall. Desktop: ikon og tekst. Uten avvik: ikon uten tall. Tilgjengelig navn «Avvik (N)».
- Klikk åpner et panel (samme mønster som eksisterende ark/paneler): lista sortert etter alvorlighet, så linje. Hvert avvik: oppsummering, linjemerker, gyldighet, «Vis mer» for beskrivelse og råd. Trykk på et linjemerke markerer linja på kartet (samme funksjon som linjesøket).
- Kjøretøy-popupen: «⚠ Avvik på linja» med oppsummeringen(e) når linja har aktive avvik (match på `lineRef`, ellers kodeområde + linjekode).
- Avgangstavla: avganger på linjer med avvik får et lite varselmerke; avvik for selve holdeplassen vises øverst i tavla.
- Lista hentes ved oppstart og hvert 2. minutt mens fanen er synlig (`js/visibility.js`), med `withRegion`.

## Sider

- `/avvik` (`server/pages/situations-page.js`): egen tekst øverst (`content/avvik.html`, 300–500 ord: hva avvik er, hvor de kommer fra, alvorlighet og gyldighet, hvordan de vises på kartet). Deretter hopplenker til hvert område og avvikene gruppert per område. Hvert avvik: oppsummering, beskrivelse, råd, gyldighet, berørte linjer (lenke til linjeside når den finnes og er indeksert) og holdeplasser (lenke til holdeplasside når den finnes). Annonser via `renderPage` (Auto ads), indekseres, i sitemap, `Cache-Control: public, max-age=120`. All operatørtekst escapes.
- Uten avvik for et område vises ikke området. Uten data (Entur nede > 15 min) vises teksten og «Avvik er ikke tilgjengelige akkurat nå.».
- Linje- og holdeplassider: boks «Avvik nå» med aktive avvik for linja/holdeplassen; ingenting når det ikke finnes. Oslo-sider er uendret når det ikke finnes avvik.
- Lenke til `/avvik` i sidemenyen og bunnteksten.

## Tekster om hele nettstedet

Nettstedet dekker nå Oslo, Bergen og tog i hele Norge, og får avvik for hele landet. Oppdateres:

- `index.html` (Oslo-kartet på `/`): `<title>`, `meta description`, `og:`/`twitter:`, `<noscript>`-teksten og intro i kartmenyen nevner Oslo, Bergen og tog i hele Norge, f.eks. tittel «Sanntidskart for kollektivtrafikken i Oslo, Bergen og hele Norge | livetrafikk.no». Regionkartet (`/bergen`, `server/pages/region-map.js`) må fortsatt bytte tittel/beskrivelse; testen mot `dist/index.html` sikrer det.
- `public/manifest.json` `description`.
- Om-siden (`content/om.html`) og meta-beskrivelsen i `server/pages/guide-index.js`: nevner Bergen og avvik.
- JSON-LD i `index.html`: `description` for hele nettstedet.

Tekstregler som før: kort, uten standardinnledninger, fyllfraser, oppsummering eller oppdiktet forfatter.

## Testing

- `npm test`: normalisering (språk, gyldighet, `closed`, lenker), indekser per linje og holdeplass, region-filter og sortering, feil hos Entur (forrige liste ≤ 15 min, så tom), `/api/situations` (400 for ukjent region, ETag), `/avvik` (grupper, escaping av `<script>` i operatørtekst, lenker bare til eksisterende sider, annonser med), linje-/holdeplassboks, knappens tall (ignorerer `noImpact`), sitemap med `/avvik`.
- Uendret: Oslo-kartets AdSense-fravær, eksisterende tester grønne.
- Lokalt: `npm run build && npm run start`, `/avvik`, knapp og panel på `/` og `/bergen`, popup, tavle.
- Minnemåling (`npm run memcheck -- --regions oslo,bergen`) < 420 MB før push.
- Etter deploy: `/avvik`, `/api/situations`, `/`, `/bergen`.
