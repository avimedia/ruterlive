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
import { loadGtfsStops, ensureGtfsStopsLoaded, getGtfsQuayCache } from './server/gtfs-stops-loader.js';
import { getEtVehiclesAndShapes } from './server/et-vehicles-service.js';

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

function shapeKey(s) {
  return `${(s.mode || '').toLowerCase()}|${(s.line || '').toString()}|${s.from || ''}|${s.to || ''}`;
}

function mergeShapes(a, b) {
  const byKey = new Map();
  for (const s of a || []) byKey.set(shapeKey(s), s);
  for (const s of b || []) {
    const k = shapeKey(s);
    const ex = byKey.get(k);
    const ptsNew = s.points?.length ?? 0;
    const ptsOld = ex?.points?.length ?? 0;
    if (!ex || ptsNew >= ptsOld) byKey.set(k, s);
  }
  return [...byKey.values()];
}

// Alt på en gang – kjøretøy + rutekart. Server beregner alt; klient får ferdig data.
app.get('/api/initial-data', async (_req, res) => {
  try {
    const [vehiclesData, etResult, shapes] = await Promise.all([
      getCachedVehicles(),
      getEtVehiclesAndShapes(),
      Promise.resolve(getCachedShapes()),
    ]);
    const graphqlVehicles = Array.isArray(vehiclesData?.data?.vehicles)
      ? vehiclesData.data.vehicles
      : [];
    const etVehicles = etResult?.vehicles ?? [];
    const etShapes = etResult?.shapes ?? [];

    const etByid = new Map(etVehicles.map((v) => [v.vehicleId, v]));
    const merged = [];
    for (const v of graphqlVehicles) {
      const et = etByid.get(v.vehicleId);
      merged.push(
        et
          ? { ...v, from: v.from ?? et.from, to: v.to ?? et.to, via: v.via ?? et.via }
          : v
      );
    }
    const seen = new Set(graphqlVehicles.map((v) => v.vehicleId));
    for (const v of etVehicles) {
      if (!seen.has(v.vehicleId)) merged.push(v);
    }

    const routeShapes = mergeShapes(shapes, etShapes);

    res.set('Cache-Control', 'public, max-age=15');
    res.json({ vehicles: merged, routeShapes });
  } catch (err) {
    res.status(503).json({ vehicles: [], routeShapes: [] });
  }
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

// Quay-koordinater fra GTFS – brukes av klient for buss-posisjoner
app.post('/api/quay-coords', express.json({ limit: '100kb' }), async (req, res) => {
  try {
    await ensureGtfsStopsLoaded();
    const gtfs = getGtfsQuayCache();
    const ids = Array.isArray(req.body?.ids) ? req.body.ids : [];
    const out = {};
    for (const id of ids.slice(0, 1000)) {
      if (typeof id === 'string' && /^NSR:Quay:\d+$/.test(id) && gtfs?.has(id)) {
        out[id] = gtfs.get(id);
      }
    }
    res.set('Cache-Control', 'public, max-age=3600');
    res.json(out);
  } catch (err) {
    res.status(503).json({});
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
