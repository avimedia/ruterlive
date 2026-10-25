import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { callDelaySeconds, roundDelay, delayLabel } from '../shared/vehicle-delay.js';
import { isDwelling, positionAt, encodeVehiclePath } from '../shared/vehicle-path.js';
import { bearingDeg, distanceM, angleDiff, headingFromMove } from '../js/vehicle-heading.js';
import { buildVehiclesPayload } from '../server/vehicles-payload.js';
import { parseEtJourneys } from '../server/et-parse.js';

// --- Forsinkelse ---

test('callDelaySeconds: ankomst foran avgang, hele sekunder, 0 når ukjent', () => {
  assert.equal(callDelaySeconds(200_400, 100_000, 999_000, 0), 100);
  assert.equal(callDelaySeconds(null, 100_000, 160_000, 100_000), 60);
  assert.equal(callDelaySeconds(150_000, null, 160_000, 100_000), 60);
  assert.equal(callDelaySeconds(90_000, 100_000, null, null), -10);
  assert.equal(callDelaySeconds(null, null, null, null), 0);
  assert.equal(callDelaySeconds(100_000, undefined, NaN, 5), 0);
});

test('roundDelay: 30-sekunderssteg, utelatt under ett minutt og ved ugyldig verdi', () => {
  assert.equal(roundDelay(0), null);
  assert.equal(roundDelay(59), null);
  assert.equal(roundDelay(-300), null);
  assert.equal(roundDelay(undefined), null);
  assert.equal(roundDelay(NaN), null);
  assert.equal(roundDelay(60), 60);
  assert.equal(roundDelay(74), 60);
  assert.equal(roundDelay(75), 90);
  assert.equal(roundDelay(131), 120);
  assert.equal(roundDelay(1000), 990);
});

test('delayLabel: «+N min» fra to minutter', () => {
  assert.equal(delayLabel(undefined), '');
  assert.equal(delayLabel(90), '');
  assert.equal(delayLabel(120), '+2 min');
  assert.equal(delayLabel(150), '+3 min');
  assert.equal(delayLabel(600), '+10 min');
});

test('et-parse: forsinkelse per estimert kall fra Aimed/Expected', () => {
  const xml = `<Siri><EstimatedVehicleJourney><LineRef>RUT:Line:31</LineRef><EstimatedCalls>
    <EstimatedCall><StopPointRef>NSR:Quay:1</StopPointRef><AimedArrivalTime>2026-10-21T08:00:00+02:00</AimedArrivalTime><ExpectedArrivalTime>2026-10-21T08:03:10+02:00</ExpectedArrivalTime></EstimatedCall>
    <EstimatedCall><StopPointRef>NSR:Quay:2</StopPointRef><AimedDepartureTime>2026-10-21T08:05:00+02:00</AimedDepartureTime><ExpectedDepartureTime>2026-10-21T08:04:30+02:00</ExpectedDepartureTime></EstimatedCall>
    <EstimatedCall><StopPointRef>NSR:Quay:3</StopPointRef><ExpectedDepartureTime>2026-10-21T08:09:00+02:00</ExpectedDepartureTime></EstimatedCall>
  </EstimatedCalls></EstimatedVehicleJourney></Siri>`;
  const [j] = parseEtJourneys(xml);
  assert.deepEqual(j.estimatedCalls.map((c) => c.delay), [190, -30, 0]);
});

test('et-parse: ekte utdrag har forsinkelser, alle heltall', () => {
  const xml = readFileSync(new URL('./fixtures/et-sample.xml', import.meta.url), 'utf8');
  const delays = parseEtJourneys(xml).flatMap((j) => j.estimatedCalls.map((c) => c.delay));
  assert.ok(delays.length > 0);
  assert.ok(delays.every(Number.isInteger));
  assert.ok(delays.some((d) => d >= 60));
});

// --- Payload ---

const T0 = 1_792_574_800;
const etVehicle = (id, delay) => ({
  vehicleId: id,
  mode: 'bus',
  location: { latitude: 59.9, longitude: 10.8 },
  line: { publicCode: '70' },
  destinationName: 'Nationaltheatret',
  path: [[59.9, 10.8, (T0 - 10) * 1000, (T0 - 10) * 1000], [59.91, 10.81, (T0 + 90) * 1000, (T0 + 90) * 1000]],
  ...(delay === undefined ? {} : { delay }),
});

test('payload: delay bare når ≥ 60 s, avrundet til 30 s', () => {
  const p = buildVehiclesPayload([etVehicle('a', 131), etVehicle('b', 40), etVehicle('c'), etVehicle('d', -90)], { nowMs: T0 * 1000 });
  assert.equal(p.vehicles[0].delay, 120);
  for (const v of p.vehicles.slice(1)) assert.equal('delay' in v, false);
});

