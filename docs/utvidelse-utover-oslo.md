# Utvidelse utover Stor-Oslo: kartlegging

Målt 20.10.2026 kl. 23.58 (kveld, så antall kjøretøy er lavt). Alle tall fra engangskall mot Entur med `ET-Client-Name: ruterlive-web`.

## 1. Hardkodet Oslo/Ruter

| Sted | Hva | Konsekvens ved ny region |
|---|---|---|
| `server/vehicles-cache.js:11` `OSLO_BOUNDS` | bbox 59.45–60.2 / 10.15–11.25 i GraphQL-spørringen | Ingen GPS-kjøretøy utenfor |
| `js/api.js:4` `OSLO_BOUNDS` | samme bbox, dev/fallback | samme |
| `server/gtfs-stops-loader.js:19` `OSLO_BBOX` | 59.2–60.8 / 10.0–11.6 | ET-turer utenfor får ingen koordinater, holdeplass-søk/bbox tomt |
| `server/osm-rail-fetcher.js:11` `OSM_RAIL_BBOX` | jernbane-bbox Østlandet | ingen OSM-jernbane andre steder |
| `server/et-cache.js:8` | `datasetId=RUT&maxSize=3000`, én global cache (`cachedXml`) | må bli én cache per datasett |
| `js/et-api.js:9`, `vite.config.js` | `datasetId=RUT` i dev-sti | samme |
| `METRO_LINE_NUMS`/`TRAM_LINE_NUMS` (1–6, 11–19, ≥20 buss) i `et-vehicles-service.js:17`, `shape-service.js:16`, `js/et-api.js:15` | Oslo-nummerering | **Feil modus utenfor Oslo**, se under |
| `getLinePublicCode` / `getLineNum` (`/:Line:(\d+)/`) samme tre filer | linjenummer utledes fra LineRef | **Feil linjenummer**: `ATB:Line:2_11` → «2», `OST:Line:1_114` → «1», `KOL:Line:8_1006` → «8». Bybanen (`SKY:Line:1`/`2`) → T-bane |
| `server/jp-route-fetcher.js:63` `ROUTE_HUBS` | Oslo S, OSL, Oslo Bussterminal | tog/flybuss-oppdagelse kun fra Oslo |
| `server/jp-route-fetcher.js:70` `FALLBACK_RAIL_TRIPS` | 14 turer mot Oslo S; `'Oslo lufthavn'` hardkodet i nøkler (l. 148–191) | |
| `server/rail-fallback-shapes.js` | håndtegnede Østlandsbaner | |
| `server/flybuss-shapes.js` | statiske FB-ruter OSL | Flybussen Bergen/Værnes trenger egen kilde (JP) |
| `js/map.js:4` `OSLO_CENTER`, `DEFAULT_ZOOM` | startvisning | |
| `js/routes.js:78` | spesialregel for «oslo»/«lufthavn» i destinasjon | |
| `server/line-catalog.js` | 28 linjer, `authority: 'RUT'/'VYG'/'FLT'/'NBU'` | |
| `server/live-vehicles.js` `VEHICLE_MODES` | flytog/flybuss-moduser | ok generelt |
| `server/pages/line-page.js:19` | kart-lenke `lat=59.925&lng=10.75` | |
| `server/pages/guide-index.js:25,37,47`, `guide-catalog.js` | «i Oslo» i titler/tekst | |
| `index.html:6,13,18`, `public/manifest.json:4` | «Stor-Oslo»/«Oslo og omegn» | |
| `content/guider/*.html` (t-banen-i-oslo, trikken-i-oslo, flytoget-eller-flybussen, lokaltog …) | Oslo-innhold | gjenbrukes, nye trengs per region |

Domenenavnet livetrafikk.no er nøytralt og passer nasjonalt.

## 2. Entur-data per region

### Vehicles API (GPS), ett GraphQL-kall med alias per `codespaceId`

