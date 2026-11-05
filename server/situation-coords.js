/**
 * Koordinater til holdeplassene i avvik (/api/situations), så kartet kan vise et merke per holdeplass.
 * Bruker bare data som allerede er i minnet: GTFS-quayene (gtfs-stops-loader.js, med parent = stoppestedsnummer)
 * og stoppkatalogene. Ingen kall mot Entur.
 */

const QUAY_RE = /^NSR:Quay:\d+$/;
const PLACE_RE = /^NSR:StopPlace:(\d+)$/;

/** 5 desimaler (~1 m) holder JSON-svaret kompakt. */
const round5 = (n) => Math.round(n * 1e5) / 1e5;

/**
 * `getStopsMap()` gir GTFS-kartet Map<quayId, { lat, lon, parent }> (eller null før lasting);
 * `catalogStops()` gir stopp med { id, lat, lon } (reserve for stoppesteder uten quayer i GTFS).
 * Gir en funksjon ids → Map<id, [lat, lon]>; ukjente id-er er ikke med.
 */
export function createStopCoords({ getStopsMap, catalogStops = () => [] }) {
  return function coordsFor(ids) {
    const out = new Map();
    const gtfs = getStopsMap();
    // Stoppesteder: snitt av quayene, funnet i én gjennomgang av GTFS-kartet
    const places = new Map();
    for (const id of new Set(ids)) {
      if (typeof id !== 'string') continue;
      if (QUAY_RE.test(id)) {
        const q = gtfs?.get(id);
        if (q) out.set(id, [round5(q.lat), round5(q.lon)]);
        continue;
      }
      const m = PLACE_RE.exec(id);
      if (m) places.set(Number(m[1]), { id, lat: 0, lon: 0, n: 0 });
    }
    if (places.size && gtfs) {
      for (const q of gtfs.values()) {
        const p = q.parent === undefined ? null : places.get(q.parent);
        if (!p) continue;
        p.lat += q.lat;
        p.lon += q.lon;
        p.n += 1;
      }
    }
    let catalog = null;
    for (const p of places.values()) {
      if (p.n) {
        out.set(p.id, [round5(p.lat / p.n), round5(p.lon / p.n)]);
        continue;
      }
      catalog ??= new Map(catalogStops().map((s) => [s.id, s]));
      const s = catalog.get(p.id);
      if (s && Number.isFinite(s.lat) && Number.isFinite(s.lon)) out.set(p.id, [round5(s.lat), round5(s.lon)]);
    }
    return out;
  };
}

/**
 * Kopier av avvikene med lat/lon på stoppene som har koordinat. Originalene (delt med sidene) endres ikke;
 * avvik uten stopp gjenbrukes som de er.
 */
export function withStopCoords(situations, coordsFor) {
  const coords = coordsFor(situations.flatMap((s) => (s.stops || []).map((p) => p.id)));
  return situations.map((s) => {
    if (!s.stops?.length) return s;
    return {
      ...s,
      stops: s.stops.map((p) => {
        const c = coords.get(p.id);
        return c ? { ...p, lat: c[0], lon: c[1] } : p;
      }),
    };
  });
}
