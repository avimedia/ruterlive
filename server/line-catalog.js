/**
 * Linjekatalog for innholdssidene (/linje/:slug) og stopplister fra Entur Journey Planner.
 * Introtekster ligger i content/line-intros.json (slug -> tekst), lengre tekster i content/linje/<slug>.html.
 */

import { readFileSync, existsSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import { CLIENT_NAME } from './entur-client.js';
import bergenCatalog from '../shared/lines/bergen.js';
import { getRegion } from '../shared/regions.js';

const JP_URL = 'https://api.entur.io/journey-planner/v3/graphql';
const CACHE_TTL_MS = 24 * 60 * 60 * 1000;
const TIMEOUT_MS = 5000;

function loadIntros() {
  try {
    return JSON.parse(readFileSync(new URL('../content/line-intros.json', import.meta.url), 'utf8'));
  } catch (e) {
    console.warn('[RuterLive] Mangler content/line-intros.json, bruker tomme introer:', e.message);
    return {};
  }
}

const intros = loadIntros();

export const BUS_CODES = ['20', '21', '23', '25', '28', '30', '31', '34', '37', '54', '60', '70', '74', '81', '100', '110', '150', '160'];

const RAW_LINES = [
  ...['1', '2', '3', '4', '5'].map((n) => ({ slug: `t-bane-${n}`, code: n, authority: 'RUT', mode: 'metro', title: `T-bane linje ${n}` })),
  ...['12', '13', '15', '17', '18', '19'].map((n) => ({ slug: `trikk-${n}`, code: n, authority: 'RUT', mode: 'tram', title: `Trikk linje ${n}` })),
  { slug: 'tog-l1', code: 'L1', authority: 'VYG', mode: 'rail', region: 'ostlandet', title: 'Tog L1' },
  { slug: 'tog-l2', code: 'L2', aliases: ['L2x'], authority: 'VYG', mode: 'rail', region: 'ostlandet', title: 'Tog L2' },
  { slug: 'tog-r12', code: 'R12', authority: 'VYG', mode: 'rail', region: 'ostlandet', title: 'Tog R12' },
  { slug: 'tog-r13', code: 'R13', aliases: ['R13x'], authority: 'VYG', mode: 'rail', region: 'ostlandet', title: 'Tog R13' },
  { slug: 'tog-r14', code: 'R14', authority: 'VYG', mode: 'rail', region: 'ostlandet', title: 'Tog R14' },
  { slug: 'tog-r21', code: 'R21', authority: 'VYG', mode: 'rail', region: 'ostlandet', title: 'Tog R21' },
  { slug: 'tog-r22', code: 'R22', authority: 'VYG', mode: 'rail', region: 'ostlandet', title: 'Tog R22' },
  { slug: 'tog-r23', code: 'R23', aliases: ['R23x'], authority: 'VYG', mode: 'rail', region: 'ostlandet', title: 'Tog R23' },
  { slug: 'tog-re10', code: 'RE10', authority: 'VYG', mode: 'rail', region: 'ostlandet', title: 'Tog RE10' },
  { slug: 'tog-re11', code: 'RE11', aliases: ['RX11'], authority: 'VYG', mode: 'rail', region: 'ostlandet', title: 'Tog RE11' },
  { slug: 'tog-re20', code: 'RE20', aliases: ['RX20'], authority: 'VYG', mode: 'rail', region: 'ostlandet', title: 'Tog RE20' },
  { slug: 'tog-re30', code: 'RE30', authority: 'VYG', mode: 'rail', region: 'ostlandet', title: 'Tog RE30' },
  // Tog utenfor Oslo-området (Vy, Go-Ahead, SJ Nord). `map` er midtpunkt og zoom for holdeplassene i
  // hovedmønstrene, så kartlenken viser hele linjen. `national`: ikke med i line-geometry.js (rail-network.js
  // har trasé for hele landet). Titler med «–» har strekningen i seg, så line-page.js legger ikke til endepunkter.
  ...[
    ['f4', 'VYG', 'Tog F4 Oslo–Bergen (Bergensbanen)', 'fjerntog', 60.241, 8.045, 6],
    ['f5', 'GOA', 'Tog F5 Oslo–Stavanger (Sørlandsbanen)', 'fjerntog', 59.045, 8.203, 6],
    ['f6', 'SJN', 'Tog F6 Oslo–Trondheim (Dovrebanen)', 'fjerntog', 61.724, 10.111, 6],
    ['f7', 'SJN', 'Tog F7 Trondheim–Bodø (Nordlandsbanen)', 'fjerntog', 65.44, 12.932, 6],
    ['r31', 'VYG', 'Tog R31 Oslo–Gjøvik (Gjøvikbanen)', 'ostlandet', 60.357, 10.683, 8],
    ['r55', 'VYG', 'Tog R55 Porsgrunn–Notodden', 'ostlandet', 59.349, 9.458, 9],
    ['l4', 'VYG', 'Tog L4 Bergen–Arna', 'vestlandet', 60.405, 5.399, 12],
    ['r40', 'VYG', 'Tog R40 Bergen–Voss (Vossebanen)', 'vestlandet', 60.563, 6.228, 8],
    ['r45', 'VYG', 'Tog R45 Myrdal–Flåm (Flåmsbana)', 'vestlandet', 60.799, 7.118, 11],
    ['l5', 'GOA', 'Tog L5 Stavanger–Egersund (Jærbanen)', 'vestlandet', 58.715, 5.821, 9],
    ['r65', 'SJN', 'Tog R65 Dombås–Åndalsnes (Raumabanen)', 'vestlandet', 62.319, 8.408, 8],
    ['r50', 'GOA', 'Tog R50 Arendal–Nelaug (Arendalsbanen)', 'sorlandet', 58.56, 8.697, 10],
    ['r60', 'SJN', 'Tog R60 Hamar–Trondheim (Rørosbanen)', 'trondelag', 62.153, 10.888, 6],
    ['r70', 'SJN', 'Tog R70 Trondheim–Steinkjer (Trønderbanen)', 'trondelag', 63.536, 10.863, 8],
    ['r71', 'SJN', 'Tog R71 Trondheim–Storlien (Meråkerbanen)', 'trondelag', 63.389, 11.229, 8],
    ['r75', 'SJN', 'Tog R75 Bodø–Rognan (Saltenpendelen)', 'trondelag', 67.198, 14.895, 9],
  ].map(([c, authority, title, region, lat, lng, z]) => ({
    slug: `tog-${c}`, code: c.toUpperCase(), authority, mode: 'rail', title, region, national: true, map: { lat, lng, z },
  })),
  { slug: 'flytoget-fly1', code: 'FLY1', authority: 'FLT', mode: 'flytog', title: 'Flytoget FLY1' },
  { slug: 'flytoget-fly2', code: 'FLY2', authority: 'FLT', mode: 'flytog', title: 'Flytoget FLY2' },
  { slug: 'flybuss-fb1', code: 'FB1', authority: 'NBU', mode: 'flybuss', title: 'Flybuss FB1' },
  { slug: 'flybuss-fb3', code: 'FB3', authority: 'NBU', mode: 'flybuss', title: 'Flybuss FB3' },
  { slug: 'flybuss-fb5', code: 'FB5', authority: 'NBU', mode: 'flybuss', title: 'Flybuss FB5' },
  // Ruters travleste bylinjer og stamlinjer (valgt ut fra antall avganger i JP og kjøretøy ute).
  ...BUS_CODES.map((n) => ({ slug: `buss-${n.toLowerCase()}`, code: n, authority: 'RUT', mode: 'bus', title: `Buss ${n}` })),
];

/** Togregionene i linjeoversikten, i visningsrekkefølge (`region` på toglinjene). */
export const RAIL_REGIONS = [
  ['ostlandet', 'Østlandet'],
  ['fjerntog', 'Fjerntog'],
  ['vestlandet', 'Vestlandet'],
  ['sorlandet', 'Sørlandet'],
  ['trondelag', 'Trøndelag og Nordland'],
];

/** Oslo-katalogen (håndskrevet over). `region` er togregionen i oversikten; `regionId` er kartregionen. */
export const LINES = RAW_LINES.map((l) => ({
  aliases: [],
  ...l,
  regionId: 'oslo',
  indexed: true,
  intro: intros[l.slug] ?? '',
}));

const textUrl = (slug, regionId) =>
  new URL(regionId === 'oslo' ? `../content/linje/${slug}.html` : `../content/${regionId}/linje/${slug}.html`, import.meta.url);

/**
 * Genererte kataloger (shared/lines/<region>.js) for andre regioner. `indexed` er sant bare når linja
 * har egen tekst, så sider uten tekst ikke havner i søkemotorer (se regionspesifikasjonen).
 */
const GENERATED = { bergen: bergenCatalog };
export const REGION_LINES = Object.freeze({
  oslo: LINES,
  ...Object.fromEntries(
    Object.entries(GENERATED).map(([regionId, lines]) => [
      regionId,
      lines.map((l) => ({ aliases: [], ...l, regionId, indexed: existsSync(textUrl(l.slug, regionId)), intro: '' })),
    ]),
  ),
});

export function getLineBySlug(slug, regionId = 'oslo') {
  if (!Object.hasOwn(REGION_LINES, regionId)) return undefined;
  return REGION_LINES[regionId].find((l) => l.slug === slug);
}

const lineTextCache = new Map(); // regionId:slug -> tekst ('' = mangler fil)

/**
 * Håndskrevet tekst fra content/linje/<slug>.html (Oslo) eller content/<region>/linje/<slug>.html (cachet).
 * Bare slugs i regionens katalog godtas; ukjente slugs og manglende filer gir undefined.
 */
export async function getLineText(slug, regionId = 'oslo') {
  if (typeof slug !== 'string' || !/^[a-z0-9-]+$/.test(slug) || !getLineBySlug(slug, regionId)) return undefined;
  const key = `${regionId}:${slug}`;
  if (!lineTextCache.has(key)) {
    try {
      lineTextCache.set(key, await readFile(textUrl(slug, regionId), 'utf8'));
    } catch (e) {
      if (e.code !== 'ENOENT') throw e;
      if (regionId === 'oslo') console.warn(`[RuterLive] Mangler content/linje/${slug}.html`);
      lineTextCache.set(key, '');
    }
  }
  return lineTextCache.get(key) || undefined;
}

/** Togtur, ikke buss for tog (railReplacementBus har transportMode bus). Mangler modus: tog. */
const isRailPattern = (p) => String(p?.serviceJourneys?.[0]?.transportMode ?? 'rail').toLowerCase() === 'rail';

/**
 * Tog: buss for tog hoppes over, og mønstre med samme endepunkter slås sammen (turene summeres,
 * mønsteret med flest holdeplasser representerer dem). Fjerntog har ofte ett mønster per tur med
 * litt ulike stopp, så uten sammenslåing vinner et tilfeldig enkeltmønster. Samme valg som rail-network.js.
 */
function mergeRailPatterns(journeyPatterns) {
  const byEnds = new Map();
  for (const p of journeyPatterns) {
    if (!isRailPattern(p)) continue;
    const names = (p?.quays ?? []).map((q) => q?.name);
    const k = `${names[0]}|${names[names.length - 1]}`;
    const journeys = p?.serviceJourneys?.length ?? 0;
    const ex = byEnds.get(k);
    if (!ex) byEnds.set(k, { quays: p?.quays ?? [], journeys });
    else {
      ex.journeys += journeys;
      if ((p?.quays?.length ?? 0) > ex.quays.length) ex.quays = p.quays;
    }
  }
  return [...byEnds.values()].map(({ quays, journeys }) => ({ quays, serviceJourneys: { length: journeys } }));
}

/**
 * Velger hovedmønsteret: flest serviceJourneys * quays, ved likhet flest quays.
 * (Unngår korte pendelmønstre med mange avganger, f.eks. FLY2 med 2 stopp.)
 * `rail`: buss for tog tas ikke med, og mønstre med samme endepunkter telles sammen.
 * @returns {{ stops: string[], from: string, to: string } | null}
 */
export function pickMainPattern(journeyPatterns, { rail = false } = {}) {
  if (!Array.isArray(journeyPatterns) || journeyPatterns.length === 0) return null;
  const patterns = rail ? mergeRailPatterns(journeyPatterns) : journeyPatterns;
  let best = null;
  let bestJ = -1;
  let bestQ = -1;
  for (const p of patterns) {
    const j = (p?.serviceJourneys?.length ?? 0) * (p?.quays?.length ?? 0);
    const q = p?.quays?.length ?? 0;
    if (j > bestJ || (j === bestJ && q > bestQ)) {
      best = p;
      bestJ = j;
      bestQ = q;
    }
  }
  const stops = (best?.quays ?? []).map((q) => q?.name).filter(Boolean);
  if (stops.length === 0) return null;
  return { stops, from: stops[0], to: stops[stops.length - 1] };
}

// Hard tidsgrense med egen timer: AbortSignal.timeout alene stoppet ikke et hengende kall i prod,
// og med in-flight-dedup låste det linjesiden til serveren startet på nytt.
export async function jpQuery(query, fetchFn, timeoutMs = TIMEOUT_MS, variables = undefined) {
  const controller = new AbortController();
  let timer;
  const timeout = new Promise((_, reject) => {
    timer = setTimeout(() => {
      controller.abort();
      reject(new Error(`JP tidsavbrudd etter ${timeoutMs} ms`));
    }, timeoutMs);
  });
  const request = (async () => {
    const res = await fetchFn(JP_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'ET-Client-Name': CLIENT_NAME },
      body: JSON.stringify(variables ? { query, variables } : { query }),
      signal: controller.signal,
    });
    if (!res.ok) throw new Error(`JP ${res.status}`);
    const json = await res.json();
    if (json.errors?.length) throw new Error(json.errors[0].message);
    return json.data;
  })();
  try {
    return await Promise.race([request, timeout]);
  } finally {
    clearTimeout(timer);
  }
}

