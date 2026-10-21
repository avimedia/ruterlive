import { test } from 'node:test';
import assert from 'node:assert/strict';
import AdmZip from 'adm-zip';

const STOPS =
  'stop_id,stop_name,stop_lat,stop_lon\n' +
  'NSR:Quay:1,Jernbanetorget,59.911,10.750\n' +
  'NSR:Quay:2,Bergen,60.39,5.32\n' +
  'NSR:StopPlace:3,Oslo S,59.91,10.75\n';

function lagZip() {
  const zip = new AdmZip();
  zip.addFile('agency.txt', Buffer.from('agency_id\nRUT\n'));
  zip.addFile('stops.txt', Buffer.from(STOPS));
  return zip.toBuffer();
}

function svar(buf, status, extra = {}) {
  return {
    ok: true,
    status,
    headers: new Headers(extra),
    arrayBuffer: async () => buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.length),
    body: { cancel: async () => {} },
  };
}

/** Fake fetch som støtter Range. */
function rangeFetch(buf, log) {
  return async (url, options = {}) => {
    const range = options.headers?.Range;
    log.push(range ?? null);
    if (!range) return svar(buf, 200);
    let start;
    let end;
    let m = /^bytes=-(\d+)$/.exec(range);
    if (m) {
      start = Math.max(0, buf.length - Number(m[1]));
      end = buf.length - 1;
    } else {
      m = /^bytes=(\d+)-(\d+)$/.exec(range);
      start = Number(m[1]);
      end = Math.min(Number(m[2]), buf.length - 1);
    }
    return svar(buf.subarray(start, end + 1), 206, { 'content-range': `bytes ${start}-${end}/${buf.length}` });
  };
}

test('loadGtfsStops: leser stops.txt via Range uten full nedlasting', async () => {
  const mod = await import('../server/gtfs-stops-loader.js?range');
  const log = [];
  const cache = await mod.loadGtfsStops(rangeFetch(lagZip(), log));
  assert.ok(log.length > 0 && log.every((r) => r !== null), 'ingen kall uten Range');
  assert.equal(cache.size, 1);
  assert.deepEqual(mod.getGtfsQuayCache().get('NSR:Quay:1'), [59.911, 10.75]);
});

test('loadGtfsStops: faller tilbake til full nedlasting når Range ignoreres', async () => {
  const mod = await import('../server/gtfs-stops-loader.js?fallback');
  const buf = lagZip();
  const log = [];
  const cache = await mod.loadGtfsStops(async (url, options = {}) => {
    log.push(options.headers?.Range ?? null);
    return svar(buf, 200);
  });
  assert.equal(cache.size, 1);
  assert.equal(log.filter((r) => r === null).length, 1, 'én full nedlasting');
  assert.deepEqual(mod.getGtfsQuayCache().get('NSR:Quay:1'), [59.911, 10.75]);
});

test('getGtfsQuayCache returnerer samme Map hver gang', async () => {
  const mod = await import('../server/gtfs-stops-loader.js?identitet');
  assert.equal(mod.getGtfsQuayCache(), null);
  await mod.loadGtfsStops(rangeFetch(lagZip(), []));
  const a = mod.getGtfsQuayCache();
  assert.ok(a instanceof Map);
  assert.equal(mod.getGtfsQuayCache(), a);
  assert.deepEqual(mod.searchStops('jernbane'), [{ id: 'NSR:Quay:1', lat: 59.911, lon: 10.75, name: 'Jernbanetorget' }]);
  assert.deepEqual(mod.getStopsInBbox(59, 60, 10, 11), [{ id: 'NSR:Quay:1', lat: 59.911, lon: 10.75, name: 'Jernbanetorget' }]);
});

test('loadGtfsStops avviser aldri når både Range og fallback feiler', async () => {
  const mod = await import('../server/gtfs-stops-loader.js?feil');
  const r = await mod.loadGtfsStops(async () => { throw new Error('nett nede'); });
  assert.equal(r, null);
});
