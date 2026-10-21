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
 */
export function makeJsonEntry(value, prev = null, { gzipLevel = 6, brQuality = 5 } = {}) {
  const str = typeof value === 'string' ? value : JSON.stringify(value);
  const etag = `"${hashString(str, 16)}"`;
  if (prev && prev.etag === etag) return prev;
  const json = Buffer.from(str);
  if (json.length < COMPRESS_MIN_BYTES) return { json, gzip: null, br: null, etag };
  return {
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
