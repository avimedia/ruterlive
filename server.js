/**
 * Produksjonsserver med API-proxy til Entur.
 * Proxier alle API-kall server-side slik at:
 * - Ingen CORS-problemer
 * - Brukerens dårlige båndbredde påvirker mindre (server har ofte bedre linje)
 * - Enkelt å deploye til Railway, Render, Fly.io m.m.
 */

import express from 'express';
import proxy from 'express-http-proxy';
import path from 'path';
import { fileURLToPath } from 'url';
import { getCachedShapes, refreshRouteShapes } from './server/shape-service.js';
import { startEtCachePoll, ensureEtCache } from './server/et-cache.js';
import { getCachedVehicles } from './server/vehicles-cache.js';
import { loadGtfsStops } from './server/gtfs-stops-loader.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PORT = process.env.PORT || 3000;

const app = express();

// Health check for Render – slik at deploy/rullende oppdateringer fungerer
app.get('/health', (_req, res) => {
  res.status(200).send('ok');
});

// Cached rutekart – klart med en gang brukeren laster siden
app.get('/api/route-shapes', (_req, res) => {
  res.set('Cache-Control', 'public, max-age=30');
  res.json(getCachedShapes());
});

// Cached kjøretøy (GraphQL) – reduserer 502, 1 kall per 20s
app.get('/api/vehicles-cached', async (_req, res) => {
  try {
    const data = await getCachedVehicles();
    res.set('Cache-Control', 'public, max-age=10');
    res.json(data);
  } catch (err) {
    res.status(503).json({ errors: [{ message: err.message }] });
  }
});

// Cached ET – unngår 429 rate limit (1 kall per 60s, ikke per bruker)
app.get('/api/et-cached', async (_req, res) => {
  try {
    const xml = await ensureEtCache();
    res.set('Content-Type', 'application/xml');
    res.set('Cache-Control', 'public, max-age=15');
    res.send(xml);
  } catch (err) {
    res.status(503).send('ET midlertidig utilgjengelig: ' + err.message);
  }
});

app.use(
  '/api/entur',
  proxy('https://api.entur.io', {
    proxyReqPathResolver: (req) => '/realtime/v2/vehicles' + (req.url && req.url.startsWith('/') ? req.url : '/' + (req.url || '')),
    proxyReqOptDecorator: (opt) => {
      opt.headers['ET-Client-Name'] = 'ruterlive-web';
      return opt;
    },
  })
);

app.use(
  '/api/entur-et',
  proxy('https://api.entur.io', {
    proxyReqPathResolver: (req) => '/realtime/v1/rest' + (req.url && req.url.startsWith('/') ? req.url : '/' + (req.url || '')),
    proxyReqOptDecorator: (opt) => {
      opt.headers['ET-Client-Name'] = 'ruterlive-web';
      return opt;
    },
    timeout: 60000, // ET returnerer stor XML; gi tid for full overføring
  })
);

app.use(
  '/api/entur-geocoder',
  proxy('https://api.entur.io', {
    proxyReqPathResolver: (req) => '/geocoder/v1' + (req.url && req.url.startsWith('/') ? req.url : '/' + (req.url || '')),
    proxyReqOptDecorator: (opt) => {
      opt.headers['ET-Client-Name'] = 'ruterlive-web';
      return opt;
    },
  })
);

// OSRM fjernet – offentlig server gir 500/429; rutekart bruker rette linjer mellom stopp
app.use('/api/osrm', (_req, res) => {
  res.status(410).json({ error: 'OSRM disabled' });
});

app.use(
  '/api/entur-jp',
  proxy('https://api.entur.io', {
    proxyReqPathResolver: (req) => '/journey-planner/v3' + (req.url && req.url.startsWith('/') ? req.url : '/' + (req.url || '')),
    proxyReqOptDecorator: (opt) => {
      opt.headers['ET-Client-Name'] = 'ruterlive-web';
      return opt;
    },
  })
);

app.use(express.static(path.join(__dirname, 'dist')));
app.get('*', (req, res) => {
  res.sendFile(path.join(__dirname, 'dist', 'index.html'));
});

app.listen(PORT, async () => {
  console.log(`RuterLive kjører på http://localhost:${PORT}`);
  getCachedVehicles().catch((e) => console.warn('[RuterLive] Vehicles cache prewarm:', e.message));
  loadGtfsStops().catch((e) => console.warn('[RuterLive] GTFS preload:', e.message));
  setTimeout(() => {
    startEtCachePoll();
    setTimeout(() => {
      refreshRouteShapes().then((shapes) => {
        console.log(`[RuterLive] Rutekart cache: ${shapes.length} linjer`);
      });
      setInterval(refreshRouteShapes, 15 * 60 * 1000);
    }, 5000);
  }, 3000);
});
