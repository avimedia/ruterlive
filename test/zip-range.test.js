import { test } from 'node:test';
import assert from 'node:assert/strict';
import AdmZip from 'adm-zip';
import { readZipEntry } from '../server/zip-range.js';

const STOPS = 'stop_id,stop_name,stop_lat,stop_lon\nNSR:Quay:1,Jernbanetorget,59.911,10.750\n'.repeat(200);

function lagZip({ storeStops = false } = {}) {
  const zip = new AdmZip();
  zip.addFile('agency.txt', Buffer.from('agency_id,agency_name\nRUT,Ruter\n'));
  zip.addFile('stops.txt', Buffer.from(STOPS));
  if (storeStops) zip.getEntry('stops.txt').header.method = 0;
  zip.addFile('trips.txt', Buffer.alloc(200000, 'x'));
  return zip.toBuffer();
}

/** Fake fetch som støtter Range (som Google Cloud Storage). */
function rangeFetch(buf, log = []) {
  return async (url, options = {}) => {
    const range = options.headers?.Range;
    log.push(range ?? null);
    if (!range) return fullResponse(buf);
    let m = /^bytes=-(\d+)$/.exec(range);
    let start;
    let end;
    if (m) {
      start = Math.max(0, buf.length - Number(m[1]));
      end = buf.length - 1;
    } else {
      m = /^bytes=(\d+)-(\d+)$/.exec(range);
      start = Number(m[1]);
      end = Math.min(Number(m[2]), buf.length - 1);
    }
    const body = buf.subarray(start, end + 1);
    return {
      ok: true,
      status: 206,
      headers: new Headers({ 'content-range': `bytes ${start}-${end}/${buf.length}` }),
      arrayBuffer: async () => body.buffer.slice(body.byteOffset, body.byteOffset + body.length),
      body: { cancel: async () => {} },
    };
  };
}

function fullResponse(buf) {
  return {
    ok: true,
    status: 200,
    headers: new Headers({ 'content-length': String(buf.length) }),
    arrayBuffer: async () => buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.length),
    body: { cancel: async () => {} },
  };
}

test('readZipEntry henter stops.txt (deflate) med Range', async () => {
  const log = [];
  const out = await readZipEntry('http://x/gtfs.zip', 'stops.txt', rangeFetch(lagZip(), log));
  assert.equal(out.toString('utf8'), STOPS);
  assert.ok(log.every((r) => r && r.startsWith('bytes=')), 'alle kall bruker Range');
});

test('readZipEntry håndterer ukomprimert entry (metode 0)', async () => {
  const out = await readZipEntry('http://x/gtfs.zip', 'stops.txt', rangeFetch(lagZip({ storeStops: true })));
  assert.equal(out.toString('utf8'), STOPS);
});

test('readZipEntry sender ET-Client-Name', async () => {
  const buf = lagZip();
  const inner = rangeFetch(buf);
  let headersOk = true;
  await readZipEntry('http://x/gtfs.zip', 'stops.txt', async (url, options, cfg) => {
    if (options.headers['ET-Client-Name'] !== 'ruterlive-web') headersOk = false;
    return inner(url, options, cfg);
  });
  assert.ok(headersOk);
});

test('readZipEntry kaster når serveren ignorerer Range', async () => {
  const buf = lagZip();
  await assert.rejects(
    readZipEntry('http://x/gtfs.zip', 'stops.txt', async () => fullResponse(buf)),
    /Range/
  );
});

test('readZipEntry kaster når entry mangler', async () => {
  await assert.rejects(
    readZipEntry('http://x/gtfs.zip', 'finnes-ikke.txt', rangeFetch(lagZip())),
    /mangler/
  );
});

test('readZipEntry kaster ved ZIP64-markør i stedet for å feillese', async () => {
  const buf = Buffer.from(lagZip());
  const eocd = buf.lastIndexOf(Buffer.from([0x50, 0x4b, 0x05, 0x06]));
  buf.writeUInt32LE(0xffffffff, eocd + 16); // sentralkatalog-offset = ZIP64-markør
  await assert.rejects(readZipEntry('http://x/gtfs.zip', 'stops.txt', rangeFetch(buf)), /ZIP64/);
});

test('readZipEntry bruker størrelser fra sentralkatalogen (data descriptor)', async () => {
  const buf = Buffer.from(lagZip());
  // Simuler data descriptor: flagg bit 3 og nullede størrelser/CRC i lokal header.
  let p = 0;
  while (buf.readUInt32LE(p) === 0x04034b50) {
    const nameLen = buf.readUInt16LE(p + 26);
    const name = buf.toString('utf8', p + 30, p + 30 + nameLen);
    const next = p + 30 + nameLen + buf.readUInt16LE(p + 28) + buf.readUInt32LE(p + 18);
    if (name === 'stops.txt') {
      buf.writeUInt16LE(buf.readUInt16LE(p + 6) | 0x08, p + 6);
      buf.writeUInt32LE(0, p + 14);
      buf.writeUInt32LE(0, p + 18);
      buf.writeUInt32LE(0, p + 22);
    }
    p = next;
  }
  const out = await readZipEntry('http://x/gtfs.zip', 'stops.txt', rangeFetch(buf));
  assert.equal(out.toString('utf8'), STOPS);
});

test('readZipEntry kaster ved ødelagt data (CRC/størrelse)', async () => {
  const buf = Buffer.from(lagZip({ storeStops: true }));
  const idx = buf.indexOf(Buffer.from('Jernbanetorget'));
  buf[idx] = 'X'.charCodeAt(0);
  await assert.rejects(readZipEntry('http://x/gtfs.zip', 'stops.txt', rangeFetch(buf)), /CRC/);
});
