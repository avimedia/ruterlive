/**
 * Henter jernbaneskinner fra OpenStreetMap (Overpass API).
 * Viser fysisk infrastruktur – uavhengig av trafikk.
 */

import { fetchWithRetry } from './fetch-with-retry.js';

const OVERPASS_URL = 'https://overpass-api.de/api/interpreter';

/** Stor-Oslo: Drammen, Eidsvoll, Ski, Kongsberg, osv. */
const OSM_RAIL_BBOX = { south: 59.65, west: 9.9, north: 60.35, east: 11.6 };

const RAIL_QUERY = `[out:json][timeout:45];
way["railway"="rail"](${OSM_RAIL_BBOX.south},${OSM_RAIL_BBOX.west},${OSM_RAIL_BBOX.north},${OSM_RAIL_BBOX.east});
out geom;`;

/**
 * Henter alle jernbaneskinner i bbox og konverterer til shapes.
 * @returns {Promise<Array<{mode:string,line:string,from:string,to:string,points:number[][]}>>}
 */
export async function fetchOsmRailTracks() {
  try {
    const res = await fetchWithRetry(
      OVERPASS_URL,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: `data=${encodeURIComponent(RAIL_QUERY)}`,
      },
      { timeout: 50000, retries: 2 }
    );
    const text = await res.text();
    if (!text.startsWith('{')) {
      throw new Error(text.slice(0, 100));
    }
    const data = JSON.parse(text);
    const elements = data?.elements ?? [];

    const candidates = [];
    const seen = new Set();

    for (const el of elements) {
      if (el.type !== 'way' || !Array.isArray(el.geometry) || el.geometry.length < 2) continue;

      const points = el.geometry.map((g) => [Number(g.lat), Number(g.lon)]).filter((p) => !isNaN(p[0]) && !isNaN(p[1]));
      if (points.length < 2) continue;

      const key = `${points[0][0].toFixed(4)},${points[0][1].toFixed(4)}-${points[points.length - 1][0].toFixed(4)},${points[points.length - 1][1].toFixed(4)}`;
      if (seen.has(key)) continue;
      seen.add(key);

      const name = el.tags?.name || 'Jernbane';
      candidates.push({
        mode: 'rail',
        line: `${name}-${el.id}`,
        from: '',
        to: '',
        via: null,
        points,
        _len: points.length,
      });
    }

    candidates.sort((a, b) => b._len - a._len);
    const shapes = candidates.slice(0, 400).map(({ _len, ...s }) => s);

    if (shapes.length > 0) {
      console.log(`[RuterLive] OSM jernbane: ${shapes.length} strekninger (av ${candidates.length})`);
    }
    return shapes;
  } catch (err) {
    console.warn('[RuterLive] OSM jernbane:', err.message);
    return [];
  }
}
