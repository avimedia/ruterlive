import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { DOMParser } from '@xmldom/xmldom';
import { parseEtJourneys } from '../server/et-parse.js';
import { journeyVehicleId } from '../shared/et-journeys.js';

const FIXTURE = readFileSync(new URL('./fixtures/et-sample.xml', import.meta.url), 'utf8');
const SIRI_NS = 'http://www.siri.org.uk/siri';

// --- Gammel DOM-parser (kopi fra et-vehicles-service.js / shape-service.js før bytte), kun til paritetstest ---

function legacyMode(lineRef) {
  const m = /:Line:(\d+)/.exec(lineRef || '');
  const num = m ? parseInt(m[1], 10) : null;
  if (!num) return null;
  if ([1, 2, 3, 4, 5, 6].includes(num)) return 'metro';
  if (num >= 11 && num <= 19) return 'tram';
  if (num >= 20) return 'bus';
  return null;
}

function parseIsoTime(str) {
  if (!str) return null;
  const d = new Date(str);
  return isNaN(d.getTime()) ? null : d.getTime();
}

function legacyParse(xmlText, { vehicles }) {
  const doc = new DOMParser().parseFromString(xmlText, 'text/xml');
  const journeys = [];
  const journeyEls = doc.getElementsByTagNameNS(SIRI_NS, 'EstimatedVehicleJourney');
  for (let i = 0; i < journeyEls.length; i++) {
    const jel = journeyEls[i];
    const t = (el, name) => el.getElementsByTagNameNS(SIRI_NS, name)[0]?.textContent;
    const lineRef = t(jel, 'LineRef');
    const mode = legacyMode(lineRef);
    if (!mode) continue;
    const vehicleRef = t(jel, 'VehicleRef') || '';
    const datedVehicleJourneyRef = t(jel, 'DatedVehicleJourneyRef') || '';
    const destinationName = (t(jel, 'DestinationDisplay') || '').trim();

    const recordedCalls = [];
    const rcEls = jel.getElementsByTagNameNS(SIRI_NS, 'RecordedCall');
    for (let r = 0; r < rcEls.length; r++) {
      const cel = rcEls[r];
      const ref = t(cel, 'StopPointRef');
      const name = t(cel, 'StopPointName') || '';
      const dep = parseIsoTime(t(cel, 'ActualDepartureTime')) || parseIsoTime(t(cel, 'ActualArrivalTime'));
      if (ref && dep) recordedCalls.push({ quayId: ref, name, time: dep });
    }
    const estimatedCalls = [];
    const ecEls = jel.getElementsByTagNameNS(SIRI_NS, 'EstimatedCall');
    for (let e = 0; e < ecEls.length; e++) {
      const cel = ecEls[e];
      const ref = t(cel, 'StopPointRef');
      const name = t(cel, 'StopPointName') || '';
      const arr = parseIsoTime(t(cel, 'ExpectedArrivalTime')) || parseIsoTime(t(cel, 'ExpectedDepartureTime'));
      const dep = parseIsoTime(t(cel, 'ExpectedDepartureTime'));
      if (ref && (arr || dep)) estimatedCalls.push({ quayId: ref, name, arrTime: arr || dep, depTime: dep || arr });
    }
    if (recordedCalls.length === 0 && estimatedCalls.length === 0) continue;

    if (vehicles) {
      journeys.push({
        vehicleId: journeyVehicleId({
          vehicleRef,
          datedVehicleJourneyRef,
          lineRef,
          firstQuayId: (recordedCalls[0] || estimatedCalls[0])?.quayId,
          firstTime: recordedCalls[0]?.time ?? (estimatedCalls[0]?.depTime || estimatedCalls[0]?.arrTime),
        }),
        mode,
        lineRef,
        destinationName,
        recordedCalls,
        estimatedCalls,
      });
    } else {
      journeys.push({ mode, lineRef, recordedCalls, estimatedCalls });
    }
  }
  return journeys;
}

// Feltene hver tjeneste brukte fra sin gamle parser
const asVehicleJourney = ({ vehicleId, mode, lineRef, destinationName, recordedCalls, estimatedCalls }) =>
  ({ vehicleId, mode, lineRef, destinationName, recordedCalls, estimatedCalls });
const asShapeJourney = ({ mode, lineRef, recordedCalls, estimatedCalls }) =>
  ({ mode, lineRef, recordedCalls, estimatedCalls });

test('fixture er et ekte utdrag med varierte turer', () => {
  assert.ok(Buffer.byteLength(FIXTURE) <= 200 * 1024);
  const legacy = legacyParse(FIXTURE, { vehicles: true });
  assert.ok(legacy.length >= 10);
  assert.ok(legacy.some((j) => !j.vehicleId.startsWith('et-')), 'tur med VehicleRef');
  assert.ok(legacy.some((j) => j.vehicleId.startsWith('et-')), 'tur uten VehicleRef');
  assert.ok(legacy.some((j) => j.recordedCalls.length > 0 && j.estimatedCalls.length > 0));
  assert.ok(legacy.some((j) => j.recordedCalls.length === 0));
});

test('paritet med gammel DOM-parser i et-vehicles-service (ekte utdrag)', () => {
  const got = parseEtJourneys(FIXTURE).map(asVehicleJourney);
  assert.deepEqual(got, legacyParse(FIXTURE, { vehicles: true }));
});

test('paritet med gammel DOM-parser i shape-service (ekte utdrag)', () => {
  const got = parseEtJourneys(FIXTURE).map(asShapeJourney);
  assert.deepEqual(got, legacyParse(FIXTURE, { vehicles: false }));
});

