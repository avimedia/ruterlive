# livetrafikk.no (RuterLive)

Realtidskart for kollektivtrafikk i Stor-Oslo. **Live:** [livetrafikk.no](https://livetrafikk.no)

Viser buss, T-bane, trikk, båt, regiontog og Flytoget basert på Entur API. Ruter leverer ikke GPS til Entur; buss/T-bane/trikk bruker beregnet posisjon fra avgangsdata.

## Funksjoner

- **Kjøretøy på kart** – posisjoner oppdateres løpende
- **Rutelinjer** – T-bane, trikk og jernbane vises alltid; buss og båt ved valgt kjøretøy
- **Holdeplasser** – vises ved zoom 15+, klikk for avgangstavle
- **Søk** – finn holdeplass etter navn

## Transporttyper

Modus hentes fra **Entur Journey Planner** (transportMode per linje).

| Type      | Beskrivelse                                   |
|-----------|-----------------------------------------------|
| T-bane   | Linje 1–6                                     |
| Trikk    | Linje 11–19                                   |
| Buss     | Bussruter (inkl. 20–89, 100+, 300, 390 …)    |
| Flybuss  | Ekspress til/fra lufthavn                      |
| Båt      | Ferger og øybåter                             |
| Regiontog| R10, R11, R12, R13 … (Vestfold, Østfold, Drammen) |
| Flytoget | F1, F2, FX – Gardermoen-ekspressen            |

Inspirert av [SL Live Map](https://sl-map.gunnar.se/).

## Kom i gang

**Utvikling** (med Vite-proxy):
```bash
npm install
npm run dev
```
Åpne http://localhost:5173

**Produksjon** (med Express-server, anbefalt):
```bash
npm run build
npm run start
```
Åpne http://localhost:3000

## Deploy

Se [DEPLOY.md](DEPLOY.md) for oppsett på Render, Railway m.m. Produksjonsvisning krever en server som proxier API-kall til Entur (CORS, båndbredde).

## Arkitektur / dataflyt

| Data            | Hvor lastes det? | Oppdatering                                      |
|-----------------|------------------|--------------------------------------------------|
| **Rutelinjer**  | Server           | Ved oppstart; cache 24t, sjekk hvert time (ET + Journey Planner) |
| **Holdeplasser**| Server           | GTFS stops + bbox-forespørsler (zoom 15+)        |
| **Kjøretøy**    | Klient           | Nettleseren poller via proxy hvert 20–30 sek     |

**Rutelinjer** (T-bane, trikk, jernbane, buss, båt) caches på serveren i 24 timer. Kartet vises umiddelbart når brukeren åpner siden. **Kjøretøyposisjoner** hentes av hver brukers nettleser gjennom API-proxy – serveren cacher ikke kjøretøy.

## Teknologi

- **Leaflet** – interaktivt kart
- **Entur API** – GraphQL (kjøretøy), SIRI ET (avgangsdata), Geocoder, Journey Planner
- **Vite** – bygg og utviklingsserver
- **Express** – produksjonsserver med API-proxy
