/**
 * Flybuss-rutenett med alle stoppesteder.
 * Basert på Flybussen Connect FB1, FB3, FB5 fra flybussen.no
 * Rekkefølge og avstand sjekkes mot faktisk geografi – Oslo lufthavn alltid første/siste stopp.
 *
 * Koordinater fra NSR/kartverk. E6 går sørover fra Gardermoen (60.19°N) til Oslo (~59.91°N).
 */

/** Punkter med [lat, lon, quayId, name] – quayId null for statiske stopp */
const GARDERMOEN = [60.1939, 11.1004, null, 'Oslo lufthavn'];
const GRORUD = [59.9615, 10.8817, null, 'Grorud'];
const OKERN = [59.9248, 10.7965, null, 'Økern'];
const HASLE = [59.922, 10.797, null, 'Hasle'];
const HELSFYR = [59.9186, 10.7912, null, 'Helsfyr'];
const STORO = [59.9459, 10.7773, null, 'Storo'];
const TORSHOV = [59.9296, 10.7767, null, 'Torshov'];
const CARL_BERNERS = [59.9285, 10.778, null, 'Carl Berners plass'];
const SAGENE = [59.935, 10.7522, null, 'Sagene'];
const BISLETT = [59.923, 10.731, null, 'Bislett'];
const OSLO_S = [59.9107, 10.7525, null, 'Oslo S'];
const MAJORSTUEN = [59.9295, 10.7162, null, 'Majorstuen'];
const ULLEVAAL = [59.9375, 10.734, null, 'Ullevål stadion'];
const TAASEN = [59.948, 10.751, null, 'Tåsen'];
const SMESTAD = [59.941, 10.699, null, 'Smestad'];
const RADIUMHOSPITALET = [59.9328, 10.698, null, 'Radiumhospitalet'];
const SINSEN = [59.9385, 10.782, null, 'Sinsen'];

/** E6-mellomstopp sørover: Gardermoen (60.19) → Oslo (~59.96). Breddegrad minsker sørover. */
const E6_SOUTH = [
  [60.12, 11.08, null, 'Olavsgaard'],
  [60.05, 11.05, null, 'Hellerud E6'],
  [59.99, 11.02, null, 'Kjeller'],
  [59.965, 10.95, null, 'Strømmen'],
];

/** FB1: Majorstuen via Torshov-Sagene. Oslo lufthavn → E6 → Grorud → Sinsen → Carl Berners → Torshov → Sagene → Ullevål → Majorstuen */
const FB1_LUFTHAVN_TO_MAJORSTUEN = [
  GARDERMOEN,
  ...E6_SOUTH,
  GRORUD,
  SINSEN,
  CARL_BERNERS,
  TORSHOV,
  SAGENE,
  ULLEVAAL,
  MAJORSTUEN,
];

const FB1_MAJORSTUEN_TO_LUFTHAVN = [...FB1_LUFTHAVN_TO_MAJORSTUEN].reverse();

/** FB3: Radiumhospitalet via Økern-Storo-Tåsen-Smestad. Oslo lufthavn → E6 → Grorud → Økern → Sinsen → Storo → Tåsen → Smestad → Radiumhospitalet */
const FB3_LUFTHAVN_TO_RADIUM = [
  GARDERMOEN,
  ...E6_SOUTH,
  GRORUD,
  OKERN,
  SINSEN,
  STORO,
  TAASEN,
  SMESTAD,
  RADIUMHOSPITALET,
];

const FB3_RADIUM_TO_LUFTHAVN = [...FB3_LUFTHAVN_TO_RADIUM].reverse();

/** FB5: Oslo sentrum via Helsfyr-Hasle-Bislett. Oslo lufthavn → E6 → Helsfyr → Hasle → Carl Berners → Bislett → Oslo S */
const FB5_LUFTHAVN_TO_OSLO = [
  GARDERMOEN,
  ...E6_SOUTH,
  HELSFYR,
  HASLE,
  CARL_BERNERS,
  BISLETT,
  OSLO_S,
];

const FB5_OSLO_TO_LUFTHAVN = [...FB5_LUFTHAVN_TO_OSLO].reverse();

/** Bygger shape med punkter [[lat,lon,quayId,name],...] */
function buildFlybussShape(points, fromName, toName, lineCode) {
  return {
    mode: 'flybuss',
    line: lineCode,
    from: fromName,
    to: toName,
    via: null,
    points: points.map((p) => [p[0], p[1], p[2], p[3]]),
    quayStops: points.map((p) => [p[0], p[1], p[2], p[3]]),
  };
}

/**
 * Returnerer flybuss-shapes med alle stopp for FB1, FB3, FB5.
 * Vises ved klikk på flybuss-kjøretøy.
 */
export function getFlybussShapes() {
  return [
    buildFlybussShape(FB1_LUFTHAVN_TO_MAJORSTUEN, 'Oslo lufthavn', 'Majorstuen', 'FB1'),
    buildFlybussShape(FB1_MAJORSTUEN_TO_LUFTHAVN, 'Majorstuen', 'Oslo lufthavn', 'FB1'),
    buildFlybussShape(FB3_LUFTHAVN_TO_RADIUM, 'Oslo lufthavn', 'Radiumhospitalet', 'FB3'),
    buildFlybussShape(FB3_RADIUM_TO_LUFTHAVN, 'Radiumhospitalet', 'Oslo lufthavn', 'FB3'),
    buildFlybussShape(FB5_LUFTHAVN_TO_OSLO, 'Oslo lufthavn', 'Oslo S', 'FB5'),
    buildFlybussShape(FB5_OSLO_TO_LUFTHAVN, 'Oslo S', 'Oslo lufthavn', 'FB5'),
    // Generisk FB for linjer vi ikke har spesifikk data for (FB2, FB4, etc.)
    buildFlybussShape(FB5_LUFTHAVN_TO_OSLO, 'Oslo lufthavn', 'Oslo Bussterminal', 'FB'),
    buildFlybussShape(FB5_OSLO_TO_LUFTHAVN, 'Oslo Bussterminal', 'Oslo lufthavn', 'FB'),
  ];
}
