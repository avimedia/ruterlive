/**
 * Statisk jernbane-fallback når Entur og OSM begge feiler.
 * Grove traséstrekninger for hovedlinjer i Stor-Oslo.
 *
 * Koordinater: NSR/OSM – Oslo S, Lillestrøm, Drammen, Ski, etc.
 */

/** Oslo S */
const OSLO_S = [59.9107, 10.7525];
/** Lillestrøm */
const LILLESTROM = [59.9550, 11.0497];
/** Drammen */
const DRAMMEN = [59.7440, 10.2045];
/** Ski */
const SKI = [59.7427, 10.8357];
/** Eidsvoll */
const EIDSVOLL = [60.3285, 11.2560];
/** Kongsberg */
const KONGSBERG = [59.6640, 9.6460];
/** Skien */
const SKIEN = [59.2094, 9.6089];
/** Oslo lufthavn Gardermoen */
const GARDERMOEN = [60.1939, 11.1004];

/** Mellomstop langs Østfoldbanen (Oslo–Ski) */
const SKOYWEN = [59.8340, 10.7990];
/** Mellomstop Drammensbanen */
const SANDVIKA = [59.8900, 10.5260];

/** Bygger en jernbanetrasé fra A til B med mellompunkter */
function buildRailLine(points, fromName, toName, lineCode) {
  return {
    mode: 'rail',
    line: lineCode,
    from: fromName,
    to: toName,
    via: null,
    points,
  };
}

/** Returnerer statiske jernbane-shapes som fallback når Entur/OSM feiler. */
export function getFallbackRailShapes() {
  return [
    buildRailLine([OSLO_S, LILLESTROM], 'Oslo S', 'Lillestrøm', 'L1'),
    buildRailLine([LILLESTROM, OSLO_S], 'Lillestrøm', 'Oslo S', 'L1'),
    buildRailLine([OSLO_S, SANDVIKA, DRAMMEN], 'Oslo S', 'Drammen', 'R20'),
    buildRailLine([DRAMMEN, SANDVIKA, OSLO_S], 'Drammen', 'Oslo S', 'R20'),
    buildRailLine([OSLO_S, SKOYWEN, SKI], 'Oslo S', 'Ski', 'R21'),
    buildRailLine([SKI, SKOYWEN, OSLO_S], 'Ski', 'Oslo S', 'R21'),
    buildRailLine([OSLO_S, LILLESTROM, EIDSVOLL], 'Oslo S', 'Eidsvoll', 'R22'),
    buildRailLine([EIDSVOLL, LILLESTROM, OSLO_S], 'Eidsvoll', 'Oslo S', 'R22'),
    buildRailLine([OSLO_S, SKOYWEN, KONGSBERG], 'Oslo S', 'Kongsberg', 'R22'),
    buildRailLine([KONGSBERG, SKOYWEN, OSLO_S], 'Kongsberg', 'Oslo S', 'R22'),
    buildRailLine([OSLO_S, SKOYWEN, SKI, SKIEN], 'Oslo S', 'Skien', 'R10'),
    buildRailLine([SKIEN, SKI, SKOYWEN, OSLO_S], 'Skien', 'Oslo S', 'R10'),
    buildRailLine([OSLO_S, LILLESTROM, GARDERMOEN], 'Oslo S', 'Oslo lufthavn', 'F1'),
    buildRailLine([GARDERMOEN, LILLESTROM, OSLO_S], 'Oslo lufthavn', 'Oslo S', 'F1'),
  ].map((s) => (s.line === 'F1' ? { ...s, mode: 'flytog' } : s));
}
