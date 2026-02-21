# Google AdSense-oppsett

Reklame vises nederst på siden. For å aktivere Google Ads:

## Steg 1: Opprett konto

1. Gå til [google.com/adsense](https://www.google.com/adsense)
2. Opprett konto og søk om godkjenning
3. Godkjenning kan ta noen dager–uker

## Steg 2: Opprett annonseenhet

1. I AdSense-dashboard: **Annonser** → **Etter annonseenhet** → **Display-annonser**
2. Velg **Responsiv** som format
3. Gi den et navn (f.eks. «RuterLive bunn»)
4. Kopier den genererte koden

## Steg 3: Bytt ut placeholder i koden

Åpne `index.html` og finn `id="ad-footer"`. Erstatt:

- `ca-pub-XXXXXXXXXX` → din **utgiver-ID** (starter med `ca-pub-`)
- `data-ad-slot="XXXXXXXXXX"` → ditt **annonsespor-ID** fra AdSense

Det må være likt i både `script src=...?client=` og `data-ad-client=`.

## ads.txt

Filen `public/ads.txt` er konfigurert med utgiver-ID og kopieres til rot av nettstedet ved build. Sørg for at den er tilgjengelig på [livetrafikk.no/ads.txt](https://livetrafikk.no/ads.txt).

## Testing

Før godkjenning viser AdSense ofte tomme felt eller testannonser. Ekte annonser vises når kontoen er godkjent og nettstedet er verifisert.
