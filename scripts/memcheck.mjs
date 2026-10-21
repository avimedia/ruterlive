// Minnemåling: starter serveren, sampler RSS og sender forespørsler.
// Bruk: npm run memcheck -- [--max-mb 350] [--duration 90] [--port 3917]
import { spawn, execFileSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const rot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

function arg(navn, standard) {
  const i = process.argv.indexOf(`--${navn}`);
  return i > -1 && process.argv[i + 1] ? Number(process.argv[i + 1]) : standard;
}

const MAX_MB = arg('max-mb', 350);
const VARIGHET_S = arg('duration', 90);
const PORT = arg('port', 3917);
const SAMPLE_MS = 2000;
const FORESPORSEL_MS = 5000;
const STIER = [
  '/api/initial-data',
  '/',
  '/linje/t-bane-1',
  '/guider',
  '/api/vehicles-live',
  '/api/route-shapes-all',
];

if (!existsSync(path.join(rot, 'dist', 'index.html'))) {
  console.error('Fant ikke dist/. Kjør `npm run build` først.');
  process.exit(2);
}

// Starter node direkte (ikke via npm/shell) slik at pid er selve node-prosessen.
const server = spawn(process.execPath, ['--max-old-space-size=384', 'server.js'], {
  cwd: rot,
  env: { ...process.env, PORT: String(PORT) },
  stdio: 'ignore',
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

console.log(`Måler RSS i ${VARIGHET_S} s (port ${PORT}, grense ${MAX_MB} MB)`);
send();
const reqTimer = setInterval(send, FORESPORSEL_MS);

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
const krasjet = serverDod;
server.kill('SIGTERM');
setTimeout(() => server.kill('SIGKILL'), 3000).unref();

console.log(`\nTopp RSS: ${topp.toFixed(0)} MB (grense ${MAX_MB} MB)`);
if (krasjet) console.error('Serveren avsluttet før tiden var ute.');
process.exit(krasjet || topp >= MAX_MB ? 1 : 0);
