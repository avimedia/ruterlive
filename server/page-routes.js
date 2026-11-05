// Innholdssider og kartsider per synlig region: /linje, /holdeplass og /guider (Oslo på roten,
// andre regioner under /<id>), samt kartet på /<id>. Registreres før express.static og catch-all.
// Avhengighetene kan byttes ut i tester.

import { readFile } from 'node:fs/promises';
import { regionPath } from '../shared/regions.js';
import { getLineBySlug, getLineStops, getLineText } from './line-catalog.js';
import { getMergedVehicles, countVehiclesForLine } from './live-vehicles.js';
import { getGuideBySlug, loadGuideBody, GUIDES } from './guide-catalog.js';
import { getStopBySlug, getStopText } from './stop-catalog.js';
import { renderLinePage } from './pages/line-page.js';
import { renderStopPage } from './pages/stop-page.js';
import { renderGuidePage } from './pages/guide-page.js';
import { regionMapHtml } from './pages/region-map.js';

const VEHICLE_WAIT_MS = 1500;

/**
 * @param {import('express').Express} app
 * @param {object} deps
 * @param {object[]} deps.visible synlige regioner (offentlige + REGIONS_PREVIEW)
 * @param {string} deps.indexPath dist/index.html (kartet)
 * @param {(res) => void} deps.sendNotFound
 * @param {{ getInfo, getDepartures }} deps.stopService
 */
export function registerPageRoutes(app, {
  visible,
  indexPath,
  sendNotFound,
  stopService,
  getLineStops: lineStops = getLineStops,
  getMergedVehicles: mergedVehicles = getMergedVehicles,
  getGuide = getGuideBySlug,
  loadGuideBody: guideBody = loadGuideBody,
  guides = GUIDES,
  getStop = getStopBySlug,
  getStopText: stopText = getStopText,
}) {
  const unavailable = (res, what, err) => {
    console.warn(`[RuterLive] ${what}:`, err.message);
    res.set('Cache-Control', 'no-store');
    res.status(503).type('text').send('Siden er midlertidig utilgjengelig');
  };

  for (const region of visible) {
    const prefix = region.path;

    // Kartet for andre regioner enn Oslo (Oslo serveres av catch-all). Bygges én gang per region.
    if (prefix) {
      let html;
      app.get(prefix, async (_req, res) => {
        try {
          html ??= regionMapHtml(await readFile(indexPath, 'utf8'), region);
          res.set('Cache-Control', 'no-cache');
          res.type('html').send(html);
        } catch (err) {
          html = undefined;
          unavailable(res, `Kart ${region.id}`, err);
        }
      });
    }

    // Linjeside med stoppliste (Entur JP) og antall kjøretøy akkurat nå
    app.get(`${prefix}/linje/:slug`, async (req, res) => {
      const line = getLineBySlug(req.params.slug, region.id);
      if (!line) return sendNotFound(res);
      try {
        const [stops, vehicles, text] = await Promise.all([
          lineStops(line),
          // Kald start: ikke vent på kjøretøy (GTFS/ET) lenger enn 1,5 s; da rendres siden uten telling.
          Promise.race([
            Promise.resolve(mergedVehicles(region.id)).catch(() => null),
            new Promise((resolve) => setTimeout(() => resolve(null), VEHICLE_WAIT_MS).unref?.()),
          ]),
          getLineText(line.slug, region.id),
        ]);
        res.set('Cache-Control', stops && vehicles ? 'public, max-age=300' : 'no-store');
        res.type('html').send(renderLinePage(line, stops, vehicles ? countVehiclesForLine(vehicles, line) : null, text));
      } catch (err) {
        unavailable(res, 'Linjeside', err);
      }
    });

    // Holdeplassider: statisk info (24 t) og avganger (60 s) fra Entur JP, delt cache for alle brukere.
    app.get(`${prefix}/holdeplass/:slug`, async (req, res) => {
      const stop = getStop(req.params.slug, region.id);
      if (!stop) return sendNotFound(res);
      try {
        const [info, departures, text] = await Promise.all([stopService.getInfo(stop), stopService.getDepartures(stop), stopText(stop.slug, region.id)]);
        res.set('Cache-Control', departures ? 'public, max-age=30' : 'no-store');
        res.type('html').send(renderStopPage(stop, info, departures, { text }));
      } catch (err) {
        unavailable(res, 'Holdeplasside', err);
      }
    });

    app.get(`${prefix}/guider/:slug`, async (req, res) => {
      const guide = getGuide(req.params.slug, region.id);
      if (!guide) return sendNotFound(res);
      try {
        const body = await guideBody(guide.slug, region.id);
        res.set('Cache-Control', 'public, max-age=3600');
        res.type('html').send(renderGuidePage(guide, body, guides));
      } catch (err) {
        unavailable(res, 'Guide', err);
      }
    });
  }
}
