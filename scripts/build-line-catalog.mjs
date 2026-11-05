/**
 * Genererer shared/lines/<region>.js fra Entur Journey Planner.
 * Bruk: node scripts/build-line-catalog.mjs --region bergen
 * Henter lines(authorities: …) for regionens authorities (pluss EXTRA_LINES, f.eks. Flybussen Bergen som
 * tilhører Norgesbuss), dropper bestillingslinjer («Skyss Bestilling») og linjer uten publicCode.
 * Skriver også ut linjer der publicCode ikke er teksten etter «:Line:» i id-en (ET-koden avledes fra LineRef).
 */

import { writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { jpQuery } from '../server/line-catalog.js';
import { MODE_ORDER } from '../shared/line-list.js';
import { findRegion } from '../shared/regions.js';

// Modusprefiks i slug og tittel. Oslo bruker lineSlug i shared/line-list.js (buss-31, trikk-13).
const SLUG_PREFIX = { metro: 't-bane', tram: 'trikk', rail: 'tog', flytog: 'flytoget', flybuss: 'flybuss', bus: 'buss', water: 'baat' };
const TITLE_PREFIX = { metro: 'T-bane linje', tram: 'Trikk linje', rail: 'Tog', flytog: 'Flytoget', flybuss: 'Flybuss', bus: 'Buss', water: 'Båt' };

const REGION_CONFIG = {
  bergen: {
    slugPrefix: { tram: 'bybanen' },
    titlePrefix: { tram: 'Bybanen linje' },
    // Linjer med fast trasé fra JP (Task 7, regel 4): bybanen og flybussen. Resten får rute ved valg.
    geometryModes: ['tram', 'flybuss'],
    // Flybussen Bergen (Norgesbuss, ikke Skyss): FB50 til sentrum, FB51 til Åsane
    extra: { publicCodes: ['FB50', 'FB51'], name: 'Flybussen', mode: 'flybuss' },
  },
};

const MODE_SORT = [...MODE_ORDER, 'water'];

const isOnDemand = (l) => /^skyss bestilling/i.test(String(l.name ?? '')) || /^skyss bestilling$/i.test(String(l.publicCode ?? '').trim());

/**
 * Slug som ikke finnes i `taken`. Ved kollisjon beholdes basen urørt og operatøren legges til
 * (buss-5-sky), så et siffersuffiks aldri kan se ut som en annen linje (buss-5 -> buss-2). Er den også
 * tatt, legges bokstavene b, c, ... til (buss-5-sky-b).
 */
export function uniqueSlug(base, taken, authority = '') {
  if (!taken.has(base)) return base;
  const withAuth = authority ? `${base}-${String(authority).toLowerCase()}` : `${base}-x`;
  if (!taken.has(withAuth)) return withAuth;
  for (let i = 0; ; i++) {
    const cand = `${withAuth}-${String.fromCharCode(98 + (i % 25))}${i >= 25 ? i : ''}`;
    if (!taken.has(cand)) return cand;
  }
}

/**
 * @param {string} regionId
 * @param {{ id: string, publicCode: string|null, name: string, transportMode: string }[]} jpLines
 * @returns {{ lines: object[], mismatches: { id: string, publicCode: string }[] }}
 */
export function buildRegionLines(regionId, jpLines) {
  const cfg = REGION_CONFIG[regionId] ?? {};
  const out = [];
  const mismatches = [];
  const slugs = new Set();
  for (const jl of jpLines) {
    const code = String(jl.publicCode ?? '').trim();
    if (!code || isOnDemand(jl)) continue;
    const isFly = cfg.extra?.publicCodes?.includes(code) && /flybussen/i.test(jl.name ?? '');
    const mode = isFly ? cfg.extra.mode : jl.transportMode;
    if (!SLUG_PREFIX[mode]) continue;
    const authority = String(jl.id).split(':')[0];
    const slug = uniqueSlug(`${cfg.slugPrefix?.[mode] ?? SLUG_PREFIX[mode]}-${code.toLowerCase().replace(/[^a-z0-9]+/g, '-')}`, slugs, authority);
    slugs.add(slug);
    const prefix = cfg.titlePrefix?.[mode] ?? TITLE_PREFIX[mode];
    const line = { slug, code, mode, authority, title: `${prefix} ${code}` };
    if (cfg.geometryModes?.includes(mode)) line.geometry = true;
    if (String(jl.id).split(':Line:')[1] !== code) {
      line.ref = jl.id;
      mismatches.push({ id: jl.id, publicCode: code });
    }
    out.push(line);
  }
  out.sort(
    (a, b) =>
      MODE_SORT.indexOf(a.mode) - MODE_SORT.indexOf(b.mode) ||
      a.code.localeCompare(b.code, 'nb', { numeric: true }) ||
      a.slug.localeCompare(b.slug),
  );
  return { lines: out, mismatches };
}

/** Modulteksten: én linje per rad (kompakt, men diff-vennlig). */
export function renderCatalogModule(lines, regionId) {
  const rows = lines.map((l) => `${JSON.stringify(l).replace(/,"/g, ',"').replace(/^\{"/, '{ "').replace(/\}$/, ' }')},`);
  return `// Generert av scripts/build-line-catalog.mjs --region ${regionId}. Ikke rediger for hånd.\nexport default [\n${rows.join('\n')}\n];\n`;
}

async function fetchJpLines(region, cfg) {
  const authorities = region.authorities.map((a) => `${a}:Authority:${a}`);
  const q = (args) => `{ lines(${args}) { id publicCode name transportMode } }`;
  const data = await jpQuery(q(`authorities: ${JSON.stringify(authorities)}`), fetch, 60000);
  const lines = [...(data?.lines ?? [])];
  if (cfg.extra) {
    const extra = await jpQuery(q(`name: ${JSON.stringify(cfg.extra.name)}`), fetch, 60000);
    lines.push(...(extra?.lines ?? []).filter((l) => cfg.extra.publicCodes.includes(l.publicCode)));
  }
  return lines;
}

async function main() {
  const i = process.argv.indexOf('--region');
  const regionId = i > 0 ? process.argv[i + 1] : null;
  const region = findRegion(regionId);
  if (!region || !REGION_CONFIG[regionId]) {
    console.error('Bruk: node scripts/build-line-catalog.mjs --region bergen');
    process.exit(1);
  }
  const jpLines = await fetchJpLines(region, REGION_CONFIG[regionId]);
  const { lines, mismatches } = buildRegionLines(regionId, jpLines);
  const perMode = {};
  for (const l of lines) perMode[l.mode] = (perMode[l.mode] ?? 0) + 1;
  const file = fileURLToPath(new URL(`../shared/lines/${regionId}.js`, import.meta.url));
  writeFileSync(file, renderCatalogModule(lines, regionId));
  console.log(`JP ga ${jpLines.length} linjer, ${lines.length} skrevet til ${file}`);
  console.log('Per modus:', JSON.stringify(perMode));
  console.log(`publicCode ≠ tekst etter «:Line:» i id (${mismatches.length}):`);
  for (const m of mismatches) console.log(`  ${m.id} → ${m.publicCode} (lagret som ref)`);
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  main().catch((e) => {
    console.error(e);
    process.exit(1);
  });
}
