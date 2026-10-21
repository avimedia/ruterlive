/**
 * Forhåndskomprimert JSON: komprimeres én gang per cache-oppdatering, ikke per forespørsel.
 * Én entry per payload holder json + gzip + br + etag.
 */
import zlib from 'node:zlib';
import crypto from 'node:crypto';

export function hashString(str, len = 12) {
  return crypto.createHash('sha1').update(str).digest('hex').slice(0, len);
}

/** Lager entry fra et objekt (eller ferdig JSON-streng). Små payloads komprimeres ikke. */
export function makeJsonEntry(value) {
  const str = typeof value === 'string' ? value : JSON.stringify(value);
  const json = Buffer.from(str);
  const etag = `"${hashString(str, 16)}"`;
  const compress = json.length >= 1024;
  return {
    json,
    gzip: compress ? zlib.gzipSync(json, { level: 6 }) : null,
    br: compress
      ? zlib.brotliCompressSync(json, {
          params: {
            [zlib.constants.BROTLI_PARAM_QUALITY]: 5,
            [zlib.constants.BROTLI_PARAM_SIZE_HINT]: json.length,
          },
        })
      : null,
    etag,
  };
}

function accepts(header, enc) {
  return new RegExp(`(^|[\\s,])${enc}\\s*(;|,|$)`, 'i').test(header || '');
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
  let body = entry.json;
  if (entry.br && accepts(ae, 'br')) {
    res.set('Content-Encoding', 'br');
    body = entry.br;
  } else if (entry.gzip && accepts(ae, 'gzip')) {
    res.set('Content-Encoding', 'gzip');
    body = entry.gzip;
  }
  res.set('Content-Length', String(body.length));
  return res.end(body);
}
