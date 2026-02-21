# RuterLive

Realtidskart for kollektivtrafikk. Viser buss, T-bane, trikk, båt og tog basert på Entur API. Ruter leverer ikke GPS til Entur; buss/T-bane/trikk bruker beregnet posisjon fra avgangsdata.

## Transporttyper

Modus hentes fra **Entur Journey Planner** (transportMode per linje). Linjenummer er upålitelig – f.eks. er 390 og 396 bussruter (Nittedal/Hellerudhaugen), ikke ferger.

| Type   | Beskrivelse                                   |
|--------|-----------------------------------------------|
| T-bane | Linje 1–6                                     |
| Trikk  | Linje 11–19                                   |
| Buss   | Bussruter (inkl. 20–89, 100+, 300, 390 …)    |
| Båt    | Ferger og øybåter (fra JP transportMode)       |

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

## Teknologi

- **Leaflet** – interaktivt kart
- **Entur API** – GraphQL (kjøretøy), SIRI ET (avgangsdata), Geocoder, Journey Planner
- **Vite** – bygg og utviklingsserver
- **Express** – produksjonsserver med API-proxy
