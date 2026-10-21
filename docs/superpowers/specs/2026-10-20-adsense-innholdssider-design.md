# Innholdssider for AdSense-godkjenning

Dato: 2026-10-20

## Bakgrunn

AdSense avviste livetrafikk.no: «ads on screens without publisher-content» og «low value content». Årsaker i koden:

- Annonsen ligger på kartet, som er en navigasjonsskjerm.
- Om-teksten er skjult (`hidden`) som standard.
- `data-ad-slot="XXXXXXXXXX"` står igjen i `index.html`.
- Catch-all i `server.js` gir 200 og kartsiden for alle URL-er.
- Nettstedet har bare to sider og ingen sitemap.

## Mål

Gjøre nettstedet kvalifisert: ekte innholdssider med annonser, kartet uten annonser. Godkjenning kan ikke garanteres; trafikk og alder teller også.

## Sider

| URL | Innhold | Kilde |
|---|---|---|
| `/` | Kartet, uten annonser | Uendret app |
| `/guider` | Oversikt over guider og linjer | Server |
| `/guider/<slug>` | ~6 guider, 600–1200 ord | Statisk HTML, Vite |
| `/linje/<slug>` | ~25 linjesider | Server, live data |
| `/om` | Om-teksten, synlig | Statisk HTML, Vite |
| `/sitemap.xml` | Alle sider over | Server |
| alt annet | 404-side | Server |

Guider: sanntidsposisjoner (GPS vs. beregnet), T-banenettet, trikken i Oslo, Flytoget vs. flybuss, regiontogene rundt Oslo, slik bruker du livetrafikk.no.

Linjesider: T-bane 1–5, trikk 11–19, regiontog (R-linjer), Flytoget, flybuss FB1/FB3/FB5. Ingen busslinjer (for mange, tynt innhold). Hver side: kort håndskrevet intro, stoppliste i rekkefølge, antall kjøretøy ute nå, knapp som åpner kartet på linjen. Mangler live data (kald start): intro + «Stoppliste lastes, prøv igjen om litt».

Den endelige linjelisten bestemmes av hva Entur faktisk har; linjer som ikke finnes, utelates.

## Tekst

- Norsk, kort, konkret. Ingen standardinnledninger, fyllfraser, oppsummering til slutt eller punktlister overalt.
- Byline «livetrafikk.no» med dato. Ingen oppdiktet forfatter eller opplevelser.
- Fakta (linjenumre, endestasjoner, antall stopp) sjekkes mot Entur før de skrives. Det som ikke kan verifiseres, utelates.

## Annonser

Auto ads: AdSense-scriptet lastes kun på innholdssider (guider, linjesider, `/guider`, `/om`). Fjernes fra `index.html`. Ingen fast annonseplass.

## Kode

- `server/line-catalog.js`: fast linjeliste (slug, modus, linjekode, intro). Kobler til live data fra `getAllShapes()` og ET-kjøretøy. Stoppnavn for tog hentes fra Entur JP, cache 24t.
- `server/pages/layout.js`: felles HTML-mal (header, footer med lenker, AdSense-script, canonical, HTML-escaping).
- `server/pages/line-page.js`, `server/pages/guide-index.js`, `server/pages/sitemap.js`, `server/pages/not-found.js`.
- Guider og `/om` som ekstra Vite-inngangspunkter i `vite.config.js`; felles CSS for innholdssider.
- `server.js`: nye ruter før `express.static`/catch-all. Catch-all serverer kartet kun for `/` og kartets egne URL-er; resten 404. `robots.txt` får `Sitemap:`-linje.
- `index.html`: fjern AdSense og skjult om-seksjon; lenke til guider i headeren.
- Ingen nye avhengigheter.

## Testing

- `npm test` med `node:test`: linjekobling (riktig rute, stopprekkefølge, retninger ikke blandet), HTML-escaping, sitemap, 404 vs. kart-URL-er.
- Lokal kjøring (`npm run build && npm run start`): alle sider gir 200 med innhold, ukjent URL gir 404, AdSense kun på innholdssider, linjeside fungerer før cache er klar, visning på mobil og desktop.
- Etter push til `main`: sjekk `/health`, `/sitemap.xml`, én linjeside, én guide og 404 på livetrafikk.no.

## Etter levering (brukeren)

- Slå på Auto ads i AdSense.
- Send inn `sitemap.xml` i Google Search Console.
- Be om ny AdSense-gjennomgang.
- Vurder betalt Render-instans for å unngå dvale.

## Dokumentasjon

Oppdater `CLAUDE.md` og `README.md` med sidestrukturen; rett påstanden om at serveren ikke cacher kjøretøy.
