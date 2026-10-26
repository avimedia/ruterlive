/**
 * Linjeliste og treffelogikk for linjesøk i kartsøket. Ren logikk (ingen DOM), delt med testene.
 * Listen er håndkopiert fra server/line-catalog.js (test/line-search.test.js sjekker at de er like).
 */

export const MODE_ORDER = ['metro', 'tram', 'rail', 'flytog', 'flybuss', 'bus'];

export const MODE_COLORS = {
  bus: '#e63946',
  flybuss: '#ff6b35',
  metro: '#2a9d8f',
  tram: '#e9c46a',
  water: '#457b9d',
  rail: '#9b59b6',
  flytog: '#e056fd',
};

const MODE_LABEL = { metro: 'T-bane', tram: 'Trikk', rail: 'Tog', flytog: 'Flytoget', flybuss: 'Flybuss', bus: 'Buss', water: 'Båt' };

export function modeLabel(mode) {
  return MODE_LABEL[mode] || 'Linje';
}

const BUS = ['20', '21', '23', '25', '28', '30', '31', '34', '37', '54', '60', '70', '74', '81', '100', '110', '150', '160'];

function line(code, mode, title, aliases = [], authority = 'RUT') {
  return { code, mode, title, aliases, authority };
}

export const LINE_LIST = [
  ...['1', '2', '3', '4', '5'].map((n) => line(n, 'metro', `T-bane linje ${n}`)),
  ...['12', '13', '15', '17', '18', '19'].map((n) => line(n, 'tram', `Trikk linje ${n}`)),
  line('L1', 'rail', 'Tog L1', [], 'VYG'),
  line('L2', 'rail', 'Tog L2', ['L2x'], 'VYG'),
  line('R12', 'rail', 'Tog R12', [], 'VYG'),
  line('R13', 'rail', 'Tog R13', ['R13x'], 'VYG'),
  line('R14', 'rail', 'Tog R14', [], 'VYG'),
  line('R21', 'rail', 'Tog R21', [], 'VYG'),
  line('R22', 'rail', 'Tog R22', [], 'VYG'),
  line('R23', 'rail', 'Tog R23', ['R23x'], 'VYG'),
  line('RE10', 'rail', 'Tog RE10', [], 'VYG'),
  line('RE11', 'rail', 'Tog RE11', ['RX11'], 'VYG'),
  line('RE20', 'rail', 'Tog RE20', ['RX20'], 'VYG'),
  line('RE30', 'rail', 'Tog RE30', [], 'VYG'),
  line('FLY1', 'flytog', 'Flytoget FLY1', [], 'FLT'),
  line('FLY2', 'flytog', 'Flytoget FLY2', [], 'FLT'),
  line('FB1', 'flybuss', 'Flybuss FB1', [], 'NBU'),
  line('FB3', 'flybuss', 'Flybuss FB3', [], 'NBU'),
  line('FB5', 'flybuss', 'Flybuss FB5', [], 'NBU'),
  ...BUS.map((n) => line(n, 'bus', `Buss ${n}`)),
];

// Modusord foran linjekoden. Lengste først slik at «tbane» ikke tolkes som «t» + «bane».
const PREFIXES = [
  ['flytoget', 'flytog'],
  ['flybuss', 'flybuss'],
  ['t-bane', 'metro'],
  ['tbane', 'metro'],
  ['metro', 'metro'],
  ['flytog', 'flytog'],
  ['trikk', 'tram'],
  ['buss', 'bus'],
  ['bus', 'bus'],
  ['tog', 'rail'],
  ['t', 'metro'],
];

const MAX_RESULTS = 6;

function norm(s) {
  return String(s ?? '').toLowerCase().replace(/\s+/g, '');
}

/** Deler spørringen i valgfri modus og kodedel. «trikk 13» gir { mode: 'tram', rest: '13' }. */
export function parseLineQuery(query) {
  const q = norm(query);
  for (const [word, mode] of PREFIXES) {
    if (q.startsWith(word)) {
      const rest = q.slice(word.length).replace(/^[-:]/, '');
      // «t» alene som prefiks bare foran siffer (t5); ellers er det starten på et annet ord
      if (word === 't' && !/^\d/.test(rest)) continue;
      return { mode, rest };
    }
  }
  return { mode: null, rest: q };
}