| Codespace | Region | Kjøretøy | Ferske (<5 min) | Moduser |
|---|---|---|---|---|
| RUT | Ruter | **0** | – | (ingen GPS, bekreftet) |
| SKY | Skyss, Vestland | 397 | 131 | BUS 349, FERRY 48 (ingen TRAM: Bybanen ikke sett) |
| ATB | AtB, Trøndelag | 142 | 83 | BUS 125, FERRY 14, TRAM 3 (Gråkallbanen) |
| KOL | Kolumbus, Rogaland | 103 | 80 | BUS 85, FERRY 18 |
| AKT | Agder | 243 | 84 | BUS, FERRY |
| BRA | Brakar, Buskerud | 62 | 13 | BUS |
| OST | Østfold | 34 | 19 | BUS |
| TRO / NOR / MOR / VOT / FIN / INN | Troms / Nordland / Møre / Vestfold(?) / Finnmark / Innlandet | 74 / 56 / 38 / 41 / 11 / 10 | | BUS, FERRY |
| VKT | Vestfold | 0 | – | |
| VYG, FLT, GOA, SJN | tog | 63, 7, 5, 5 | de fleste | RAIL (allerede inne via bbox) |

- De fleste regioner utenfor Oslo **har GPS**. Det er bare Ruter som må interpoleres fra ET.
- Mange «kjøretøy» er gamle (median alder SKY 23 min, AKT 16 min, TRO 26 min): parkerte busser. Koden filtrerer ikke på `lastUpdated` i dag, så et filter (f.eks. < 5 min) blir nødvendig.
- Hele landet uten filter er ett kall på ca. 100 KB om kvelden (ca. 1 300 kjøretøy). På dagtid er det trolig 3–5× så mye, altså noen hundre KB. Det er billig.

### SIRI ET (`/realtime/v1/rest/et?datasetId=<ID>&maxSize=10`)

| Dataset | Svar | Bytes/tur | VehicleRef | Merknad |
|---|---|---|---|---|
| SKY | 200 | 12,6 KB | ja (samme format som GPS-`vehicleId`) | |
| ATB | 200 | 20,1 KB | ja | har `PublishedLineName` |
| KOL | 200 | 17,0 KB | **nei** | LineRef `KOL:Line:8_1006` |
| OST | 200 | 15,9 KB | **nei** | LineRef `OST:Line:1_114` |
| VKT | 200 | tom | – | 452 linjer i GTFS, men ingen ET eller GPS (Vestfold trolig under annen kodeplass, sjekk VOT) |
| BRA, INN, AKT | **429** | – | – | `Quota limit exceeded. Identifier : ruterlive-web-et` |

**Viktig funn:** ET-kvoten gjelder **per klientnavn for hele ET-endepunktet** (`ruterlive-web-et`), ikke per datasett. Fem raske kall med maxSize=10 var nok til å bli strupet. Produksjon deler den samme kvoten. Flere datasett hvert 90. sekund må derfor spres i tid, og man bør be Entur om høyere kvote.

Duplikater: `live-vehicles.js` slår sammen GPS og ET på `vehicleId`. Det fungerer for SKY og ATB (VehicleRef = GPS-id). For KOL og OST, som mangler VehicleRef, blir hvert GPS-kjøretøy dobbelt. Der GPS finnes, bør ET bare brukes til fra/til/via og rutekart, ikke til egne kjøretøy. Alternativt kan man matche på `serviceJourney.id` (feltet finnes i Vehicles API).

### GTFS (routes.txt, linjer per kodeplass)

RUT 391 · SKY 434 (2 bybane, 58 båt) · ATB 407 (1 trikk, 20 båt) · KOL 318 · VKT 452 · INN 372 · NOR 236 · AKT 208 · MOR 190 · OST 175 · TRO 170 · BRA 143 · TEL 124 · FIN 104.

## 3. Serverkostnad (heap 384 MB)

