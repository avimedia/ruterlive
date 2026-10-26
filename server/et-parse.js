/**
 * Lett SIRI ET-parser uten DOM. Skanner <EstimatedVehicleJourney>-blokker med
 * indeksering/regex i stedet for å bygge et DOM-tre (xmldom brukte ~145 MB heap
 * per parse av hele ET). Gir samme turer og kall som den gamle DOM-parseren:
 * første forekomst av et element innenfor turen/kallet, tekst med XML-entiteter
 * dekodet.
 */

import { journeyVehicleId } from '../shared/et-journeys.js';
import { callDelaySeconds } from '../shared/vehicle-delay.js';
import { getModeFromLineNumFallback } from '../shared/line-mode.js';

function parseIsoTime(str) {
  if (!str) return null;
  const d = new Date(str);
  return isNaN(d.getTime()) ? null : d.getTime();
}

// Starttagg med valgfritt navnerom-prefiks og attributter, f.eks. <s:LineRef a="1">
const openTagRes = new Map();
function openTagRe(name) {
  let re = openTagRes.get(name);
  if (!re) {
    re = new RegExp(`<([A-Za-z_][\\w.-]*:)?${name}(?=[\\s/>])[^>]*>`, 'g');
    openTagRes.set(name, re);
  }
  return re;
}

/**
 * Finner element nr. 1, 2, … med gitt navn i src fra posisjon `from`.
 * Returnerer { start, end, innerStart, innerEnd } eller null. Tomt element (<X/>) har tomt innhold.
 */
function findElement(src, name, from) {
  const re = openTagRe(name);
  re.lastIndex = from;
  const m = re.exec(src);
  if (!m) return null;
  const tagEnd = m.index + m[0].length;
  if (m[0].charCodeAt(m[0].length - 2) === 47 /* '/' */) {
    return { start: m.index, end: tagEnd, innerStart: tagEnd, innerEnd: tagEnd };
  }
  const close = `</${m[1] || ''}${name}>`;
  const closeIdx = src.indexOf(close, tagEnd);
  if (closeIdx === -1) return null; // Avkuttet XML – hopp over
  return { start: m.index, end: closeIdx + close.length, innerStart: tagEnd, innerEnd: closeIdx };
}

const NAMED_ENTITIES = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'" };

function decodeEntities(s) {
  if (s.indexOf('&') === -1) return s;
  return s.replace(/&(#x[0-9a-fA-F]+|#[0-9]+|[A-Za-z]+);/g, (all, ent) => {
    if (ent[0] === '#') {
      const code = ent[1] === 'x' || ent[1] === 'X' ? parseInt(ent.slice(2), 16) : parseInt(ent.slice(1), 10);
      return Number.isFinite(code) && code >= 0 && code <= 0x10ffff ? String.fromCodePoint(code) : all;
    }
    return NAMED_ENTITIES[ent] ?? all;
  });
}

/** textContent for innholdet i et element: CDATA ordrett, tagger og kommentarer fjernet, entiteter dekodet. */
function textContent(inner) {
  if (inner.indexOf('<') === -1) return decodeEntities(inner);
  let out = '';
  let i = 0;
  while (i < inner.length) {
    const lt = inner.indexOf('<', i);
    if (lt === -1) {
      out += decodeEntities(inner.slice(i));
      break;
    }
    out += decodeEntities(inner.slice(i, lt));
    if (inner.startsWith('<![CDATA[', lt)) {
      const end = inner.indexOf(']]>', lt + 9);
      if (end === -1) break;
      out += inner.slice(lt + 9, end);
      i = end + 3;
    } else if (inner.startsWith('<!--', lt)) {
      const end = inner.indexOf('-->', lt + 4);
      if (end === -1) break;
      i = end + 3;
    } else {
      const end = inner.indexOf('>', lt);
      if (end === -1) break;
      i = end + 1;
    }
  }
  return out;
}

/**
 * Lager en egen kopi av strengen og gjenbruker like verdier innen én parse.
 * Uten kopi kan V8 la delstrenger peke inn i hele ET-XML-en (flere MB), slik at
 * gammel XML blir liggende i minnet så lenge f.eks. stoppnavn i rutecachen lever.
 */
function makeInterner() {
  const seen = new Map();
  return (s) => {
    if (s == null) return s;
    let v = seen.get(s);
    if (v === undefined) {
      v = s.length === 0 ? '' : Buffer.from(s, 'utf8').toString('utf8');
      seen.set(v, v);
    }
    return v;
  };
}

function firstText(src, name, intern) {
  const el = findElement(src, name, 0);
  if (!el) return undefined;
  return intern(textContent(src.slice(el.innerStart, el.innerEnd)));
}

/** Tidspunkt (ms) fra første element med gitt navn, uten interning (strengen trengs ikke videre). */
function timeOf(src, name) {
  const el = findElement(src, name, 0);
  return el ? parseIsoTime(textContent(src.slice(el.innerStart, el.innerEnd))) : null;
}

function* eachElement(src, name) {
  let pos = 0;
  for (;;) {
    const el = findElement(src, name, pos);
    if (!el) return;
    yield src.slice(el.innerStart, el.innerEnd);
    pos = el.end;
  }
}

/**
 * Parser SIRI ET-XML til turer:
 * { vehicleId, mode, lineRef, destinationName, datedVehicleJourneyRef,
 *   recordedCalls: [{ quayId, name, time }], estimatedCalls: [{ quayId, name, arrTime, depTime, delay }] }.
 * delay = forventet − planlagt (sekunder, 0 når ukjent).
 * Turer uten modus (linjenummer-fallback) eller uten gyldige kall hoppes over.
 * Kaster aldri; ugyldig input gir tom liste.
 */
