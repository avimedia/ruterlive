/**
 * Regioninnstillinger, delt av server og nettleser (ingen process.env her).
 * Å legge til en region er en ny oppføring i REGIONS. Bergen er offentlig; en ny region kan skjules med public: false og forhåndsvises via REGIONS_PREVIEW.
 */

export const REGIONS = Object.freeze({
  oslo: Object.freeze({
    id: 'oslo',
    name: 'Oslo og Viken',
    shortName: 'Oslo', // brødsmuler
    path: '', // URL-prefiks; Oslo ligger på roten
    public: true,
    alwaysActive: true, // ET-data holdes varme uavhengig av besøk
    authorities: Object.freeze(['RUT']),
    situationCodespaces: Object.freeze(['RUT']), // avvik (SIRI SX); tog kommer i tillegg
    jpRailFallback: true, // tog-rutefallback via Journey Planner fra Oslo S
    center: Object.freeze([59.9110, 10.7525]), // Oslo S / Jernbanetorget
    defaultZoom: 14,
    // Kjøretøy-spørringen mot Entur og kartutsnittet som huskes
    vehicleBounds: Object.freeze({ minLat: 59.45, maxLat: 60.2, minLon: 10.15, maxLon: 11.25 }),
    // GTFS-stopp utenfor boksen filtreres bort (minnebruk på Render)
    stopsBounds: Object.freeze({ minLat: 59.2, maxLat: 60.8, minLon: 10.0, maxLon: 11.6 }),
    // Rutegeometri fra Journey Planner klippes til denne boksen
    geometryBounds: Object.freeze({ s: 59.0, n: 60.45, w: 9.4, e: 12.1 }),
    etDatasets: Object.freeze(['RUT']),
    // maxSize for ET-kallet: RUT har ~2200 turer, margin så svaret ikke kuttes stille (Entur sender ikke MoreData)
    etMaxSize: 5000,
    // Linjenummer-fallback for transportmodus ('ruter': 1–6 T-bane, 11–19 trikk, ≥20 buss)
    lineNumberFallback: 'ruter',
    // Kartlenke fra linjesidene
    mapLink: Object.freeze({ lat: 59.925, lng: 10.75 }),
  }),
  bergen: Object.freeze({
    id: 'bergen',
    name: 'Bergen og Vestland',
    shortName: 'Bergen',
    path: '/bergen',
    public: true,
    alwaysActive: false,
    authorities: Object.freeze(['SKY']),
    situationCodespaces: Object.freeze(['SKY']),
    center: Object.freeze([60.3925, 5.3240]), // Byparken
    defaultZoom: 14,
    // Dekker hele Skyss-området (Vestland); målt SKY-kjøretøy: lat 59.39-62.47, lon 4.62-7.81
    vehicleBounds: Object.freeze({ minLat: 59.3, maxLat: 62.6, minLon: 4.5, maxLon: 7.9 }),
    stopsBounds: Object.freeze({ minLat: 59.1, maxLat: 62.8, minLon: 4.3, maxLon: 8.1 }),
    geometryBounds: Object.freeze({ s: 58.9, n: 63.0, w: 4.1, e: 8.3 }),
    etDatasets: Object.freeze(['SKY']),
    etMaxSize: 10000, // SKY: ~6800 turer for flere døgn fremover
    lineNumberFallback: null,
    mapLink: Object.freeze({ lat: 60.3925, lng: 5.324 }),
  }),
});

export const DEFAULT_REGION = 'oslo';

// Hele Norge (grov boks). Tog vises i hele landet, så kartutsnitt her kan huskes.
export const NORWAY_BOUNDS = Object.freeze({ minLat: 57.8, maxLat: 71.3, minLon: 4.0, maxLon: 31.5 });

/** Regionen med gitt id, ellers standardregionen. */
export function getRegion(id = DEFAULT_REGION) {
  return REGIONS[id] || REGIONS[DEFAULT_REGION];
}

/** Ligger punktet innenfor regionens vehicleBounds? */
export function isInBounds(region, lat, lon) {
  const b = region.vehicleBounds;
  return lat >= b.minLat && lat <= b.maxLat && lon >= b.minLon && lon <= b.maxLon;
}

/** Regionen med gitt id, eller null for ukjente id-er (også __proto__ o.l.). */
export function findRegion(id) {
  return typeof id === 'string' && Object.hasOwn(REGIONS, id) ? REGIONS[id] : null;
}

/** Offentlige regioner, Oslo først. */
export function publicRegions(regions = REGIONS) {
  return Object.values(regions)
    .filter((r) => r.public)
    .sort((a, b) => (b.id === DEFAULT_REGION) - (a.id === DEFAULT_REGION));
}

/** Synlige regioner: offentlige pluss de som er slått på i forhåndsvisningslisten (Oslo først). */
export function visibleRegions(preview = [], regions = REGIONS) {
  return Object.values(regions)
    .filter((r) => r.public || preview.includes(r.id))
    .sort((a, b) => (b.id === DEFAULT_REGION) - (a.id === DEFAULT_REGION));
}

/** Region og resten av stien: /bergen/linje/x gir bergen og /linje/x. Ukjent eller skjult gir Oslo. */
export function regionFromPath(pathname, visible = visibleRegions()) {
  for (const region of visible) {
    if (!region.path) continue;
    if (pathname === region.path) return { region, rest: '/' };
    if (pathname.startsWith(region.path + '/')) return { region, rest: pathname.slice(region.path.length) };
  }
  return { region: REGIONS[DEFAULT_REGION], rest: pathname };
}

/** Sti i regionen: regionPath(oslo, '/linje/x') er /linje/x, regionPath(bergen) er /bergen. */
export function regionPath(region, sub = '') {
  return (region.path + sub) || '/';
}

/** Første synlige region der punktet ligger innenfor vehicleBounds, ellers null. */
export function regionAt(lat, lon, visible = visibleRegions()) {
  return visible.find((r) => isInBounds(r, lat, lon)) || null;
}