const idCaches = new Map(); // regionId -> { at, ids: Map<"AUTH:CODE", jpId> }
const stopsCache = new Map(); // regionId:slug -> { at, value } (value null = feil, cachet kort)
const idsInFlight = new Map(); // regionId -> Promise
const inFlight = new Map(); // regionId:slug -> Promise
const FAILURE_TTL_MS = 60 * 1000;

async function getLineIds(regionId, fetchFn, timeoutMs) {
  const cached = idCaches.get(regionId);
  if (cached && Date.now() - cached.at < CACHE_TTL_MS) return cached.ids;
  if (idsInFlight.has(regionId)) return idsInFlight.get(regionId);
  const p = fetchLineIds(regionId, fetchFn, timeoutMs).finally(() => idsInFlight.delete(regionId));
  idsInFlight.set(regionId, p);
  return p;
}

async function fetchLineIds(regionId, fetchFn, timeoutMs) {
  // Oslo: oppslag på linjekodene i katalogen. Andre regioner har hundrevis av koder, så der hentes
  // alle linjer for regionens operatører (bare id og kode).
  const query = regionId === 'oslo'
    ? `{ lines(publicCodes: ${JSON.stringify([...new Set(LINES.map((l) => l.code))])}) { id publicCode } }`
    : `{ lines(authorities: ${JSON.stringify(getRegion(regionId).authorities.map((a) => `${a}:Authority:${a}`))}) { id publicCode } }`;
  const data = await jpQuery(query, fetchFn, timeoutMs);
  const ids = new Map();
  for (const l of data?.lines ?? []) {
    const authority = String(l.id).split(':')[0];
    ids.set(`${authority}:${String(l.publicCode).toUpperCase()}`, l.id);
  }
  idCaches.set(regionId, { at: Date.now(), ids });
  return ids;
}

