/**
 * Skriver .br (kvalitet 11) og .gz (nivå 9) ved siden av komprimerbare filer i dist/.
 * Kjøres etter `vite build`.
 */
import fs from 'node:fs';
import path from 'node:path';
import zlib from 'node:zlib';
import { fileURLToPath } from 'node:url';

const EXT = new Set(['.js', '.css', '.html', '.svg', '.json', '.xml', '.txt']);
const MIN_BYTES = 1024;
const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'dist');

function* walk(dir) {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) yield* walk(p);
    else yield p;
  }
}

let n = 0;
let before = 0;
let after = 0;
for (const file of walk(root)) {
  if (!EXT.has(path.extname(file).toLowerCase())) continue;
  const buf = fs.readFileSync(file);
  if (buf.length < MIN_BYTES) continue;
  const br = zlib.brotliCompressSync(buf, {
    params: { [zlib.constants.BROTLI_PARAM_QUALITY]: 11, [zlib.constants.BROTLI_PARAM_SIZE_HINT]: buf.length },
  });
  fs.writeFileSync(file + '.br', br);
  fs.writeFileSync(file + '.gz', zlib.gzipSync(buf, { level: 9 }));
  n++;
  before += buf.length;
  after += br.length;
}
console.log(`[precompress] ${n} filer, ${before} -> ${after} byte (br)`);