| Post | Oslo i dag | Bergen + Trondheim + Stavanger | Hele Norge |
|---|---|---|---|
| GTFS-quays i Map | 16 638 | +8 390 (4 717 / 1 644 / 2 029) | 90 429 |
| Map + stops-streng (målt) | ~23 MB | ~27 MB | ~36 MB |
| Toppminne GTFS-lasting | 95 MB zip-buffer + AdmZip + 9,9 MB stops.txt, **uavhengig av bbox** | samme | samme |
| `getGtfsQuayCache()` kopierer hele Map ved hvert kall (ET hvert 15. s, shapes, quay-coords) | ~5 MB søppel/kall | ~7 MB | ~20 MB |
| ET DOM (xmldom, målt) | 12,6 MB XML → **145 MB heap**, 210 ms CPU | SKY trolig 0,5–0,7× RUT (+70–100 MB) | 3 000 turer → 435 MB: **umulig** |

Konklusjoner:
- **(a) GTFS:** Hele Norge koster bare ~13 MB ekstra i Map-en. Toppen ved nedlasting er den egentlige risikoen. Den kan løses ved å lese bare `stops.txt` (2,5 MB komprimert) med HTTP Range mot zip-en, eller ved å strømme filen.
- **(b) ET:** DOM-parsing er flaskehalsen. RUT bruker alene ~40 % av heapen hvert 15. sekund, og `shape-service.js` parser den samme XML-en en gang til. Et andre ET-datasett med DOM fører trolig til OOM. Før en ny ET-region må parsingen gjøres strømmende (SAX/regex per `EstimatedVehicleJourney`, ca. 10–20 MB). Regioner med GPS trenger ikke ET-posisjoner i det hele tatt.
- **(c) Kallvolum i dag:** ET 1/90 s (960/døgn), Vehicles 1/20 s (4 320/døgn), JP-batcher hver time og linjesider (24 t cache). Vehicles nasjonalt er fortsatt bare ett kall. Hvert ET-datasett gir +960/døgn mot den felles kvoten. Med 3 datasett må kallene spres (f.eks. 30 s mellom hvert). Nasjonalt (~15 datasett) krever avtale med Entur, eller å droppe ET der GPS finnes. ET støtter `requestorId` (bare endringer siden forrige kall), og det reduserer volumet kraftig.
- **(d) Kartfliser:** CARTO gir 1 mill. fliser/mnd gratis, deretter USD 500/mnd. En økt gir anslagsvis 50–150 fliser (retina `{r}` dobler oppløsningen), altså en grense på rundt 7 000–20 000 økter/mnd. Flere regioner gir mer trafikk og når grensen raskere. Kartverket (gratis, CC BY 4.0, ingen nøkkel, dekker Norge) fjerner kvoterisikoen og bør gjøres **før** utvidelsen. Ulemper: ikke noe mørkt kart (CSS-filter eller behold CARTO for mørkt tema), og fair use-vilkårene må sjekkes.
- **Klientpayload:** `/api/initial-data` sender **alle** rutekart hvert 30. sekund. Med flere regioner må den filtreres per region eller viewport, ellers blir svaret flere MB.

## 4. Arkitekturvalg

| | A) Region-parameter, sti per region (`/bergen`, `/trondheim`), cache per region lastet ved behov | B) Viewport-styrt, hele Norge | C) Egen deploy per region |
|---|---|---|---|
| Minne | Bare aktive regioner i minnet, med ventetid ved kald start | Alt må være lastet: ET for alle datasett er umulig på 384 MB | 384 MB hver, dagens kode nesten uendret |
| Entur-kvote | Kontrollerbar (ET bare for regioner uten GPS) | Høyest | Én kvote per klientnavn (eller delt), gir uryddig drift |
| Kode | Middels: region-config gjennom server og klient | Stor: romlig indeks, bbox-API, ny klientflyt | Liten nå, stor vedlikeholdsbyrde (×N kopier) |
| SEO/AdSense | Best: `/bergen/linje/…` og guider per region på ett domene, én AdSense-konto og samlet domeneautoritet | Kart uten regionsider gir ingen innholdsgevinst i seg selv | Underdomener deler autoritet dårligere, og hver må godkjennes separat |
| UX | Regionvelger; kart sentreres per region | Sømløst | Brudd mellom regioner |