test('payload: delay gir høyst 12 byte mer per kjøretøy i snitt (kjøretøy fra ekte ET-utdrag)', () => {
  const xml = readFileSync(new URL('./fixtures/et-sample.xml', import.meta.url), 'utf8');
  const journeys = parseEtJourneys(xml);
  const now = T0 * 1000;
  const withDelay = journeys.map((j, i) => {
    const next = j.estimatedCalls[0];
    return { ...etVehicle(`v${i}`), line: { publicCode: j.lineRef }, ...(next?.delay > 0 ? { delay: next.delay } : {}) };
  });
  const without = withDelay.map(({ delay, ...v }) => v);
  const bytes = (vs) => Buffer.byteLength(JSON.stringify(buildVehiclesPayload(vs, { nowMs: now, shapesVersion: 'x' })));
  const extra = (bytes(withDelay) - bytes(without)) / withDelay.length;
  assert.ok(withDelay.some((v) => v.delay >= 60), 'utdraget har forsinkede kjøretøy');
  assert.ok(extra > 0 && extra <= 12, `ekstra byte per kjøretøy: ${extra}`);
});

test('legacy /api/initial-data: withoutDelay fjerner delay uten å mutere', async () => {
  const { withoutDelay, mergeVehicles } = await import('../server/live-vehicles.js');
  const et = etVehicle('a', 200);
  const merged = mergeVehicles({ data: { vehicles: [{ vehicleId: 'a', mode: 'BUS' }] } }, { vehicles: [et, etVehicle('b', 90)] });
  assert.equal(merged[0].delay, 200); // GPS-kjøretøy får forsinkelsen fra ET
  const legacy = withoutDelay(merged);
  assert.ok(legacy.every((v) => !('delay' in v)));
  assert.equal(et.delay, 200);
});

// --- Står på holdeplass ---

// [lat, lon, arrMs, depMs]
const path = [
  [59.0, 10.0, 0, 1000],
  [59.1, 10.2, 2000, 3000],
  [59.3, 10.4, 5000, 5000],
];

test('isDwelling: på holdeplass før avgang, mellom ankomst og avgang og etter siste ankomst', () => {
  assert.equal(isDwelling(path, -500), true);
  assert.equal(isDwelling(path, 1000), true);
  assert.equal(isDwelling(path, 1500), false);
  assert.equal(isDwelling(path, 2000), true);
  assert.equal(isDwelling(path, 2500), true);
  assert.equal(isDwelling(path, 4000), false);
  assert.equal(isDwelling(path, 6000), true);
});

test('isDwelling stemmer med positionAt (står på et punkt ⇔ dwell)', () => {
  for (let t = -1000; t <= 6000; t += 250) {
    const pos = positionAt(path, t);
    const onPoint = path.some((p) => p[0] === pos[0] && p[1] === pos[1]);
    if (isDwelling(path, t)) assert.ok(onPoint, `t=${t}`);
  }
});

test('isDwelling: kompakt format med t0 og ugyldig input', () => {
  const t0 = 1_000_000;
  const compact = encodeVehiclePath(path.map((p) => [p[0], p[1], p[2] + t0 * 1000, p[3] + t0 * 1000]), t0);
  assert.equal(isDwelling(compact, (t0 + 2.5) * 1000, t0), true);
  assert.equal(isDwelling(compact, (t0 + 4) * 1000, t0), false);
  assert.equal(isDwelling(null, 0), false);
  assert.equal(isDwelling([], 0), false);
  assert.equal(isDwelling(path, NaN), false);
});

test('isDwelling: baklengs tider (forsinkelse) gir ingen kjøring bakover', () => {
  const late = [[59.0, 10.0, 0, 5000], [59.1, 10.2, 3000, 3000], [59.2, 10.3, 8000, 8000]];
  assert.equal(isDwelling(late, 4000), true); // fortsatt på første stopp
  assert.equal(isDwelling(late, 6000), false);
});

// --- Kjøreretning ---

test('bearingDeg: himmelretninger og 0–359', () => {
  assert.equal(bearingDeg([59.9, 10.7], [59.91, 10.7]), 0);
  assert.equal(bearingDeg([59.9, 10.7], [59.9, 10.71]), 90);
  assert.equal(bearingDeg([59.9, 10.7], [59.89, 10.7]), 180);
  assert.equal(bearingDeg([59.9, 10.7], [59.9, 10.69]), 270);
  // Nordøst på 60° N: lengdegrader er ca. halvparten så lange
  assert.equal(bearingDeg([60, 10], [60.001, 10.002]), 45);
  const b = bearingDeg([59.9, 10.7], [59.9001, 10.6999]);
  assert.ok(b >= 0 && b < 360);
});

test('distanceM og headingFromMove: under 3 m gir ingen ny kurs', () => {
  const a = [59.9, 10.7];
  const twoM = [59.9 + 2 / 111_195, 10.7];
  const fourM = [59.9 + 4 / 111_195, 10.7];
  assert.ok(Math.abs(distanceM(a, fourM) - 4) < 0.01);
  assert.equal(headingFromMove(a, twoM), null);
  assert.equal(headingFromMove(a, fourM), 0);
  assert.equal(headingFromMove(null, fourM), null);
});

test('angleDiff: korteste vei rundt', () => {
  assert.equal(angleDiff(10, 350), 20);
  assert.equal(angleDiff(350, 10), 20);
  assert.equal(angleDiff(0, 180), 180);
  assert.equal(angleDiff(90, 94), 4);
});