test('datedVehicleJourneyRef er med', () => {
  const doc = new DOMParser().parseFromString(FIXTURE, 'text/xml');
  const els = doc.getElementsByTagNameNS(SIRI_NS, 'DatedVehicleJourneyRef');
  const refs = Array.from({ length: els.length }, (_, i) => els[i].textContent);
  const got = parseEtJourneys(FIXTURE).map((j) => j.datedVehicleJourneyRef);
  assert.ok(got.length > 0);
  for (const r of got) assert.ok(refs.includes(r));
});

const SYNTHETIC = `<?xml version="1.0" encoding="UTF-8"?>
<s:Siri xmlns:s="http://www.siri.org.uk/siri" version="2.0"><s:ServiceDelivery><s:EstimatedTimetableDelivery><s:EstimatedJourneyVersionFrame>
<s:EstimatedVehicleJourney>
  <s:LineRef>RUT:Line:31</s:LineRef>
  <s:FramedVehicleJourneyRef><s:DatedVehicleJourneyRef>RUT:ServiceJourney:a&amp;b</s:DatedVehicleJourneyRef></s:FramedVehicleJourneyRef>
  <s:VehicleRef/>
  <s:RecordedCalls>
    <s:RecordedCall><s:StopPointRef>NSR:Quay:1</s:StopPointRef><s:StopPointName>Bj&#248;rvika &lt;&#x41;&gt; &quot;x&quot; &apos;y&apos;</s:StopPointName><s:ActualArrivalTime>2026-10-21T08:00:00+02:00</s:ActualArrivalTime></s:RecordedCall>
    <s:RecordedCall><s:StopPointRef>NSR:Quay:2</s:StopPointRef><s:StopPointName>Uten tid</s:StopPointName></s:RecordedCall>
    <s:RecordedCall><s:StopPointName>Uten ref</s:StopPointName><s:ActualDepartureTime>2026-10-21T08:01:00+02:00</s:ActualDepartureTime></s:RecordedCall>
  </s:RecordedCalls>
  <s:EstimatedCalls>
    <s:EstimatedCall><s:StopPointRef>NSR:Quay:3</s:StopPointRef><s:StopPointName><![CDATA[Jernbanetorget & co]]></s:StopPointName><s:DestinationDisplay>  Ringen  </s:DestinationDisplay><s:ExpectedDepartureTime>2026-10-21T08:05:00+02:00</s:ExpectedDepartureTime></s:EstimatedCall>
    <s:EstimatedCall><s:StopPointRef>NSR:Quay:4</s:StopPointRef><s:ExpectedArrivalTime>ugyldig</s:ExpectedArrivalTime></s:EstimatedCall>
    <s:EstimatedCall attr="1"><s:StopPointRef>NSR:Quay:5</s:StopPointRef><s:ExpectedArrivalTime>2026-10-21T08:09:00+02:00</s:ExpectedArrivalTime><s:ExpectedDepartureTime>2026-10-21T08:10:00+02:00</s:ExpectedDepartureTime></s:EstimatedCall>
  </s:EstimatedCalls>
</s:EstimatedVehicleJourney>
<s:EstimatedVehicleJourney><s:LineRef>RUT:Line:9</s:LineRef><s:EstimatedCalls><s:EstimatedCall><s:StopPointRef>NSR:Quay:9</s:StopPointRef><s:ExpectedDepartureTime>2026-10-21T08:05:00+02:00</s:ExpectedDepartureTime></s:EstimatedCall></s:EstimatedCalls></s:EstimatedVehicleJourney>
<s:EstimatedVehicleJourney><s:LineRef>RUT:Line:2</s:LineRef><s:VehicleRef>T-123</s:VehicleRef></s:EstimatedVehicleJourney>
<s:EstimatedVehicleJourney><s:LineRef>RUT:Line:13</s:LineRef><s:VehicleRef>SL95-1</s:VehicleRef><s:EstimatedCalls><s:EstimatedCall><s:StopPointRef>NSR:Quay:7</s:StopPointRef><s:StopPointName>Majorstuen</s:StopPointName><s:ExpectedArrivalTime>2026-10-21T08:05:00+02:00</s:ExpectedArrivalTime></s:EstimatedCall></s:EstimatedCalls></s:EstimatedVehicleJourney>
</s:EstimatedJourneyVersionFrame></s:EstimatedTimetableDelivery></s:ServiceDelivery></s:Siri>`;

test('prefiks, entiteter, CDATA, tomme elementer og ugyldige kall gir samme resultat som DOM', () => {
  const got = parseEtJourneys(SYNTHETIC);
  assert.deepEqual(got.map(asVehicleJourney), legacyParse(SYNTHETIC, { vehicles: true }));
  assert.equal(got.length, 2);
  assert.equal(got[0].recordedCalls[0].name, 'Bjørvika <A> "x" \'y\'');
  assert.equal(got[0].estimatedCalls[0].name, 'Jernbanetorget & co');
  assert.equal(got[0].destinationName, 'Ringen');
  assert.equal(got[0].datedVehicleJourneyRef, 'RUT:ServiceJourney:a&b');
  assert.equal(got[0].vehicleId, 'et-RUT:ServiceJourney:a&b');
  assert.equal(got[1].mode, 'tram');
});

test('holder ikke på XML-en etter parse (RegExp.input peker ikke inn i XML)', () => {
  parseEtJourneys(FIXTURE);
  assert.equal(RegExp.input, '');
});

test('tom eller ugyldig input gir tom liste', () => {
  assert.deepEqual(parseEtJourneys(''), []);
  assert.deepEqual(parseEtJourneys('<Siri><EstimatedVehicleJourney><LineRef>RUT:Line:31'), []);
});
