# Deploy livetrafikk.no (RuterLive)

**Produksjon:** [livetrafikk.no](https://livetrafikk.no)

Appen trenger en server som proxier API-kall til Entur (unngår CORS, bedre for brukere med dårlig båndbredde).

## Hurtigstart: Render (gratis)

1. Lag konto på [render.com](https://render.com)
2. Klikk "New" → "Web Service"
3. Koble GitHub-repoet
4. Render oppdager `render.yaml` automatisk, eller sett:
   - **Build command:** `npm install && npm run build`
   - **Start command:** `npm run start`
   - **Root directory:** (tom)
5. Deploy

## Kartfliser (CARTO)

Bakgrunnskartet fra CARTO krever API-nøkkel ([carto.com/basemaps/apikey](https://carto.com/basemaps/apikey)). Nøkkelen bygges inn i klienten, så den må finnes **ved bygg**:

- **Render:** Environment → legg til `VITE_CARTO_API_KEY`, deretter ny deploy.
- **Lokalt:** `.env.local` med `VITE_CARTO_API_KEY=...` (ignoreres av git).

Uten nøkkel fungerer kartet, men CARTO viser vannmerke.

Nøkkelen er alltid synlig i flis-URL-ene i nettleseren (CARTO-vilkårene forbyr proxy/caching av fliser på server, så den kan ikke skjules). Beskyttelsen er å gjøre den **website-restricted** i [CARTO-dashbordet](https://dashboard.basemaps.carto.com/): tillatte verter `livetrafikk.no` og `*.livetrafikk.no` (wildcard dekker ikke rotdomenet). Bruk en egen nøkkel med `localhost` for lokal utvikling.

Med annonser regnes bruken som kommersiell: gratis inntil 1 million flisforespørsler per måned, deretter betalt plan. Følg forbruket i dashbordet.

## Railway

1. [railway.app](https://railway.app) → New Project → Deploy from GitHub
2. Velg repo, Railway oppdager Node
3. I Settings → Add variable: ingen nødvendig for grunnleggende
4. Build: `npm run build`, Start: `npm run start`

## Lokal produksjonstest

```bash
npm run build
npm run start
```

Åpne http://localhost:3000

## Cloudflare

For Cloudflare Workers trengs en annen tilnærming (Workers støtter ikke Express direkte uten adapter). Enklest er å bruke Cloudflare Pages for static + Cloudflare Workers for API-proxy, eller deploye Node-serveren til Railway/Render og bruke Cloudflare som CDN foran.

## Hvorfor server?

- **CORS:** Entur sine API-er tillater ikke alle domener – proxy løser dette
- **Rutelinjer:** Serveren cacher rutekartet (ET + Journey Planner) i 24t; sjekk hvert time. Brukeren får linjene øyeblikkelig
- **Holdeplasser:** GTFS lastes ved oppstart; stops-in-bbox og søk via server
- **Kjøretøy:** Brukerens nettleser poller via proxy hvert 20–30 sek; serveren cacher ikke kjøretøy
