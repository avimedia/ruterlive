# Flere regioner, først Bergen

Dato: 2026-11-05

## Mål

Bergen med samme innhold som Oslo: kart med alle kjøretøy, rutelinjer, holdeplasser, avgangstavler, linjesider, holdeplassider og guider. Bygget slik at Trondheim, Stavanger og senere regioner i hovedsak er en ny oppføring i `shared/regions.js` pluss innhold.

Avgjort med brukeren:

- Full paritet med Oslo.
- Oslo blir på roten (`/`, `/linje/…`, `/guider/…`, `/holdeplass/…`). Nye regioner får alt under `/<region>/…`.
- Region velges automatisk fra posisjon, med regionvelger og husket valg som reserve.
- Én server med data per region, og oppdatering etter bruk.
- Render Starter (512 MB) beholdes hvis målingen viser at det holder.

Utenfor: Trondheim/Stavanger, annonser på kartet (brukeren vurderer), betalt Render-plan.

## Regionmodell

`shared/regions.js` får alt som skiller regionene. Koden spør regionen og har ingen `if (region === 'bergen')`:

| Felt | Oslo | Bergen |
|---|---|---|
| `id`, `name`, `path` | `oslo`, «Oslo og Viken», `''` | `bergen`, «Bergen og Vestland», `/bergen` |
| `center`, `defaultZoom` | som i dag | Byparken, 14 |
| `vehicleBounds`, `stopsBounds`, `geometryBounds` | som i dag | Bergen og omegn (avklares mot data) |
| `etDatasets` | `['RUT']` | `['SKY']` |
| `authorities` (linjesider, `ref`-prefiks) | `RUT`, … | `SKY`, … |
| `lineNumberFallback` | `'ruter'` | `null` (bare JP sin `transportMode`) |
| `alwaysActive` | `true` | `false` |
| `airportBus` | statisk FB1/3/5 | fra JP hvis Flybussen Bergen finnes i Entur, ellers ingen |

Nye regioner kan trenge flere felt senere, f.eks. linjekodeformat (`ATB:Line:2_11`) eller manglende `VehicleRef` (KOL). Slike felt legges til når regionen kommer, ikke nå.

## Server

### Data per region

Tjenestene som i dag er Oslo-bundet tar en region og holder én tilstand per region: `et-cache`, `et-vehicles-service`, `shape-service`, `line-geometry`, `vehicle-route`, `live-vehicles`, `vehicles-payload`, `stop-service`, `line-catalog`. Én region-modul (`server/region-runtime.js`) eier tilstanden per region og starter/stopper oppdateringene.

Felles for alle regioner, hentet én gang:

- GPS-kjøretøy (Entur Vehicles): ett kall uten region, fordelt per region på serveren etter `vehicleBounds`.
- Tog: allerede nasjonalt (`rail-live`, `rail-network`).
- Holdeplasser: én lesing av GTFS-zipen, filtrert til summen av regionenes `stopsBounds`.
- Linjemoduser (`line-modes`): én cache.

### Tilstander

| Tilstand | Når | Hva skjer |
|---|---|---|
| aktiv | besøk siste 10 min, eller `alwaysActive` | ET hentes som i dag (90 s), alt oppdateres |
| hvilende | 10–60 min uten besøk | siste kopi beholdes, ingen ET-henting |
| avlastet | > 60 min uten besøk | ET-reisene slippes; rutelinjer og holdeplasser beholdes |

Et besøk er et kall til `/api/vehicles-live?region=…` (eller tavle/linjeside i regionen). Et besøk i hvilende region starter ny ET-henting med én gang. I avlastet region viser første svar GPS-kjøretøyene med en gang, og ET-kjøretøyene (Bybanen) kommer etter første henting (anslått 2–5 s, måles).

ET-henting for ulike regioner forskyves, så to store parsinger aldri kjører samtidig.

### API

Alle regionsensitive endepunkter får `?region=` (standard `oslo`, så gamle klienter virker): `/api/vehicles-live`, `/api/route-shapes-all`, `/api/initial-data`, `/api/vehicle-route`, `/api/stops-in-bbox`, `/api/stops-search`. `/api/departures` er uavhengig av region (quay-ID-er). `shapesVersion` og cache-nøkler inkluderer regionen. Ukjent region gir 400.

