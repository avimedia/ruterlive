# Deploy RuterLive

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
- **Rutelinjer:** Serveren cacher rutekartet (ET + Journey Planner) ved oppstart og 24t – brukeren får linjene øyeblikkelig
- **Kjøretøy:** Brukerens nettleser poller Entur via proxy hvert 10. sekund; serveren cacher ikke kjøretøy
