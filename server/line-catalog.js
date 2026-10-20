/**
 * Linjekatalog for innholdssidene (/linje/:slug) og stopplister fra Entur Journey Planner.
 * Introtekster ligger i content/line-intros.json (slug -> tekst).
 */

import { readFileSync } from 'node:fs';

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

const RAW_LINES = [
  ...['1', '2', '3', '4', '5'].map((n) => ({ slug: `t-bane-${n}`, code: n, authority: 'RUT', mode: 'metro', title: `T-bane linje ${n}` })),
  ...['12', '13', '15', '17', '18', '19'].map((n) => ({ slug: `trikk-${n}`, code: n, authority: 'RUT', mode: 'tram', title: `Trikk linje ${n}` })),
  { slug: 'tog-l1', code: 'L1', authority: 'VYG', mode: 'rail', title: 'Tog L1' },
  { slug: 'tog-l2', code: 'L2', aliases: ['L2x'], authority: 'VYG', mode: 'rail', title: 'Tog L2' },
  { slug: 'tog-r12', code: 'R12', authority: 'VYG', mode: 'rail', title: 'Tog R12' },
  { slug: 'tog-r13', code: 'R13', aliases: ['R13x'], authority: 'VYG', mode: 'rail', title: 'Tog R13' },
  { slug: 'tog-r14', code: 'R14', authority: 'VYG', mode: 'rail', title: 'Tog R14' },
  { slug: 'tog-r21', code: 'R21', authority: 'VYG', mode: 'rail', title: 'Tog R21' },
  { slug: 'tog-r22', code: 'R22', authority: 'VYG', mode: 'rail', title: 'Tog R22' },
  { slug: 'tog-r23', code: 'R23', aliases: ['R23x'], authority: 'VYG', mode: 'rail', title: 'Tog R23' },
  { slug: 'tog-re10', code: 'RE10', authority: 'VYG', mode: 'rail', title: 'Tog RE10' },
  { slug: 'tog-re11', code: 'RE11', aliases: ['RX11'], authority: 'VYG', mode: 'rail', title: 'Tog RE11' },
  { slug: 'tog-re20', code: 'RE20', aliases: ['RX20'], authority: 'VYG', mode: 'rail', title: 'Tog RE20' },
  { slug: 'tog-re30', code: 'RE30', authority: 'VYG', mode: 'rail', title: 'Tog RE30' },
  { slug: 'flytoget-fly1', code: 'FLY1', authority: 'FLT', mode: 'flytog', title: 'Flytoget FLY1' },
  { slug: 'flytoget-fly2', code: 'FLY2', authority: 'FLT', mode: 'flytog', title: 'Flytoget FLY2' },
  { slug: 'flybuss-fb1', code: 'FB1', authority: 'NBU', mode: 'flybuss', title: 'Flybuss FB1' },
  { slug: 'flybuss-fb3', code: 'FB3', authority: 'NBU', mode: 'flybuss', title: 'Flybuss FB3' },
  { slug: 'flybuss-fb5', code: 'FB5', authority: 'NBU', mode: 'flybuss', title: 'Flybuss FB5' },
];

export const LINES = RAW_LINES.map((l) => ({
  aliases: [],
  ...l,
  intro: intros[l.slug] ?? '',
}));

export function getLineBySlug(slug) {
  return LINES.find((l) => l.slug === slug);
}

/**
 * Velger hovedmønsteret: flest serviceJourneys * quays, ved likhet flest quays.
 * (Unngår korte pendelmønstre med mange avganger, f.eks. FLY2 med 2 stopp.)
 * @returns {{ stops: string[], from: string, to: string } | null}
 */
export function pickMainPattern(journeyPatterns) {
  if (!Array.isArray(journeyPatterns) || journeyPatterns.length === 0) return null;
  let best = null;
  let bestJ = -1;
  let bestQ = -1;
  for (const p of journeyPatterns) {
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

async function jpQuery(query, fetchFn) {
  const res = await fetchFn(JP_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'ET-Client-Name': 'ruterlive-web' },
    body: JSON.stringify({ query }),
    signal: AbortSignal.timeout(TIMEOUT_MS),
  });
  if (!res.ok) throw new Error(`JP ${res.status}`);
  const json = await res.json();
  if (json.errors?.length) throw new Error(json.errors[0].message);
  return json.data;
}

let idCache = null; // { at, ids: Map<"AUTH:CODE", jpId> }
const stopsCache = new Map(); // slug -> { at, value }

async function getLineIds(fetchFn) {
  if (idCache && Date.now() - idCache.at < CACHE_TTL_MS) return idCache.ids;
  const codes = [...new Set(LINES.map((l) => l.code))];
  const data = await jpQuery(
    `{ lines(publicCodes: ${JSON.stringify(codes)}) { id publicCode } }`,
    fetchFn
  );
  const ids = new Map();
  for (const l of data?.lines ?? []) {
    const authority = String(l.id).split(':')[0];
    ids.set(`${authority}:${String(l.publicCode).toUpperCase()}`, l.id);
  }
  idCache = { at: Date.now(), ids };
  return ids;
}

/**
 * Henter stoppliste for en linje fra Entur JP (cache 24 t). Gir null ved feil.
 * @returns {Promise<{ stops: string[], from: string, to: string, name: string, fetchedAt: string } | null>}
 */
export async function getLineStops(line, fetchFn = fetch) {
  const cached = stopsCache.get(line.slug);
  if (cached && Date.now() - cached.at < CACHE_TTL_MS) return cached.value;
  try {
    const ids = await getLineIds(fetchFn);
    const jpId = ids.get(`${line.authority}:${line.code.toUpperCase()}`);
    if (!jpId) return null;
    const data = await jpQuery(
      `{ line(id: ${JSON.stringify(jpId)}) { name journeyPatterns { quays { name } serviceJourneys { id } } } }`,
      fetchFn
    );
    const main = pickMainPattern(data?.line?.journeyPatterns);
    if (!main) return null;
    const value = { ...main, name: data?.line?.name ?? '', fetchedAt: new Date().toISOString() };
    stopsCache.set(line.slug, { at: Date.now(), value });
    return value;
  } catch (e) {
    console.warn(`[RuterLive] Stoppliste ${line.slug}:`, e.message);
    return null;
  }
}

/** Henter alle stopplister sekvensielt for å varme cachen. */
export async function prewarmLineStops() {
  for (const line of LINES) {
    await getLineStops(line);
  }
  console.log('[RuterLive] Stopplister for linjesider forhåndshentet');
}
