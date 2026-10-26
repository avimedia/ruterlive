/**
 * Leser én fil fra en zip over HTTP med Range-forespørsler, uten å laste ned hele zip-en.
 * Brukes for GTFS (~95 MB) der vi bare trenger stops.txt.
 * Støtter metode 0 (lagret) og 8 (deflate). ZIP64 støttes ikke – da kastes det, så kalleren
 * kan falle tilbake til full nedlasting.
 */

import zlib from 'node:zlib';
import { CLIENT_NAME } from './entur-client.js';

const TAIL_BYTES = 65536 + 22; // EOCD + maks kommentarlengde
const LOCAL_HEADER_MARGIN = 1024; // plass til navn/extra i lokal header i samme forespørsel
const RANGE_TIMEOUT_MS = 60000;

const SIG_EOCD = 0x06054b50;
const SIG_EOCD64_LOCATOR = 0x07064b50;
const SIG_CENTRAL = 0x02014b50;
const SIG_LOCAL = 0x04034b50;

/**
 * @param {string} url
 * @param {string} range f.eks. "bytes=-65558" eller "bytes=0-99"
 * @param {Function} fetchFn (url, options, config) => Promise<Response>
 * @returns {Promise<{ buf: Buffer, start: number, total: number }>}
 */
async function fetchRange(url, range, fetchFn) {
  const res = await fetchFn(
    url,
    { method: 'GET', headers: { Range: range, 'ET-Client-Name': CLIENT_NAME } },
    { timeout: RANGE_TIMEOUT_MS, retries: 2 }
  );
  if (res.status !== 206) {
    // Ikke les kroppen – ved 200 er det hele filen.
    try { await res.body?.cancel?.(); } catch { /* ignorer */ }
    throw new Error(`Range ikke støttet (HTTP ${res.status})`);
  }
  const m = /bytes (\d+)-(\d+)\/(\d+)/.exec(res.headers.get('content-range') || '');
  if (!m) {
    try { await res.body?.cancel?.(); } catch { /* ignorer */ }
    throw new Error('Range: mangler Content-Range');
  }
  const buf = Buffer.from(await res.arrayBuffer());
  const start = Number(m[1]);
  if (buf.length !== Number(m[2]) - start + 1) throw new Error('Range: feil lengde på svar');
  return { buf, start, total: Number(m[3]) };
}

/** Finner End Of Central Directory bakfra i halen. */
function findEocd(tail) {
  for (let i = tail.length - 22; i >= 0; i--) {
    if (tail.readUInt32LE(i) === SIG_EOCD) return i;
  }
  return -1;
}

const CRC_TABLE = (() => {
  const t = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c >>> 0;
  }
  return t;
})();

function crc32(buf) {
  if (typeof zlib.crc32 === 'function') return zlib.crc32(buf) >>> 0;
  let c = 0xffffffff;
  for (let i = 0; i < buf.length; i++) c = CRC_TABLE[(c ^ buf[i]) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

/**
 * Leser en fil fra zip på `url` via HTTP Range.
 * Kaster hvis serveren ikke støtter Range, zip-en er ZIP64, filen mangler eller data er ødelagt.
 * @param {string} url
 * @param {string} name filnavn i zip-en, f.eks. "stops.txt"
 * @param {Function} fetchFn (url, options, config) => Promise<Response>
 * @returns {Promise<Buffer>}
 */
export async function readZipEntry(url, name, fetchFn) {
  // 1) Hale med EOCD
  const tail = await fetchRange(url, `bytes=-${TAIL_BYTES}`, fetchFn);
  const eocd = findEocd(tail.buf);
  if (eocd < 0) throw new Error('zip: fant ikke EOCD');
  if (eocd >= 20 && tail.buf.readUInt32LE(eocd - 20) === SIG_EOCD64_LOCATOR) {
    throw new Error('zip: ZIP64 støttes ikke');
  }
  const count = tail.buf.readUInt16LE(eocd + 10);
  const cdSize = tail.buf.readUInt32LE(eocd + 12);
  const cdOffset = tail.buf.readUInt32LE(eocd + 16);
  if (count === 0xffff || cdSize === 0xffffffff || cdOffset === 0xffffffff) {
    throw new Error('zip: ZIP64 støttes ikke');
  }
  if (cdOffset + cdSize > tail.total) throw new Error('zip: ugyldig sentralkatalog');

  // 2) Sentralkatalog (ligger som regel allerede i halen)
  let cd;
  const cdRel = cdOffset - tail.start;
  if (cdRel >= 0 && cdRel + cdSize <= tail.buf.length) {
    cd = tail.buf.subarray(cdRel, cdRel + cdSize);
  } else {
    cd = (await fetchRange(url, `bytes=${cdOffset}-${cdOffset + cdSize - 1}`, fetchFn)).buf;
  }

  let entry = null;
  let p = 0;
  for (let i = 0; i < count; i++) {
    if (p + 46 > cd.length || cd.readUInt32LE(p) !== SIG_CENTRAL) throw new Error('zip: ugyldig sentralkatalog');
    const nameLen = cd.readUInt16LE(p + 28);
    const extraLen = cd.readUInt16LE(p + 30);
    const commentLen = cd.readUInt16LE(p + 32);
    const entryName = cd.toString('utf8', p + 46, p + 46 + nameLen);
    if (entryName === name) {
      entry = {
        flags: cd.readUInt16LE(p + 8),
        method: cd.readUInt16LE(p + 10),
        crc: cd.readUInt32LE(p + 16),
        compSize: cd.readUInt32LE(p + 20),
        size: cd.readUInt32LE(p + 24),
        localOffset: cd.readUInt32LE(p + 42),
      };
      break;
    }
    p += 46 + nameLen + extraLen + commentLen;
  }
  if (!entry) throw new Error(`zip: ${name} mangler`);
  if (entry.compSize === 0xffffffff || entry.size === 0xffffffff || entry.localOffset === 0xffffffff) {
    throw new Error('zip: ZIP64 støttes ikke');
  }
  if (entry.flags & 0x01) throw new Error('zip: kryptert entry støttes ikke');
  if (entry.method !== 0 && entry.method !== 8) throw new Error(`zip: metode ${entry.method} støttes ikke`);

  // 3) Lokal header + data. Størrelser tas fra sentralkatalogen (lokal header kan ha 0 ved data descriptor).
  const guessEnd = Math.min(
    tail.total - 1,
    entry.localOffset + 30 + Buffer.byteLength(name) + LOCAL_HEADER_MARGIN + entry.compSize - 1
  );
  let chunk = (await fetchRange(url, `bytes=${entry.localOffset}-${guessEnd}`, fetchFn)).buf;
  if (chunk.length < 30 || chunk.readUInt32LE(0) !== SIG_LOCAL) throw new Error('zip: ugyldig lokal header');
  const dataStart = 30 + chunk.readUInt16LE(26) + chunk.readUInt16LE(28);
  let data;
  if (dataStart + entry.compSize <= chunk.length) {
    data = chunk.subarray(dataStart, dataStart + entry.compSize);
  } else {
    const abs = entry.localOffset + dataStart;
    chunk = null;
    data = (await fetchRange(url, `bytes=${abs}-${abs + entry.compSize - 1}`, fetchFn)).buf;
  }

  const out = entry.method === 8 ? zlib.inflateRawSync(data) : Buffer.from(data);
  if (out.length !== entry.size || crc32(out) !== entry.crc) {
    throw new Error('zip: CRC/størrelse stemmer ikke');
  }
  return out;
}
