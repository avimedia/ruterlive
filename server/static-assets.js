/**
 * Statiske filer: forhåndskomprimerte .br/.gz, cache-headere og komprimering av
 * server-rendret HTML/XML. Ingen filer holdes i minnet; de streames fra disk.
 */

import fs from 'node:fs';
import path from 'node:path';
import zlib from 'node:zlib';
import { accepts } from './json-cache.js';

export const COMPRESSIBLE_EXT = new Set(['.js', '.css', '.html', '.svg', '.json', '.xml', '.txt']);

/** Velger kodingen klienten godtar: 'br', 'gzip' eller null. Bare kodinger i `available` kan velges. */
export function pickEncoding(acceptEncoding, available = ['br', 'gzip']) {
  if (available.includes('br') && accepts(acceptEncoding, 'br')) return 'br';
  if (available.includes('gzip') && accepts(acceptEncoding, 'gzip')) return 'gzip';
  return null;
}

/** Cache-Control for en statisk fil, ut fra URL-sti. null = la express.static bestemme. */
export function cacheControlFor(urlPath) {
  if (urlPath.startsWith('/assets/')) return 'public, max-age=31536000, immutable';
  if (urlPath === '/sw.js') return 'no-cache';
  if (urlPath.endsWith('.html') || urlPath === '/') return 'no-cache';
  if (/^\/(favicon\.svg|favicon-32\.png|apple-touch-icon\.png|icon-(192|512|maskable-512)\.png|manifest\.json|content\.css)$/.test(urlPath)) return 'public, max-age=86400';
  return null;
}

const ENC_EXT = { br: '.br', gzip: '.gz' };

/** Middleware: serverer fil.br / fil.gz fra dist/ når klienten godtar det. */
export function precompressedStatic(root) {
  const rootResolved = path.resolve(root);
  return async (req, res, next) => {
    if (req.method !== 'GET' && req.method !== 'HEAD') return next();
    let urlPath;
    try {
      urlPath = decodeURIComponent(req.path);
    } catch {
      return next();
    }
    if (urlPath.endsWith('/')) urlPath += 'index.html';
    const ext = path.extname(urlPath).toLowerCase();
    if (!COMPRESSIBLE_EXT.has(ext)) return next();
    const file = path.join(rootResolved, urlPath);
    if (!file.startsWith(rootResolved + path.sep)) return next();
    const enc = pickEncoding(req.headers['accept-encoding']);
    if (!enc) return next();
    // Prøv foretrukket koding, deretter den andre
    const order = enc === 'br' && accepts(req.headers['accept-encoding'], 'gzip') ? ['br', 'gzip'] : [enc];
    for (const e of order) {
      const comp = file + ENC_EXT[e];
      let st;
      try {
        st = await fs.promises.stat(comp);
      } catch {
        continue;
      }
      if (!st.isFile()) continue;
      const orig = await fs.promises.stat(file).catch(() => null);
      const mtime = new Date(Math.max(st.mtimeMs, orig ? orig.mtimeMs : 0));
      const etag = `W/"${st.size.toString(16)}-${Math.floor(st.mtimeMs).toString(16)}-${e}"`;
      res.set('Vary', 'Accept-Encoding');
      res.set('ETag', etag);
      res.set('Last-Modified', mtime.toUTCString());
      const cc = cacheControlFor(urlPath);
      if (cc) res.set('Cache-Control', cc);
      if (req.headers['if-none-match'] === etag) return res.status(304).end();
      res.type(ext);
      res.set('Content-Encoding', e);
      res.set('Content-Length', String(st.size));
      if (req.method === 'HEAD') return res.end();
      const stream = fs.createReadStream(comp);
      stream.on('error', () => res.destroy());
      return stream.pipe(res);
    }
    return next();
  };
}

/** setHeaders-funksjon for express.static. */
export function setStaticHeaders(res, filePath, root) {
  const rel = '/' + path.relative(root, filePath).split(path.sep).join('/');
  const cc = cacheControlFor(rel);
  if (cc) res.setHeader('Cache-Control', cc);
  if (COMPRESSIBLE_EXT.has(path.extname(filePath).toLowerCase())) res.setHeader('Vary', 'Accept-Encoding');
}

const COMPRESS_MIN = 1024;

/** Middleware: komprimerer res.send for HTML, XML og JSON (res.json, Entur-proxyene). */
export function compressTextResponses() {
  return (req, res, next) => {
    const send = res.send.bind(res);
    res.send = (body) => {
      const type = String(res.get('Content-Type') || '');
      const ok =
        (typeof body === 'string' || Buffer.isBuffer(body)) &&
        /^(text\/html|application\/xml|application\/json)/i.test(type) &&
        !res.get('Content-Encoding') &&
        res.statusCode !== 204 &&
        res.statusCode !== 304;
      const enc = ok ? pickEncoding(req.headers['accept-encoding']) : null;
      if (ok) res.vary('Accept-Encoding');
      if (!enc) return send(body);
      const buf = Buffer.isBuffer(body) ? body : Buffer.from(body, 'utf8');
      if (buf.length < COMPRESS_MIN) return send(body);
      const out =
        enc === 'br'
          ? zlib.brotliCompressSync(buf, {
              params: { [zlib.constants.BROTLI_PARAM_QUALITY]: 5, [zlib.constants.BROTLI_PARAM_SIZE_HINT]: buf.length },
            })
          : zlib.gzipSync(buf, { level: 6 });
      res.set('Content-Encoding', enc);
      return send(out);
    };
    next();
  };
}
