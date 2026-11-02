/**
 * Forhåndskomprimert JSON: komprimeres én gang per cache-oppdatering, ikke per forespørsel.
 * Én entry per payload holder gzip + br + etag. Store payloads beholder ikke rå JSON i minnet;
 * klienter uten gzip/br (sjeldne) får den dekomprimert ved forespørsel.
 */
import zlib from 'node:zlib';
import crypto from 'node:crypto';

const COMPRESS_MIN_BYTES = 1024;

export function hashString(str, len = 12) {
  return crypto.createHash('sha1').update(str).digest('hex').slice(0, len);
}

/**
 * Lager entry fra et objekt (eller ferdig JSON-streng). Små payloads komprimeres ikke.
 * Med `prev`: gir `prev` tilbake uendret når innholdet er det samme (ingen ny komprimering).
 * Små, ofte hentede svar kan bruke høyere komprimering (brQuality 9 ≈ 10 ms for 350 kB).
 * `brUpgrade`: komprimer i tillegg på nytt med denne kvaliteten i bakgrunnen (libuv-tråd, blokkerer
 * ikke forespørsler) og bytt ut br når den er ferdig. Kvalitet 10 gir ~13 % mindre enn 9 (~140 ms
 * for 600 kB); verdt det for svar som hentes av mange og caches i Cloudflare. 11 gir lite mer og tar 4× så lang tid.
 */
export function makeJsonEntry(value, prev = null, { gzipLevel = 6, brQuality = 5, brUpgrade = 0 } = {}) {
  const str = typeof value === 'string' ? value : JSON.stringify(value);
  const etag = `"${hashString(str, 16)}"`;
  if (prev && prev.etag === etag) return prev;
  const json = Buffer.from(str);
  if (json.length < COMPRESS_MIN_BYTES) return { json, gzip: null, br: null, etag };
  const entry = {
    json: null,
    gzip: zlib.gzipSync(json, { level: gzipLevel }),
    br: zlib.brotliCompressSync(json, {
      params: {
        [zlib.constants.BROTLI_PARAM_QUALITY]: brQuality,
        [zlib.constants.BROTLI_PARAM_SIZE_HINT]: json.length,
      },
    }),
    etag,
  };
  if (brUpgrade > brQuality) upgradeBr(entry, json, brUpgrade);
  return entry;
}

// Én bakgrunnskomprimering om gangen: hver bruker 15–20 MB arbeidsminne (Render har 512 MB).
// Er én i gang, hoppes oppgraderingen over; neste oppdatering av cachen får den.
let upgrading = false;

// Ikke de første minuttene: da lastes GTFS og alt bygges samtidig (minnetoppen)
const UPGRADE_AFTER_UPTIME_S = 120;

function upgradeBr(entry, json, quality) {
  if (upgrading || process.uptime() < UPGRADE_AFTER_UPTIME_S) return;
  upgrading = true;
  zlib.brotliCompress(json, {
    params: {
      [zlib.constants.BROTLI_PARAM_QUALITY]: quality,
      [zlib.constants.BROTLI_PARAM_SIZE_HINT]: json.length,
    },
  }, (err, br) => {
    upgrading = false;
    if (!err && br.length < entry.br.length) entry.br = br;
  });
}

/**
 * Memoiserer en entry-bygger på identiteten (===) til argumentene: bygger bare på nytt
 * når en av kildecachene er byttet ut.
 */
export function memoEntry(build) {
  let keys = null;
  let entry = null;
  return (...args) => {
    if (!keys || args.length !== keys.length || args.some((a, i) => a !== keys[i])) {
      entry = build(...args);
      keys = args;
    }
    return entry;
  };
}

/** Sann når Accept-Encoding godtar `enc` (q > 0). */
export function accepts(header, enc) {
  for (const part of String(header || '').split(',')) {
    const [name, ...params] = part.trim().split(';').map((x) => x.trim());
    if (name.toLowerCase() !== enc) continue;
    const q = params.find((p) => /^q=/i.test(p));
    return !q || Number(q.slice(2)) > 0;
  }
  return false;
}

/** Sender entry med riktig Content-Encoding, Vary, ETag og 304 ved If-None-Match. */
export function sendJson(req, res, entry, { cacheControl = 'public, max-age=15' } = {}) {
  res.set('Cache-Control', cacheControl);
  res.set('Vary', 'Accept-Encoding');
  res.set('ETag', entry.etag);
  res.type('application/json');
  const inm = req.headers['if-none-match'];
  if (inm && inm.split(',').some((t) => t.trim() === entry.etag)) {
    return res.status(304).end();
  }
  const ae = req.headers['accept-encoding'];
  let body;
  if (entry.br && accepts(ae, 'br')) {
    res.set('Content-Encoding', 'br');
    body = entry.br;
  } else if (entry.gzip && accepts(ae, 'gzip')) {
    res.set('Content-Encoding', 'gzip');
    body = entry.gzip;
  } else {
    body = entry.json ?? zlib.gunzipSync(entry.gzip);
  }
  res.set('Content-Length', String(body.length));
  return res.end(body);
}
