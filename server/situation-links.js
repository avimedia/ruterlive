/**
 * Oppslag fra avvikets linje (lineRef + publicCode) og holdeplass (stoppested- eller quay-ID) til
 * egne sider. Bare indekserte linjer og stopp med egen side i synlige regioner gir lenke.
 */

import { REGION_LINES } from './line-catalog.js';
import { featuredStopsFor, normalizeStopName, distanceM } from './stop-catalog.js';
import { lineRefKeys } from './situations-model.js';
import { regionPath } from '../shared/regions.js';

const NEAR_M = 800;
const upper = (code) => String(code ?? '').toUpperCase();

/**
 * `linesFor(regionId)` og `stopsFor(regionId)` gir katalogene; `coordsFor(id)` gir { lat, lon } for en
 * quay (GTFS), så en quay kan knyttes til stoppet med samme navn i nærheten. Uten koordinater godtas
 * samme navn bare i regionen som har avvikets kodeområde.
 */
export function createSituationLinks({
  regions,
  linesFor = (id) => REGION_LINES[id] ?? [],
  stopsFor = featuredStopsFor,
  coordsFor = () => null,
}) {
  // lineRef → sti, og kodeområde|kode → sti (lineRef-en kan ha en annen intern ID enn koden)
  const byRef = new Map();
  const byCode = new Map();
  const stopById = new Map();
  const stopByName = new Map();
  for (const region of regions) {
    for (const line of linesFor(region.id)) {
      if (line.indexed === false) continue;
      const path = regionPath(region, `/linje/${line.slug}`);
      const { refs, codes } = lineRefKeys(line);
      for (const ref of refs) if (!byRef.has(ref)) byRef.set(ref, path);
      for (const key of codes) if (!byCode.has(key)) byCode.set(key, path);
    }
    for (const stop of stopsFor(region.id)) {
      const path = regionPath(region, `/holdeplass/${stop.slug}`);
      stopById.set(stop.id, path);
      const key = normalizeStopName(stop.name);
      if (!stopByName.has(key)) stopByName.set(key, []);
      stopByName.get(key).push({ stop, path, codespaces: region.situationCodespaces || [] });
    }
  }

  return {
    lineLink(lineRef, code) {
      const direct = byRef.get(lineRef);
      if (direct) return direct;
      const codespace = String(lineRef ?? '').split(':')[0];
      return byCode.get(`${codespace}|${upper(code)}`) ?? null;
    },
    stopLink(id, name, codespace) {
      const direct = stopById.get(id);
      if (direct) return direct;
      if (!name) return null;
      const candidates = stopByName.get(normalizeStopName(name));
      if (!candidates) return null;
      const at = coordsFor(id);
      if (at && Number.isFinite(at.lat) && Number.isFinite(at.lon)) {
        return candidates.find((c) => distanceM(at, c.stop) < NEAR_M)?.path ?? null;
      }
      // Uten koordinater (stoppested-ID-er finnes ikke i GTFS-kartet): samme navn i regionen selskapet melder for
      return candidates.find((c) => c.codespaces.includes(codespace))?.path ?? null;
    },
  };
}
