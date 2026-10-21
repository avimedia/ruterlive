# Google AdSense

## Hvorfor sidene er bygd slik

AdSense avviste første søknad (oktober 2026) for «ads on screens without publisher-content» og «low value content». Kartet er en navigasjonsskjerm, og den eneste teksten lå skjult. Derfor:

- **Kartet (`/`) har ingen annonser.**
- **Annonser (Auto ads) vises bare på innholdssider:** guider (`/guider/<slug>`), linjesider (`/linje/<slug>`), `/guider` og `/om`. Scriptet legges inn av `server/pages/layout.js` (`ads: true` er standard; 404 bruker `ads: false`).
- **Ekte innhold:** seks guider og 28 linjesider med stoppliste og antall kjøretøy fra Entur. Tekstene ligger i `content/`.
- **Sitemap:** `/sitemap.xml`, oppført i `robots.txt`. Ukjente URL-er gir 404.
- **Personvernserklæring:** [/personvern.html](/personvern.html). Samtykke håndteres av Googles «Privacy & messaging» i AdSense.

## Oppsett

1. Slå på **Auto ads** for livetrafikk.no i AdSense. Ingen annonseenhet/slot trengs.
2. Send inn `https://livetrafikk.no/sitemap.xml` i Google Search Console.
3. Be om ny gjennomgang i AdSense.

## ads.txt

`public/ads.txt` serveres på [livetrafikk.no/ads.txt](https://livetrafikk.no/ads.txt) (egen rute i `server.js`).
