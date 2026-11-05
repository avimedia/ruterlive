/**
 * Hvilket kjøretøy kjører en gitt tur (serviceJourney.id fra avgangstavla)?
 * Slås opp i data serveren alt har: GPS-kjøretøy (journeyIds) og ET-turer (DatedVehicleJourneyRef
 * er samme id som i Journey Planner). Ingen kall mot Entur.
 */

import { regionServicesFor } from './live-routes.js';
import { shortVehicleId } from './vehicle-id.js';

export const SERVICE_JOURNEY_RE = /^[A-Z]{2,5}:ServiceJourney:[A-Za-z0-9_\-.:]{1,100}$/;

/**
 * @param {string} sj serviceJourney.id
 * @param {{ gps: object[][], etJourneys: object[] }} sources GPS-lister og ET-turer
 * @returns {string|null} vehicleId slik den brukes i /api/vehicles-live
 */
export function findJourneyVehicle(sj, { gps = [], etJourneys = [] } = {}) {
  for (const list of gps) {
    for (const v of list || []) {
      if (v.journeyIds?.includes(sj)) return v.vehicleId;
    }
  }
  // ET har flere turer per fysisk kjøretøy med samme VehicleRef, så en senere tur gir bussen
  // som kjører nå (vehicleId er VehicleRef når den finnes)
  for (const j of etJourneys || []) {
    if (j.datedVehicleJourneyRef === sj) return j.vehicleId;
  }
  return null;
}

/**
 * GET /api/journey-vehicle?sj=<serviceJourney.id>[&region=<id>]: kjøretøyet som kjører en avgang fra tavla,
 * slått opp i regionens GPS (cache) og ET-turer pluss tog i hele landet. Ingen nye kall mot Entur utover
 * det /api/vehicles-live gjør: trykket regnes som et besøk i regionen.
 * @param {import('express').Express} app
 * @param {{ registry: object, getGps: (regionId: string) => Promise<object>, getRail: () => Promise<object>, middleware?: Function[] }} deps
 */
export function registerJourneyVehicleRoute(app, { registry, getGps, getRail, middleware = [] }) {
  app.get('/api/journey-vehicle', ...middleware, async (req, res) => {
    const sj = String(req.query.sj || '');
    if (!SERVICE_JOURNEY_RE.test(sj)) return res.status(400).json({ error: 'ugyldig sj' });
    const s = regionServicesFor(registry, req, res);
    if (!s) return;
    registry.runtime?.touch?.(s.region.id);
    try {
      const [gps, rail, etJourneys] = await Promise.all([
        Promise.resolve().then(() => getGps(s.region.id)).catch(() => null),
        Promise.resolve().then(() => getRail()).catch(() => null),
        s.etCache.getJourneys().catch(() => []),
      ]);
      const vehicleId = findJourneyVehicle(sj, { gps: [gps?.data?.vehicles, rail?.data?.vehicles], etJourneys });
      res.set('Cache-Control', 'public, max-age=15');
      if (!vehicleId) return res.status(404).json({ vehicleId: null });
      res.json({ vehicleId: shortVehicleId(vehicleId) }); // samme korte id som i /api/vehicles-live
    } catch {
      res.status(503).json({ vehicleId: null });
    }
  });
}