export function parseEtJourneys(xmlText) {
  const journeys = [];
  if (!xmlText) return journeys;
  parseInto(xmlText, journeys, makeInterner());
  // V8 husker siste regex-input (RegExp.input) globalt. Den er en delstreng av XML-en
  // og ville holdt hele den gamle XML-en i live til neste regex-kall et annet sted.
  /(?:)/.exec('');
  return journeys;
}

const CLOSE_JOURNEY_RE = /<\/(?:[A-Za-z_][\w.-]*:)?EstimatedVehicleJourney>/g;
const CLOSE_JOURNEY_MAX_LEN = 80; // lengste sluttagg vi venter (med prefiks)

/**
 * Parser ET bit for bit mens svaret lastes ned, så hele XML-en (~25 MB) aldri ligger i minnet.
 * push(tekst) kan kalles med vilkårlige biter; end() gir samme turer som parseEtJourneys(hele).
 */
export function createEtStreamParser(opts = {}) {
  const journeys = [];
  const intern = makeInterner();
  let buf = '';
  let scanFrom = 0;
  return {
    push(chunk) {
      if (!chunk) return;
      buf += chunk;
      // Del etter siste hele tur; resten venter på flere biter
      CLOSE_JOURNEY_RE.lastIndex = scanFrom;
      let cut = -1;
      for (let m; (m = CLOSE_JOURNEY_RE.exec(buf));) cut = m.index + m[0].length;
      if (cut > 0) {
        parseInto(buf.slice(0, cut), journeys, intern, opts);
        buf = buf.slice(cut);
      }
      scanFrom = Math.max(0, buf.length - CLOSE_JOURNEY_MAX_LEN);
    },
    end() {
      if (buf) parseInto(buf, journeys, intern, opts);
      buf = '';
      /(?:)/.exec('');
      return journeys;
    },
  };
}

/** Sann når turen selv (ikke bare et kall) er innstilt: <Cancellation> før kall-listene. */
function isJourneyCancelled(jel) {
  let end = jel.length;
  for (const name of ['RecordedCalls', 'EstimatedCalls']) {
    const el = findElement(jel, name, 0);
    if (el && el.start < end) end = el.start;
  }
  const c = findElement(jel.slice(0, end), 'Cancellation', 0);
  return !!c && textContent(jel.slice(c.innerStart, c.innerEnd)).trim() === 'true';
}

const isCallCancelled = (cel) => {
  const c = findElement(cel, 'Cancellation', 0);
  return !!c && textContent(cel.slice(c.innerStart, c.innerEnd)).trim() === 'true';
};

/**
 * opts.mode: fast modus for alle turer (f.eks. 'rail' for BNR, der linjekoder som R70 ikke er tall).
 * opts.skipCancelled: hopper over innstilte turer og innstilte kall.
 */
function parseInto(xmlText, journeys, intern, opts = {}) {
  const text = (src, name) => firstText(src, name, intern);

  for (const jel of eachElement(xmlText, 'EstimatedVehicleJourney')) {
    const lineRef = text(jel, 'LineRef');
    const mode = opts.mode || getModeFromLineNumFallback(lineRef);
    if (!mode) continue;
    if (opts.skipCancelled && isJourneyCancelled(jel)) continue;

    const vehicleRef = text(jel, 'VehicleRef') || '';
    const datedVehicleJourneyRef = text(jel, 'DatedVehicleJourneyRef') || '';
    const destinationName = intern((text(jel, 'DestinationDisplay') || '').trim());

    const recordedCalls = [];
    for (const cel of eachElement(jel, 'RecordedCall')) {
      if (opts.skipCancelled && isCallCancelled(cel)) continue;
      const ref = text(cel, 'StopPointRef');
      const name = text(cel, 'StopPointName') || '';
      const dep = parseIsoTime(text(cel, 'ActualDepartureTime')) || parseIsoTime(text(cel, 'ActualArrivalTime'));
      if (ref && dep) recordedCalls.push({ quayId: ref, name, time: dep });
    }

    const estimatedCalls = [];
    for (const cel of eachElement(jel, 'EstimatedCall')) {
      if (opts.skipCancelled && isCallCancelled(cel)) continue;
      const ref = text(cel, 'StopPointRef');
      const name = text(cel, 'StopPointName') || '';
      const expDep = parseIsoTime(text(cel, 'ExpectedDepartureTime'));
      const expArr = parseIsoTime(text(cel, 'ExpectedArrivalTime'));
      const dep = expDep;
      const arr = expArr || dep;
      if (ref && (arr || dep)) {
        // Bare forsinkelsen (heltall sekunder) lagres, ikke planlagte tider: holder minnet flatt
        const delay = callDelaySeconds(expArr, timeOf(cel, 'AimedArrivalTime'), expDep, timeOf(cel, 'AimedDepartureTime'));
        estimatedCalls.push({ quayId: ref, name, arrTime: arr || dep, depTime: dep || arr, delay });
      }
    }

    if (recordedCalls.length === 0 && estimatedCalls.length === 0) continue;

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
      datedVehicleJourneyRef,
      recordedCalls,
      estimatedCalls,
    });
  }
  // V8 husker siste regex-input (RegExp.input) globalt. Den er en delstreng av XML-en
  // og ville holdt hele den gamle XML-en i live til neste regex-kall et annet sted.
  /(?:)/.exec('');
  return journeys;
}