/**
 * Henter stoppliste for en linje fra Entur JP (cache 24 t). Gir null ved feil.
 * Cachen er per region + slug, så like slugs i ulike regioner ikke kolliderer.
 * @returns {Promise<{ stops: string[], from: string, to: string, name: string, fetchedAt: string } | null>}
 */
export async function getLineStops(line, fetchFn = fetch, timeoutMs = TIMEOUT_MS) {
  const regionId = line.regionId ?? 'oslo';
  const key = `${regionId}:${line.slug}`;
  const cached = stopsCache.get(key);
  if (cached && Date.now() - cached.at < (cached.value ? CACHE_TTL_MS : FAILURE_TTL_MS)) return cached.value;
  if (inFlight.has(key)) return inFlight.get(key);
  const promise = fetchLineStops(line, regionId, fetchFn, timeoutMs).then((value) => {
    stopsCache.set(key, { at: Date.now(), value });
    return value;
  }).finally(() => inFlight.delete(key));
  inFlight.set(key, promise);
  return promise;
}

async function fetchLineStops(line, regionId, fetchFn, timeoutMs) {
  try {
    // JP-linje-id: `ref` når katalogen har den (f.eks. Flybussen), ellers oppslag på operatør + kode
    const jpId = line.ref ?? (await getLineIds(regionId, fetchFn, timeoutMs)).get(`${line.authority}:${line.code.toUpperCase()}`);
    if (!jpId) return null;
    const data = await jpQuery(
      `{ line(id: ${JSON.stringify(jpId)}) { name journeyPatterns { quays { name } serviceJourneys { id transportMode } } } }`,
      fetchFn,
      timeoutMs
    );
    const main = pickMainPattern(data?.line?.journeyPatterns, { rail: line.mode === 'rail' || line.mode === 'flytog' });
    if (!main) return null;
    const value = { ...main, name: data?.line?.name ?? '', fetchedAt: new Date().toISOString() };
    return value;
  } catch (e) {
    console.warn(`[RuterLive] Stoppliste ${regionId}/${line.slug}:`, e.message);
    return null;
  }
}

/** Henter alle stopplister sekvensielt for å varme cachen. */
export async function prewarmLineStops() {
  for (const line of LINES.filter((l) => l.indexed)) {
    await getLineStops(line);
  }
  console.log('[RuterLive] Stopplister for linjesider forhåndshentet');
}
