// GET /api/situations?region=<id>: avvik for regionen. Registreres i server.js før express.static.

import { sendJson, makeJsonEntry, memoEntry } from './json-cache.js';
import { parseRegionParam } from './region-services.js';
import { situationsForRegion, isRelevant } from './situations-model.js';

export function registerSituationRoutes(app, { service, visible, now = Date.now }) {
  // Én memo per region: bygger på nytt ved ny versjon, og ellers høyst én gang i minuttet (utløpte avvik)
  const memos = new Map();
  const memoFor = (region) => {
    let m = memos.get(region.id);
    if (!m) {
      let prev = null;
      m = memoEntry((index, _version, minute) => {
        const t = minute * 60_000;
        const situations = situationsForRegion(index, region).filter((s) => isRelevant(s, t));
        prev = makeJsonEntry({ available: true, situations }, prev);
        return prev;
      });
      memos.set(region.id, m);
    }
    return m;
  };

  app.get('/api/situations', (req, res) => {
    const region = parseRegionParam(req.query, visible);
    if (!region) {
      res.set('Cache-Control', 'no-store');
      return res.status(400).json({ error: 'ukjent region' });
    }
    const index = service.getIndex();
    if (!index) {
      // Ingen ferske data (Entur nede lenge): panelet viser feiltekst i stedet for «ingen avvik»
      res.set('Cache-Control', 'no-store');
      return res.json({ available: false, situations: [] });
    }
    const entry = memoFor(region)(index, service.getVersion(), Math.floor(now() / 60_000));
    return sendJson(req, res, entry, { cacheControl: 'public, max-age=60' });
  });
}