**Anbefaling: A**, med region som config-objekt (`id`, `bbox`, `center`, `zoom`, `etDatasets`, `gpsCodespaces`, `hubs`, `modeRules`) og stier `/`(Oslo), `/bergen`, `/trondheim`, `/stavanger`. Vehicles-kallet kan gjerne være nasjonalt, med filtrering per region på serveren, siden det er billig. Rutekart og ET hentes per region og bare når det trengs. B kan komme senere oppå A, siden quay-Map for hele Norge allerede er billig.

SEO: GTFS har ~400 linjer hver for SKY og ATB og ~320 for KOL. Linjesider for bybane, trikk, båt og de største buss-/ekspresslinjene (20–40 per region) pluss 3–5 guider per region (f.eks. «Bybanen i Bergen», «Hurtigbåt Stavanger», «Gråkallbanen») gir trolig 5–10× dagens innholdsflate. Hold kartet fri for annonser (`/bergen` er også kart, så `isMapPath` må utvides). `line-catalog.js` må få `region` og regionsensitiv `countVehiclesForLine`.

## 5. Faseplan

| Fase | Innhold | Grovt estimat |
|---|---|---|
| 0. Forarbeid | Kartverket-fliser. Strømmende ET-parser i stedet for xmldom (heap 145 → ~20 MB), én parse delt av `et-vehicles-service` og `shape-service`. GTFS bare stops.txt via Range/strøm. Ingen kopi i `getGtfsQuayCache`. Filter på `lastUpdated` | 3–5 dager |
| 1. Region-config, bare Oslo | `config/regions.js` med Oslo. Alle bbox-er, dataset, hubs, senter og tekster leses derfra. Modus-/linjelogikken samles i `shared/` (fjerner de tre kopiene). Linjenummer fra JP `publicCode` i stedet for regex. Tester som bekrefter at Oslo-utdata er uendret | 3–4 dager |
| 2. Første ekstra region: Bergen (Skyss) | GPS-først (397 busser/båter), ET bare for fra/til og rutekart og Bybanen. Dedup på `serviceJourney.id`. `/bergen` kart + 10–20 linjesider + 2–3 guider. Regionvelger. Be Entur om høyere ET-kvote | 4–6 dager + innhold |
| 3. Trondheim og Stavanger | Gjenbruk; AtB-LineRef `2_11`-format og KOL uten VehicleRef testes. Innhold per region | 2–3 dager per region + innhold |
| 4. Nasjonalt | Vehicles nasjonalt med viewport-filtrering, rutekart og ET lastet per viewport/region ved behov, `requestorId`-delta for ET, eventuelt oppgradering fra Render free (512 MB → 2 GB, ~USD 7–25/mnd) | 1–2 uker |

## Hovedrisikoer

1. **Minne:** DOM-parsing av ET (145 MB for RUT alene) gir OOM med én ekstra ET-region. Fase 0 er en forutsetning.
2. **Entur-kvote:** ET-kvoten er felles for klientnavnet (`ruterlive-web-et`) og ble utløst av 5 små kall. Flere datasett risikerer 429 for Oslo også. Kallene må spres, man bør bruke `requestorId` og kontakte Entur.
3. **Feil data utenfor Oslo:** Linjenummer- og modus-fallbacken (`/:Line:(\d+)/`, 1–6 = T-bane) gir gale linjer (AtB «2», Bybanen som T-bane). Duplikater oppstår der ET mangler VehicleRef (KOL, OST), og parkerte GPS-kjøretøy vises uten et `lastUpdated`-filter.

Usikkert, sjekk på dagtid: om Bybanen og Gråkallbanen leverer GPS, ET-volum per datasett (målt bare med maxSize=10) og Vestfold-kodeplassen (VKT vs VOT).
