// Minnemåling: starter serveren, sampler RSS og sender forespørsler.
// Bruk: npm run memcheck -- [--max-mb 350] [--seconds 200] [--port 3917] [--regions oslo,bergen] [--log fil]
// 200 s dekker minst to ET-oppdateringer (hvert 90. s). --duration er alias for --seconds.
// --regions: andre regioner enn Oslo slås på med REGIONS_PREVIEW, og /api/vehicles-live og
// /api/route-shapes-all hentes for hver region hvert 10. s. --log: serverens utskrift til fil.
import { spawn, execFileSync } from 'node:child_process';
import { existsSync, readFileSync, openSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const rot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

function arg(navn, standard) {
  const i = process.argv.indexOf(`--${navn}`);
  return i > -1 && process.argv[i + 1] ? Number(process.argv[i + 1]) : standard;
}

function strArg(navn, standard) {
  const i = process.argv.indexOf(`--${navn}`);
  return i > -1 && process.argv[i + 1] ? process.argv[i + 1] : standard;
}

const MAX_MB = arg('max-mb', 350);
const VARIGHET_S = arg('seconds', arg('duration', 200));
const PORT = arg('port', 3917);
const SAMPLE_MS = 2000;
const FORESPORSEL_MS = 5000;
const REGION_MS = 10000;
const REGIONER = strArg('regions', 'oslo').split(',').map((r) => r.trim().toLowerCase()).filter(Boolean);
const ANDRE = REGIONER.filter((r) => r !== 'oslo');
const LOGG = strArg('log', null);
const STIER = [
  '/api/initial-data',
  '/',
  '/linje/t-bane-1',
  '/guider',
  '/holdeplasser',
  '/holdeplass/majorstuen',
  '/holdeplass/oslo-s',
  '/api/vehicles-live',
  '/api/route-shapes-all',
  '/api/static-network-shapes',
  '/api/rail-shapes',
  '/api/route-shapes',
  '/api/vehicle-route?line=30&mode=bus&dest=Nydalen&ref=RUT%3ALine%3A30',
  '/api/vehicle-route?line=20&mode=bus&dest=Galgeberg',
  '/api/stops-search?q=bjerke&lat=59.91&lng=10.75',
  '/api/departures?quayId=NSR:Quay:11015,NSR:Quay:10988,NSR:Quay:10985,NSR:Quay:11020',
];

if (!existsSync(path.join(rot, 'dist', 'index.html'))) {
  console.error('Fant ikke dist/. Kjør `npm run build` først.');
  process.exit(2);
}

// Starter node direkte (ikke via npm/shell) slik at pid er selve node-prosessen.
// Samme node-flagg som `npm run start` (f.eks. --max-old-space-size), så målingen speiler produksjon.
const startScript = JSON.parse(readFileSync(path.join(rot, 'package.json'), 'utf8')).scripts.start;
const nodeFlagg = startScript.split(/\s+/).filter((t) => t.startsWith('--'));
const env = { ENTUR_CLIENT_NAME: 'ruterlive-dev', ...process.env, PORT: String(PORT) };
if (ANDRE.length) env.REGIONS_PREVIEW = ANDRE.join(',');
const ut = LOGG ? openSync(LOGG, 'w') : 'ignore';
const server = spawn(process.execPath, [...nodeFlagg, 'server.js'], {
  cwd: rot,
  env,
  stdio: ['ignore', ut, ut],
});
let serverDod = false;
server.on('exit', () => { serverDod = true; });

function rssMb() {
  try {
    const ut = execFileSync('ps', ['-o', 'rss=', '-p', String(server.pid)], { encoding: 'utf8' });
    return Number(ut.trim()) / 1024;
  } catch {
    return null;
  }
}

function send() {
  for (const sti of STIER) {
    fetch(`http://localhost:${PORT}${sti}`, { signal: AbortSignal.timeout(30000) })
      .then((r) => r.arrayBuffer())
      .catch(() => {}); // 404/feil ignoreres, vi måler bare minne
  }
}

const start = Date.now();
const serie = [];
let topp = 0;
const sek = () => Math.round((Date.now() - start) / 1000);

// Per region: første svar, første ET-kjøretøy (har path) og første trikk
const status = Object.fromEntries(REGIONER.map((id) => [id, {
  forsteSvar: null, forsteEt: null, forsteTrikk: null, siste: null, feil: 0,
}]));
let toppHeap = 0;

async function hentJson(sti) {
  const r = await fetch(`http://localhost:${PORT}${sti}`, { signal: AbortSignal.timeout(30000) });
  if (!r.ok) throw new Error(`${sti}: ${r.status}`);
  return r.json();
}

function pollRegioner() {
  for (const id of REGIONER) {
    const q = id === 'oslo' ? '' : `region=${encodeURIComponent(id)}`;
    const st = status[id];
    hentJson(`/api/vehicles-live${q ? `?${q}` : ''}`)
      .then(async (live) => {
        const s = sek();
        st.forsteSvar ??= s;
        const v = live.vehicles ?? [];
        const et = v.filter((x) => Array.isArray(x.path)).length;
        const trikk = v.filter((x) => x.mode === 'tram').length;
        if (et > 0) st.forsteEt ??= s;
        if (trikk > 0) st.forsteTrikk ??= s;
        st.siste = { s, totalt: v.length, et, gps: v.length - et, trikk };
        const v2 = live.shapesVersion ? `v=${live.shapesVersion}` : '';
        const shapes = await hentJson(`/api/route-shapes-all?${[q, v2].filter(Boolean).join('&')}`);
        st.siste.rutekart = Array.isArray(shapes) ? shapes.length : null;
      })
      .catch(() => { st.feil++; });
  }
  hentJson('/health/details')
    .then((h) => { toppHeap = Math.max(toppHeap, h.heapUsedMb ?? 0); })
    .catch(() => {});
}

console.log(`Måler RSS i ${VARIGHET_S} s (port ${PORT}, grense ${MAX_MB} MB, flagg ${nodeFlagg.join(' ')}, regioner ${REGIONER.join(',')})`);
send();
const reqTimer = setInterval(send, FORESPORSEL_MS);
const regionTimer = setInterval(pollRegioner, REGION_MS);
pollRegioner();

await new Promise((resolve) => {
  const t = setInterval(() => {
    const s = Math.round((Date.now() - start) / 1000);
    const mb = rssMb();
    if (mb !== null) {
      serie.push([s, mb]);
      topp = Math.max(topp, mb);
      console.log(`${String(s).padStart(3)} s  ${mb.toFixed(0)} MB`);
    }
    if (serverDod || s >= VARIGHET_S) {
      clearInterval(t);
      resolve();
    }
  }, SAMPLE_MS);
});

clearInterval(reqTimer);
clearInterval(regionTimer);
const detaljer = await hentJson('/health/details').catch(() => null);
const krasjet = serverDod;
server.kill('SIGTERM');
setTimeout(() => server.kill('SIGKILL'), 3000).unref();

// Stabil = median etter oppvarming (første minutt utelatt)
const etter = serie.filter(([s]) => s >= 60).map(([, mb]) => mb).sort((a, b) => a - b);
const stabil = etter.length ? etter[Math.floor(etter.length / 2)] : null;
console.log(`\nTopp RSS: ${topp.toFixed(0)} MB (grense ${MAX_MB} MB)`);
if (stabil !== null) console.log(`Stabil RSS (median etter 60 s): ${stabil.toFixed(0)} MB`);
if (detaljer) console.log(`Ved slutt: rss ${detaljer.rssMb} MB, heapUsed ${detaljer.heapUsedMb} MB (topp heapUsed ${toppHeap} MB)`);
for (const id of REGIONER) {
  const st = status[id];
  const tilEt = st.forsteSvar !== null && st.forsteEt !== null ? `${st.forsteEt - st.forsteSvar} s etter første svar` : 'aldri';
  console.log(`${id}: første svar ${st.forsteSvar ?? '-'} s, første ET-kjøretøy ${st.forsteEt ?? '-'} s (${tilEt}), `
    + `første trikk ${st.forsteTrikk ?? '-'} s, feil ${st.feil}, siste ${JSON.stringify(st.siste)}`);
}
if (krasjet) console.error('Serveren avsluttet før tiden var ute.');
process.exit(krasjet || topp >= MAX_MB ? 1 : 0);
