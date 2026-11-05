/**
 * Avvik (SIRI SX) fra Entur Vehicles-API: normalisering, gyldighet, sortering og indekser.
 * Ren modul uten nettverk.
 */
import { RAIL_CODESPACES, CODESPACE_ALIASES } from '../shared/situation-areas.js';

export { RAIL_CODESPACES };

const SEVERITY_RANK = { verySevere: 0, severe: 1, normal: 2, slight: 3, undefined: 4, noImpact: 5 };
const rank = (s) => SEVERITY_RANK[s] ?? SEVERITY_RANK.undefined;

const NO_LANGS = new Set(['no', 'nb', 'nn']);

/** Norsk (eller uten språk) foran engelsk; ellers første tekst. */
function pickText(list) {
  const items = (Array.isArray(list) ? list : []).filter((t) => t && typeof t.value === 'string' && t.value.trim());
  if (!items.length) return '';
  const lang = (t) => (t.language || '').toLowerCase();
  const hit = items.find((t) => !t.language || NO_LANGS.has(lang(t))) || items[0];
  // Noen selskaper skriver linjeskift som <br>; lagres som \n (teksten er rå og escapes ved visning)
  return hit.value.replace(/<br\s*\/?>/gi, '\n').trim();
}

const toMs = (iso) => {
  if (!iso) return null;
  const ms = Date.parse(iso);
  return Number.isNaN(ms) ? null : ms;
};

function safeLink(uri) {
  try {
    const u = new URL(uri);
    return u.protocol === 'https:' || u.protocol === 'http:' ? uri : null;
  } catch {
    return null;
  }
}

/** Rått avvik fra Entur til Situation, eller null (uten oppsummering eller avsluttet). */
export function normalizeSituation(raw) {
  if (!raw || typeof raw !== 'object') return null;
  const id = raw.situationNumber;
  if (typeof id !== 'string' || !id) return null;
  if (raw.progress === 'closed') return null;
  const summary = pickText(raw.summary);
  if (!summary) return null;
  const affects = raw.affects || {};
  return {
    id,
    codespace: raw.codespace || id.split(':')[0],
    severity: raw.severity || 'undefined',
    planned: raw.planned === true,
    validity: (raw.validityPeriods || []).map((p) => ({ start: toMs(p?.startTime), end: toMs(p?.endTime) })),
    summary,
    description: pickText(raw.description),
    advice: pickText(raw.advice),
    links: (raw.infoLinks || []).map((l) => safeLink(l?.uri)).filter(Boolean),
    lines: (affects.affectedLines || [])
      .map((a) => a?.line)
      .filter((l) => l && l.lineRef)
      .map((l) => ({ ref: l.lineRef, code: l.publicCode || '' })),
    stops: (affects.stopPoints || []).filter((p) => p && p.id).map((p) => ({ id: p.id, name: p.name || '' })),
  };
}

/** Aktiv nå eller starter innen horisonten (24 t). Uten perioder regnes avviket som aktivt. */
export function isRelevant(situation, now, horizonMs = 24 * 3600_000) {
  const periods = situation.validity;
  if (!periods || !periods.length) return true;
  return periods.some((p) => (p.start == null || p.start <= now + horizonMs) && (p.end == null || p.end > now));
}

function firstCode(s) {
  const code = s.lines?.[0]?.code;
  return code == null || code === '' ? null : String(code);
}

/** Alvorlighet, så første linjekode (numerisk der mulig), så id. */
export function compareSituations(a, b) {
  const d = rank(a.severity) - rank(b.severity);
  if (d) return d;
  const ca = firstCode(a);
  const cb = firstCode(b);
  if (ca !== cb) {
    if (ca === null) return 1;
    if (cb === null) return -1;
    const c = ca.localeCompare(cb, 'nb', { numeric: true });
    if (c) return c;
  }
  return a.id < b.id ? -1 : a.id > b.id ? 1 : 0;
}

function push(map, key, s) {
  const list = map.get(key);
  if (list) list.push(s);
  else map.set(key, [s]);
}

export function buildSituationIndex(situations) {
  const all = [...situations].sort(compareSituations);
  const byLine = new Map();
  const byStop = new Map();
  const byCodespace = new Map();
  for (const s of all) {
    push(byCodespace, s.codespace, s);
    for (const ref of new Set(s.lines.map((l) => l.ref))) push(byLine, ref, s);
    for (const id of new Set(s.stops.map((p) => p.id))) push(byStop, id, s);
  }
  return { all, byLine, byStop, byCodespace };
}

/** Regionens kodeområder pluss tog. */
export function situationsForRegion(index, region) {
  const codespaces = new Set([...(region.situationCodespaces || []), ...RAIL_CODESPACES]);
  return index.all.filter((s) => codespaces.has(s.codespace) && hasTargets(s));
}

/** Rammer avviket linjer eller holdeplasser? Uten mål gjelder det enkeltavganger og listes ikke. */
export const hasTargets = (s) => s.lines.length > 0 || s.stops.length > 0;

/** Avvik som kan listes per område (med linjer eller holdeplasser). */
export function listableSituations(index) {
  return index.all.filter(hasTargets);
}

/**
 * Oppslagsnøkler for en katalogelinje (Ruling 2): `refs` = katalogens `ref` og `<kodeområde>:Line:<kode>`,
 * `codes` = `<kodeområde>|<KODE>` som reserve når lineRef-en har en annen intern ID enn koden.
 * Kode omfatter aliaser, kodeområde omfatter CODESPACE_ALIASES (Vy-tog er NSB).
 */
export function lineRefKeys(line) {
  const codes = [line.code, ...(line.aliases || [])].map((c) => String(c ?? '').toUpperCase()).filter(Boolean);
  const spaces = [line.authority, ...(CODESPACE_ALIASES[line.authority] || [])];
  const refs = new Set(line.ref ? [line.ref] : []);
  const codeKeys = [];
  for (const sp of spaces) {
    for (const c of codes) {
      refs.add(`${sp}:Line:${c}`);
      codeKeys.push(`${sp}|${c}`);
    }
  }
  return { refs: [...refs], codes: codeKeys };
}

/** Avvik for en katalogelinje, se lineRefKeys. */
export function situationsForLine(index, line) {
  const { refs, codes } = lineRefKeys(line);
  const wanted = new Set(codes);
  const seen = new Map();
  for (const ref of refs) for (const s of index.byLine.get(ref) || []) seen.set(s.id, s);
  for (const sp of new Set(codes.map((k) => k.split('|')[0]))) {
    for (const s of index.byCodespace.get(sp) || []) {
      if (!seen.has(s.id) && s.lines.some((l) => wanted.has(`${sp}|${String(l.code ?? '').toUpperCase()}`))) seen.set(s.id, s);
    }
  }
  return [...seen.values()].sort(compareSituations);
}

/** Union av avvik for flere quay-/stopPlace-ID-er, uten duplikater. */
export function situationsForStop(index, ids) {
  const seen = new Set();
  const out = [];
  for (const id of ids) {
    for (const s of index.byStop.get(id) || []) {
      if (!seen.has(s.id)) {
        seen.add(s.id);
        out.push(s);
      }
    }
  }
  return out.sort(compareSituations);
}

export const countsTowardBadge = (s) => s.severity !== 'noImpact';
