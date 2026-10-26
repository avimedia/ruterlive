/**
 * Regioninnstillinger, delt av server og nettleser (ingen process.env her).
 * Å legge til en region er en ny oppføring i REGIONS. Foreløpig er Oslo den eneste.
 */

export const REGIONS = Object.freeze({
  oslo: Object.freeze({
    id: 'oslo',
    name: 'Oslo og Viken',
    center: Object.freeze([59.9110, 10.7525]), // Oslo S / Jernbanetorget
    defaultZoom: 14,
    // Kjøretøy-spørringen mot Entur og kartutsnittet som huskes
    vehicleBounds: Object.freeze({ minLat: 59.45, maxLat: 60.2, minLon: 10.15, maxLon: 11.25 }),
    // GTFS-stopp utenfor boksen filtreres bort (minnebruk på Render)
    stopsBounds: Object.freeze({ minLat: 59.2, maxLat: 60.8, minLon: 10.0, maxLon: 11.6 }),
    // Rutegeometri fra Journey Planner klippes til denne boksen
    geometryBounds: Object.freeze({ s: 59.0, n: 60.45, w: 9.4, e: 12.1 }),
    etDatasets: Object.freeze(['RUT']),
    // Linjenummer-fallback for transportmodus ('ruter': 1–6 T-bane, 11–19 trikk, ≥20 buss)
    lineNumberFallback: 'ruter',
    // Kartlenke fra linjesidene
    mapLink: Object.freeze({ lat: 59.925, lng: 10.75 }),
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
