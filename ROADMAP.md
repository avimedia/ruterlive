# livetrafikk.no (RuterLive) – roadmap

**Sist oppdatert:** 2026-10-31

---

## Implementert

- **Holdeplasser på kart** – vises ved zoom 15+, søk etter navn
- **Avgangstavle** – ved klikk på holdeplass: sanntidsavganger med forsinkelse/sanntid-badges
- **Jernbanelinjer** – regiontog og Flytoget hentes fra Journey Planner, cache 24t
- **Kartverket-bakgrunnskart** – `topograatone` (CC BY 4.0, ingen nøkkel), mørkt tema via CSS-filter på flislaget
- **Rutelogikk** – T-bane, trikk, jernbane alltid synlige; buss og båt kun ved valgt kjøretøy
- **Fase 0 og 1 av utvidelsen** – strømmende ET-parser, GTFS via Range-lesing, regioninnstillinger i `shared/regions.js` (Oslo eneste region), linjenummer-regelen bare for Ruter
- **Tog i hele Norge** (branch `utvidelse`, deployes etter AdSense-godkjenning) – GPS-tog uten bbox, BNR-ET for tog uten GPS, togruter for 36 linjer fra JP, 16 nye linjesider (Bergensbanen, Dovrebanen, Nordlandsbanen, Sørlandsbanen, lokaltog i Bergen, Stavanger og Trondheim)

---

## Planlagt / neste steg

### Utvidelse utover Stor-Oslo

Kartlegging med tall og kilder: [docs/utvidelse-utover-oslo.md](docs/utvidelse-utover-oslo.md). Valgt retning: region som konfigurasjon, én sti per region på samme domene (`/` Oslo, `/bergen`, `/trondheim`, `/stavanger`), cache per region som lastes ved behov. Gir også flere linjesider og guider per region.

Utenfor Oslo leverer nesten alle operatører GPS til Entur, så interpolering fra ET trengs i hovedsak bare for Ruter.

| Fase | Innhold | Anslag |
|---|---|---|
| 0 Grunnmur ✅ | Kartverket-fliser (over); strømmende ET-parser i stedet for xmldom-DOM (RUT bruker ~145 MB heap per parsing); les bare `stops.txt` fra GTFS-zip; ikke kopier quay-Map ved hvert kall; filtrer GPS-kjøretøy med gammel `lastUpdated` | 3–5 dager |
| 1 Region-config, kun Oslo ✅ | bbox, datasett, hubber, senter, tekster i config; modus-/linjelogikk samlet i `shared/`; linjenummer fra JP `publicCode` i stedet for regex på LineRef; tester som viser uendret Oslo | 3–4 dager |
| 2 Bergen | GPS først, ET bare for fra/til/rutekart og Bybanen; dedup på `serviceJourney.id`; `/bergen`-kart, 10–20 linjesider, 2–3 guider, regionvelger; be Entur om høyere ET-kvote | 4–6 dager + innhold |
| 3 Trondheim, Stavanger | Gjenbruk; AtB-linjeformat `2_11`, Kolumbus-ET uten VehicleRef | 2–3 dager hver + innhold |
| 4 Hele Norge | Tog er gjort (se over). Resten: Vehicles nasjonalt filtrert på viewport, ET/rutekart ved behov, ET-delta med `requestorId`, trolig betalt Render | 1–2 uker |

Største risikoer: minne (ET-parsing, 384 MB heap), Entur sin ET-kvote (felles for klientnavnet, ikke per datasett), og feil data utenfor Oslo (linjenummer-regex og 1–6 = T-bane-regelen slår feil; doble kjøretøy der ET mangler VehicleRef; parkerte busser).

### Andre mulige utvidelser

Flere transporttyper, favoritter, varsler.
