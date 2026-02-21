/**
 * OSRM Route API – henter veifølgende geometri for ruter.
 * Brukes for buss og trikk slik at linjene følger veier i stedet for rette streker.
 */

const OSRM_BASE = '/api/osrm';

// OSRM public server har begrensning; bruk max 50 waypoints per forespørsel
const MAX_WAYPOINTS = 50;

const geometryCache = new Map();

function coordsToCacheKey(coords) {
  return coords
    .map(([lat, lon]) => `${lat.toFixed(4)},${lon.toFixed(4)}`)
    .join(';');
}

/**
 * Henter veifølgende rute fra OSRM.
 * @param {Array<[number, number]>} coords - [[lat, lon], ...]
 * @returns {Promise<Array<[number, number]>|null>} [[lat, lon], ...] eller null ved feil
 */
export async function getRouteGeometry(coords) {
  if (!coords || coords.length < 2) return null;

  const key = coordsToCacheKey(coords);
  if (geometryCache.has(key)) {
    return geometryCache.get(key);
  }

  // Begrens antall waypoints; sample jevnt fordelt
  let waypoints = coords;
  if (waypoints.length > MAX_WAYPOINTS) {
    const step = (waypoints.length - 1) / (MAX_WAYPOINTS - 1);
    waypoints = [];
    for (let i = 0; i < MAX_WAYPOINTS; i++) {
      const idx = Math.round(i * step);
      waypoints.push(coords[Math.min(idx, coords.length - 1)]);
    }
  }

  // OSRM bruker lon,lat format
  const coordsStr = waypoints.map(([lat, lon]) => `${lon},${lat}`).join(';');
  const url = `${OSRM_BASE}/route/v1/driving/${coordsStr}?overview=full&geometries=geojson`;

  try {
    const res = await fetch(url);
    if (!res.ok) return null;
    const data = await res.json();
    const geom = data?.routes?.[0]?.geometry;
    if (!geom?.coordinates?.length) return null;

    // GeoJSON er [lon, lat] → Leaflet ønsker [lat, lon]
    const points = geom.coordinates.map(([lon, lat]) => [lat, lon]);
    geometryCache.set(key, points);
    return points;
  } catch (_) {
    return null;
  }
}

/**
 * Beriker flere rutelinjer med OSRM-geometri.
 * Kun for bus og tram; metro og water beholder rette linjer.
 */
export async function enrichShapesWithOSRM(shapes, concurrency = 5) {
  const toEnrich = shapes.filter((s) => (s.mode === 'bus' || s.mode === 'tram') && s.points?.length >= 2);
  if (toEnrich.length === 0) return shapes;

  for (let i = 0; i < toEnrich.length; i += concurrency) {
    const batch = toEnrich.slice(i, i + concurrency);
    const results = await Promise.all(
      batch.map(async (shape) => {
        const geometry = await getRouteGeometry(shape.points);
        return geometry ? { ...shape, points: geometry } : shape;
      })
    );
    for (let j = 0; j < batch.length; j++) {
      const idx = shapes.indexOf(batch[j]);
      if (idx >= 0 && results[j].points !== batch[j].points) {
        shapes[idx] = results[j];
      }
    }
  }
  return shapes;
}
