/**
 * Statisk flybuss-rutenett basert på kjente holdeplasskoordinater.
 * Oslo Bussterminal, Oslo S ↔ Oslo lufthavn (Gardermoen).
 * Vises alltid – uavhengig av sanntidsdata og JP API.
 *
 * Koordinater fra NSR/GTFS: Oslo Bussterminal, Oslo S, Oslo lufthavn.
 */

/** Oslo Bussterminal – Schweigaards gate / Galleriet */
const OSLO_BUSSTINAL = [59.911236, 10.758852];
/** Oslo S – Jernbanetorget */
const OSLO_S = [59.9107, 10.7525];
/** Oslo lufthavn Gardermoen */
const OSLO_LUFTHAVN = [60.1939, 11.1004];

/**
 * Flybussruter med polylines mellom hubber.
 * Bruker en mellomliggende waypoint for å antyde E6-korridoren (Oslo → nord → Gardermoen).
 */
const FLYBUSS_ROUTE_WAYPOINTS = [
  [59.96, 10.92], // ~Lillestrøm-området – grovt E6-korridor
];

function buildFlybussLine(from, to, fromName, toName, lineCode = 'FB') {
  const points = [[...from], ...FLYBUSS_ROUTE_WAYPOINTS, [...to]];
  return {
    mode: 'flybuss',
    line: lineCode,
    from: fromName,
    to: toName,
    via: null,
    points,
  };
}

/**
 * Returnerer statiske flybuss-shapes. Aldri tom – alltid minst Oslo Bussterminal ↔ lufthavn og Oslo S ↔ lufthavn.
 * @returns {Array<{mode:string,line:string,from:string,to:string,via:null,points:number[][]}>}
 */
export function getFlybussShapes() {
  return [
    buildFlybussLine(OSLO_BUSSTINAL, OSLO_LUFTHAVN, 'Oslo Bussterminal', 'Oslo lufthavn', 'FB'),
    buildFlybussLine(OSLO_LUFTHAVN, OSLO_BUSSTINAL, 'Oslo lufthavn', 'Oslo Bussterminal', 'FB'),
    buildFlybussLine(OSLO_S, OSLO_LUFTHAVN, 'Oslo S', 'Oslo lufthavn', 'FB'),
    buildFlybussLine(OSLO_LUFTHAVN, OSLO_S, 'Oslo lufthavn', 'Oslo S', 'FB'),
  ];
}