### Grenser

- Minne: målt toppverdi med Oslo og Bergen aktive samtidig skal ligge godt under 512 MB (`npm run memcheck`, utvidet til å gjøre kall mot begge regioner). Over det: ikke deploy, se på tiltak eller betalt plan med brukeren.
- Entur: ET-kvoten er felles for klientnavnet. Bergen øker antall ET-kall. Brukeren ber Entur om høyere kvote før lansering.

## Klient

- Regionen kommer fra stien (`/` = Oslo, `/bergen` = Bergen). Den styrer kartsentrum, `?region=` på alle kall og hvilke linjer søket kjenner.
- Regionvelger i kartmenyen. Valget lagres i `localStorage` og skifter sti med `history.pushState` uten ny sideinnlasting; data for den nye regionen hentes på nytt.
- Automatisk: på `/` uten lagret valg brukes posisjonen bare hvis tillatelsen alt er gitt (Permissions API), eller når brukeren trykker «Vis min posisjon». Nærmeste region vinner hvis posisjonen ligger innenfor en regions `vehicleBounds`. Ingen spørsmål om posisjon ved innlasting. En lenke direkte til `/bergen` eller et valg i velgeren vinner over posisjonen.
- `shared/line-list.js` får region på hver linje; lenkene fra kartet til innholdssider bruker regionens sti.
- Dev-modus: reserveveien i nettleseren (`js/et-api.js`, `js/api.js`) bruker regionens datasett og grenser.

## Sider og innhold

| URL | Innhold |
|---|---|
| `/bergen` | Kartet, uten annonser (`isMapPath` utvides til alle regionstier) |
| `/bergen/linje/<slug>` | Linjesider |
| `/bergen/holdeplass/<slug>` | Holdeplassider |
| `/bergen/guider/<slug>` | Guider |
| `/guider`, `/holdeplasser` | Oversikten viser alle regioner, Oslo først |

`line-catalog.js` og `stop-catalog` får `region`; slug er unik innen regionen. `/linje/<slug>` uten region gjelder fortsatt Oslo (og de nasjonale togene, som blir der de er). Sitemap, canonical og brødsmuler tar med regionen.

Bergen-innhold (fakta sjekkes mot Entur før de skrives, ellers utelates de):

- Linjesider: Bybanen 1 og 2, de 15–20 busslinjene med flest avganger, de største båtrutene, Flybussen Bergen hvis den finnes i Entur.
- Holdeplassider: 8–12 knutepunkter (f.eks. Byparken, Bergen busstasjon, Flesland, Nesttun terminal, Åsane terminal, Strandkaien).
- Guider: Bybanen i Bergen, båt og ferje med Skyss, til og fra Flesland.
- Samme tekstregler som før: kort, uten standardinnledninger, fyllfraser, oppsummering eller oppdiktet forfatter. Byline «livetrafikk.no».

## Testing

- `npm test`: regionmodell, fordeling av GPS-kjøretøy per region, tilstandsoverganger (aktiv → hvilende → avlastet → aktiv) med falsk klokke, `?region=` på endepunktene og standard `oslo`, regionstier i `isMapPath`, sitemap og 404, slug-kollisjon Oslo/Bergen, valg av region fra posisjon.
- Uendret Oslo: eksisterende tester grønne uten endring i forventningene.
- Lokalt: `npm run build && npm run start`, Bergen-kart med kjøretøy, rutelinjer, tavle og linjesider; måle tid til Bybanen vises i avlastet region.
- Minnemåling som over før push.
- Etter deploy: `/health`, `/bergen`, én Bergen-linjeside, én guide, sitemap, og at `/` fortsatt viser Oslo.

## Rekkefølge

1. Region-kjøretid og `?region=` på serveren, Bergen uten innhold, bak et flagg som holder Bergen ute av velgeren.
2. Klient: regionsti, velger, posisjon.
3. Minnemåling. Stopper her hvis Render Starter ikke holder.
4. Innhold: linjesider, holdeplassider, guider.
5. Flagg av, deploy, sitemap.

## Etter levering (brukeren)

- Be Entur om høyere ET-kvote for `ruterlive-web`.
- Send inn oppdatert sitemap i Search Console.
