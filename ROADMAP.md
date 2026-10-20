# livetrafikk.no (RuterLive) – roadmap

**Sist oppdatert:** 2026-10-20

---

## Implementert

- **Holdeplasser på kart** – vises ved zoom 15+, søk etter navn
- **Avgangstavle** – ved klikk på holdeplass: sanntidsavganger med forsinkelse/sanntid-badges
- **Jernbanelinjer** – regiontog og Flytoget hentes fra Journey Planner, cache 24t
- **Rutelogikk** – T-bane, trikk, jernbane alltid synlige; buss og båt kun ved valgt kjøretøy

---

## Planlagt / neste steg

### Bytte bakgrunnskart fra CARTO til Kartverket

CARTO krever API-nøkkel, og med annonser regnes bruken som kommersiell (gratis til 1 mill. fliser/mnd, deretter USD 500/mnd). Kartverkets åpne kartfliser er gratis, uten nøkkel, og kan brukes kommersielt (CC BY 4.0).

- Flis-URL: `https://cache.kartverket.no/v1/wmts/1.0.0/<lag>/default/webmercator/{z}/{y}/{x}.png` (merk rekkefølgen `{y}/{x}`)
- Lag: `topo` (lys), `topograatone` (gråtone). Kartverket har ikke mørkt kart – mørkt tema må løses med CSS-filter på flislaget (f.eks. invertering) eller beholde CARTO for mørkt.
- Attribusjon: «© Kartverket».
- Sjekk: zoomnivåer (maks zoom), dekning utenfor Norge (kartet viser bare Stor-Oslo), lesbarhet av rutelinjer og kjøretøy over topo-kartet, Kartverkets bruksvilkår for trafikkmengde.
- Når byttet er gjort: fjern `VITE_CARTO_API_KEY` fra Render og koden, oppdater DEPLOY.md og personvernerklæringen (tredjepart som mottar IP).

### Andre mulige utvidelser

Flere transporttyper, favoritter, varsler.
