// Live-endepunktene per region (?region=, standard Oslo). Registreres i server.js før express.static og catch-all.

import { sendJson, awaitUpgrade } from './json-cache.js';

/**
 * Tjenestene for regionen i ?region=, eller null etter å ha svart 400.
 * @param {{ parseRegionParam: Function, get: Function }} registry
 */
export function regionServicesFor(registry, req, res) {
  const region = registry.parseRegionParam(req.query);
  const services = region && registry.get(region.id);
  if (!services) {
    res.set('Cache-Control', 'no-store');
    res.status(400).json({ error: 'ukjent region' });
    return null;
  }
  return services;
}

export function registerLiveRoutes(app, { registry }) {
  const { runtime } = registry;

  // Cached rutekart (gammel klient og reservevei) – statiske kart pluss rutekarttjenesten
  app.get('/api/route-shapes', (req, res) => {
    const s = regionServicesFor(registry, req, res);
    if (!s) return;
    sendJson(req, res, s.live.getStaticEntry(), { cacheControl: 'public, max-age=30' });
  });

  // Bare kjøretøy – klienten poller denne hvert 30. s. Rutekart hentes separat og bare ved ny versjon.
  // Format: { t0, shapesVersion, vehicles } der ET-path har tider i sekunder relativt til t0.
  app.get('/api/vehicles-live', async (req, res) => {
    const s = regionServicesFor(registry, req, res);
    if (!s) return;
    runtime.touch(s.region.id);
    try {
      const { vehiclesEntry: e } = await s.live.getLiveEntries();
      await awaitUpgrade(e);
      // s-maxage: Cloudflare holder svaret i 10 s, så Render svarer omtrent én gang per 10 s per Cloudflare-sted
      sendJson(req, res, e, { cacheControl: 'public, max-age=15, s-maxage=10' });
    } catch (err) {
      res.set('Cache-Control', 'no-store');
      res.status(503).json({ vehicles: [], shapesVersion: null });
    }
  });

  // Alle rutekart. Versjonert via ?v=, så nettleseren kan cache dem lenge.
  app.get('/api/route-shapes-all', async (req, res) => {
    const s = regionServicesFor(registry, req, res);
    if (!s) return;
    runtime.touch(s.region.id);
    try {
      const { shapesEntry: e, shapesVersion: ver } = await s.live.getLiveEntries();
      await awaitUpgrade(e);
      const cacheControl = req.query.v && req.query.v === ver
        ? 'public, max-age=86400, immutable'
        : 'public, max-age=30';
      sendJson(req, res, e, { cacheControl });
    } catch (err) {
      res.set('Cache-Control', 'no-store');
      res.status(503).json([]);
    }
  });

  // Alt på en gang – beholdt uendret i format for gamle klienter (bufret JS i nettleseren).
  app.get('/api/initial-data', async (req, res) => {
    const s = regionServicesFor(registry, req, res);
    if (!s) return;
    runtime.touch(s.region.id);
    try {
      sendJson(req, res, await s.live.getLegacyEntry(), { cacheControl: 'public, max-age=15' });
    } catch (err) {
      res.status(503).json({ vehicles: [], routeShapes: [] });
    }
  });
}