/**
 * Linjer som passer spørringen. extra = [{ code, mode }] fra kjøretøy som er live nå.
 * Kodedelen må være eksakt ved ett tegn, ellers starter-med. Eksakte treff først, så moduslisten.
 */
export function matchLines(query, extra = [], { exactOnly = false } = {}) {
  const { mode, rest } = parseLineQuery(query);
  if (!rest && !mode) return [];
  const all = [...LINE_LIST];
  const seen = new Set(all.map((l) => `${l.mode}|${l.code.toUpperCase()}`));
  for (const e of extra || []) {
    const code = String(e?.code ?? '').trim();
    if (!code || code === '?' || !e.mode) continue;
    const key = `${e.mode}|${code.toUpperCase()}`;
    if (seen.has(key)) continue;
    seen.add(key);
    const authority = typeof e.authority === 'string' && /^[A-Z]{3}$/.test(e.authority) ? e.authority : null;
    all.push({ code, mode: e.mode, title: `${modeLabel(e.mode)} ${code}`, aliases: [], authority });
  }
  const out = [];
  for (const l of all) {
    if (mode && l.mode !== mode) continue;
    const codes = [l.code, ...(l.aliases || [])].map(norm);
    const exact = codes.includes(rest);
    const starts = rest.length >= 2 && codes.some((c) => c.startsWith(rest));
    const modeOnly = Boolean(mode) && !rest;
    if (exactOnly ? exact : exact || starts || modeOnly) out.push({ ...l, exact });
  }
  out.sort(
    (a, b) =>
      Number(b.exact) - Number(a.exact) ||
      MODE_ORDER.indexOf(a.mode) - MODE_ORDER.indexOf(b.mode) ||
      a.code.localeCompare(b.code, 'nb', { numeric: true }),
  );
  return out.slice(0, MAX_RESULTS);
}

export function chipLabel(l) {
  return `Linje ${l.code}`;
}

/** Kodene (hovedkode + alias) i store bokstaver, brukt til å kjenne igjen kjøretøy og ruter. */
export function lineCodes(l) {
  return [l.code, ...(l.aliases || [])].map((c) => String(c).toUpperCase());
}

/** ?linje=31 gir første linje med nøyaktig kode (eller null). Brukes av applyUrlParams. */
export function parseLineParam(search) {
  const raw = new URLSearchParams(search || '').get('linje');
  if (!raw || raw.length > 20) return null;
  return matchLines(raw, [], { exactOnly: true })[0] ?? null;
}

/** Linjekode slik kjøretøy og ruter sammenlignes: store bokstaver, uten «-2»-suffiks og ledende nuller. */
export function normLineCode(s) {
  return String(s ?? '').toUpperCase().replace(/-\d+$/, '').replace(/^0+(?=.)/, '');
}

/** Linje-ID-en til kjøretøyet (f.eks. RUT:Line:31), eller null. */
export function vehicleLineRef(v) {
  const ref = v?.line?.ref || v?.line?.lineRef;
  return typeof ref === 'string' && ref ? ref : null;
}

/** Uthevingen for en valgt linje: { mode, codes (normalisert), authority|null }. */
export function lineHighlightOf(l) {
  if (!l) return null;
  const authority = typeof l.authority === 'string' && /^[A-Z]{3}$/.test(l.authority) ? l.authority : null;
  return { mode: l.mode, codes: lineCodes(l).map(normLineCode), authority };
}

/**
 * Om kjøretøyet tilhører den uthevede linja. mode er kjøretøyets normaliserte modus.
 * Har linja en authority og kjøretøyet en linje-ID fra en annen authority (samme kode i et annet fylke),
 * er det ikke treff. Kjøretøy uten linje-ID kjennes igjen på kode og modus.
 */
export function vehicleOnLine(v, mode, h) {
  if (!h || mode !== h.mode) return false;
  if (!h.codes.includes(normLineCode(v?.line?.publicCode))) return false;
  const ref = vehicleLineRef(v);
  return !(h.authority && ref && !ref.startsWith(`${h.authority}:`));
}

/** Foretrukket authority for en live-linje: RUT hvis noen av kjøretøyene er Ruters, ellers den eneste. */
export function preferredAuthority(authorities) {
  const set = new Set([...(authorities || [])].filter(Boolean));
  if (set.has('RUT')) return 'RUT';
  return set.size === 1 ? [...set][0] : null;
}
