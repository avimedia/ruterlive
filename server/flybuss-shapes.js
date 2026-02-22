/**
 * Flybuss-rutenett med alle stoppesteder.
 * Basert på Flybussen Connect: FB1, FB3, FB5 fra flybussen.no
 * https://www.flybussen.no/flyplasser/oslo-lufthavn/oslo-lufthavn-flybussen-connect/stoppesteder/
 *
 * Koordinater fra NSR/kartverk.
 */

/** Punkter med [lat, lon, quayId, name] – quayId null for statiske stopp */
const GARDERMOEN = [60.1939, 11.1004, null, 'Oslo lufthavn'];
const LILLESTROM = [59.955, 11.0497, null, 'Lillestrøm'];
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
const JERNBANETORGET = [59.9112, 10.7522, null, 'Jernbanetorget'];
const MAJORSTUEN = [59.9295, 10.7162, null, 'Majorstuen'];
const ULLEVAAL = [59.9375, 10.734, null, 'Ullevål stadion'];
const TAASEN = [59.948, 10.751, null, 'Tåsen'];
const SMESTAD = [59.941, 10.699, null, 'Smestad'];
const RADIUMHOSPITALET = [59.9328, 10.698, null, 'Radiumhospitalet'];
const SINSEN = [59.9385, 10.782, null, 'Sinsen'];
const BJOLSON = [59.9315, 10.791, null, 'Bjølsen'];
const MUNKELI = [59.925, 10.804, null, 'Munkelia'];

/** Flybussruter med alle stopp. FB1: Majorstuen via Torshov-Sagene */
const FB1_LUFTHAVN_TO_MAJORSTUEN = [
  GARDERMOEN,
  LILLESTROM,
  [59.98, 11.06, null, 'Kjeller'],
  [60.04, 11.1, null, 'Sørum'],
  [60.12, 11.1, null, 'E6 rastplass'],
  [59.96, 10.92, null, 'Strømmen'],
  GRORUD,
  SINSEN,
  BJOLSON,
  TORSHOV,
  CARL_BERNERS,
  SAGENE,
  ULLEVAAL,
  MAJORSTUEN,
];

const FB1_MAJORSTUEN_TO_LUFTHAVN = [...FB1_LUFTHAVN_TO_MAJORSTUEN].reverse();

/** FB3: Radiumhospitalet via Økern-Storo-Tåsen-Smestad */
const FB3_LUFTHAVN_TO_RADIUM = [
  GARDERMOEN,
  LILLESTROM,
  [59.98, 11.06, null, 'Kjeller'],
  [60.04, 11.1, null, 'Sørum'],
  GRORUD,
  MUNKELI,
  OKERN,
  STORO,
  TAASEN,
  SMESTAD,
  RADIUMHOSPITALET,
];

const FB3_RADIUM_TO_LUFTHAVN = [...FB3_LUFTHAVN_TO_RADIUM].reverse();

/** FB5: Oslo sentrum via Helsfyr-Hasle-Bislett */
const FB5_LUFTHAVN_TO_OSLO = [
  GARDERMOEN,
  LILLESTROM,
  [59.96, 10.92, null, 'Strømmen'],
  HELSFYR,
  HASLE,
  OKERN,
  CARL_BERNERS,
  BISLETT,
  JERNBANETORGET,
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
