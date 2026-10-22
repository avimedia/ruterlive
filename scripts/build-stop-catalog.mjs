// Bygger server/stop-catalog.json (holdeplassider). Kjøres manuelt ved behov:
//   node scripts/build-stop-catalog.mjs
// Henter alle T-banestasjoner og sentrale trikkestopp fra linjenes journey patterns i Entur JP,
// pluss en kort liste knutepunkter for tog og buss (oppslag i Entur Geocoder).
// Rundt 25 kall mot Entur totalt, med pause mellom hvert.
import { writeFileSync } from 'node:fs';
import { STOPS, slugify, stripStopSuffix } from '../server/stop-catalog.js';
import { jpQuery } from '../server/line-catalog.js';

const HEADERS = { 'ET-Client-Name': 'ruterlive-web' };

// Behold «featured» fra eksisterende katalog (håndplukkede knutepunkter med egen tekst).
const FEATURED_IDS = new Set(STOPS.filter((s) => s.featured).map((s) => s.id));
const pause = (ms) => new Promise((r) => setTimeout(r, ms));
const jp = async (query, variables) => {
  await pause(400);
  return jpQuery(query, fetch, 30000, variables);
};

// Knutepunkter for tog/buss/båt som ikke kommer med via T-bane/trikk. Navn som i Entur.
const HUBS = [
  'Oslo S', 'Nationaltheatret', 'Skøyen', 'Lysaker', 'Sandvika stasjon', 'Asker stasjon', 'Lillestrøm stasjon',
  'Oslo lufthavn stasjon', 'Ski stasjon', 'Drammen stasjon', 'Bryn stasjon', 'Kolbotn stasjon', 'Strømmen stasjon',
  'Jessheim stasjon', 'Oslo bussterminal', 'Aker brygge', 'Nesoddtangen', 'Lørenskog sentrum',
];

const MODE_ORDER = ['metro', 'tram', 'rail', 'bus', 'water'];
const MODE_MAP = { metro: 'metro', tram: 'tram', rail: 'rail', bus: 'bus', coach: 'bus', water: 'water' };

async function lineIds() {
  const codes = ['1', '2', '3', '4', '5', '11', '12', '13', '15', '17', '18', '19'];
  const data = await jp('query($codes:[String]){ lines(publicCodes:$codes) { id publicCode transportMode } }', { codes });
  return (data?.lines ?? []).filter((l) => String(l.id).startsWith('RUT:')).filter((l) => l.transportMode === 'metro' || l.transportMode === 'tram');
}

async function patternStops(line) {
  const data = await jp(
    `query($id:ID!){ line(id:$id){ journeyPatterns { quays { stopPlace { id name parent { id } } } } } }`,
    { id: line.id }
  );
  return (data?.line?.journeyPatterns ?? []).map((p) => (p.quays ?? []).map((q) => q.stopPlace).filter(Boolean));
}

async function geocode(name) {
  await pause(400);
  const url = `https://api.entur.io/geocoder/v1/autocomplete?text=${encodeURIComponent(name)}&layers=venue&size=3&focus.point.lat=59.91&focus.point.lon=10.75`;
  const res = await fetch(url, { headers: HEADERS, signal: AbortSignal.timeout(15000) });
  const json = await res.json();
  const f = (json.features ?? []).find((x) => String(x.properties?.id).startsWith('NSR:StopPlace:'));
  if (!f) console.warn(`Fant ikke ${name}`);
  return f ? f.properties.id : null;
}

async function details(ids) {
  const out = [];
  for (let i = 0; i < ids.length; i += 40) {
    const chunk = ids.slice(i, i + 40);
    const data = await jp(
      'query($ids:[String]!){ stopPlaces(ids:$ids){ id name latitude longitude parent { id } quays { lines { transportMode } } } }',
      { ids: chunk }
    );
    out.push(...(data?.stopPlaces ?? []).filter(Boolean));
  }
  return out;
}

const top = (sp) => sp.parent?.id ?? sp.id;
const ids = new Set();

const lines = await lineIds();
const tramCount = new Map(); // id -> Set(linjekode)
const tramEnds = new Set();
for (const line of lines) {
  const patterns = await patternStops(line);
  for (const stops of patterns) {
    if (line.transportMode === 'metro') stops.forEach((s) => ids.add(top(s)));
    else {
      stops.forEach((s) => {
        if (!tramCount.has(top(s))) tramCount.set(top(s), new Set());
        tramCount.get(top(s)).add(line.publicCode);
      });
      if (stops.length) { tramEnds.add(top(stops[0])); tramEnds.add(top(stops[stops.length - 1])); }
    }
  }
}
// Trikk: stopp med minst tre linjer (sentrum) og endeholdeplasser.
for (const [id, set] of tramCount) if (set.size >= 3) ids.add(id);
for (const id of tramEnds) ids.add(id);

for (const name of HUBS) {
  const id = await geocode(name);
  if (id) ids.add(id);
}

// Slå opp, løft til multimodal forelder der den finnes, og slå opp på nytt.
let info = await details([...ids]);
const parents = new Set(info.map(top));
info = await details([...parents]);

const used = new Set();
const catalog = info
  .map((sp) => {
    const modes = new Set();
    for (const q of sp.quays ?? []) for (const l of q.lines ?? []) if (MODE_MAP[l.transportMode]) modes.add(MODE_MAP[l.transportMode]);
    return { id: sp.id, name: sp.name, lat: +sp.latitude.toFixed(5), lon: +sp.longitude.toFixed(5), modes: MODE_ORDER.filter((m) => modes.has(m)) };
  })
  .filter((s) => s.modes.length > 0)
  .sort((a, b) => a.name.localeCompare(b.name, 'nb'))
  .map((s) => {
    const base = slugify(stripStopSuffix(s.name));
    let slug = base;
    for (let n = 2; used.has(slug); n++) slug = `${base}-${n}`;
    used.add(slug);
    return FEATURED_IDS.has(s.id) ? { slug, ...s, featured: true } : { slug, ...s };
  });

writeFileSync(new URL('../server/stop-catalog.json', import.meta.url), `[\n${catalog.map((s) => `  ${JSON.stringify(s)}`).join(',\n')}\n]\n`);
console.log(`${catalog.length} holdeplasser skrevet`);
