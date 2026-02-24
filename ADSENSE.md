# Google AdSense

## Tilført innhold for godkjenning

For å møte AdSense-krav om «publisher content» er følgende lagt til:

- **Tagline** under overskriften som beskriver tjenesten
- **«Om tjenesten»-seksjon** med utvidbar innhold:
  - Om livetrafikk.no
  - Hvordan bruke kartet
  - Kollektivtransport i Oslo (Ruter, T-bane, trikk, buss)
  - Flybuss og Flytoget
  - Datakilder (Entur)

Innholdet er synlig i headeren og kan utvides via «Om tjenesten»-knappen.

## AdSense-oppsett

Reklame vises nederst på siden. For å aktivere:

1. Gå til [google.com/adsense](https://www.google.com/adsense)
2. Opprett annonseenhet og kopier koden
3. Erstatt i `index.html`:
   - `ca-pub-XXXXXXXXXX` → din utgiver-ID
   - `data-ad-slot="XXXXXXXXXX"` → ditt annonsespor-ID

## ads.txt

`public/ads.txt` må være tilgjengelig på [livetrafikk.no/ads.txt](https://livetrafikk.no/ads.txt).
