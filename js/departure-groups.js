/**
 * Grupperer avganger per quay med retning som overskrift: description («Retning sentrum»),
 * ellers «Plattform A» (tog: «Spor 3»), ellers ingen overskrift. Quays med samme overskrift slås
 * sammen; én gruppe får ingen overskrift. Ren logikk, delt med testene.
 */

function capitalize(s) {
  return s ? s.charAt(0).toLocaleUpperCase('nb-NO') + s.slice(1) : s;
}

function callMode(c) {
  return (c?.serviceJourney?.journeyPattern?.line?.transportMode || 'bus').toLowerCase();
}

/** Overskrift for én quay; null når den ikke har retning eller plattform. */
export function quayHeader(quay, modes = []) {
  const desc = String(quay?.description ?? '').trim();
  if (desc) return capitalize(desc);
  const code = String(quay?.publicCode ?? '').trim();
  if (!code) return null;
  return modes.length > 0 && modes.every((m) => m === 'rail') ? `Spor ${code}` : `Plattform ${code}`;
}

function depTime(c) {
  const t = c.expectedDepartureTime || c.aimedDepartureTime;
  return t ? new Date(t).getTime() : 0;
}

/** Uten grupper: som før, maks 3 per modus og 10 totalt. */
function flatSelection(calls) {
  const byMode = new Map();
  for (const c of calls) {
    const list = byMode.get(callMode(c)) ?? [];
    if (list.length < 3) list.push(c);
    byMode.set(callMode(c), list);
  }
  return [...byMode.values()].flat().sort((a, b) => depTime(a) - depTime(b)).slice(0, 10);
}

/**
 * @param {object[]} calls estimatedCalls (med quayId)
 * @param {{ id, publicCode?, description? }[]} quays
 * @returns {{ header: string|null, calls: object[] }[]}
 */
export function groupDepartures(calls, quays = []) {
  const sorted = (calls ?? []).filter((c) => depTime(c) > 0).sort((a, b) => depTime(a) - depTime(b));
  const byId = new Map((quays ?? []).map((q) => [q.id, q]));
  const modesByQuay = new Map();
  for (const c of sorted) {
    const set = modesByQuay.get(c.quayId) ?? new Set();
    set.add(callMode(c));
    modesByQuay.set(c.quayId, set);
  }
  const groups = new Map();
  for (const c of sorted) {
    const header = quayHeader(byId.get(c.quayId), [...(modesByQuay.get(c.quayId) ?? [])]) ?? '';
    if (!groups.has(header)) groups.set(header, []);
    groups.get(header).push(c);
  }
  if (groups.size <= 1) return sorted.length ? [{ header: null, calls: flatSelection(sorted) }] : [];
  const perGroup = groups.size <= 2 ? 5 : groups.size <= 4 ? 3 : 2;
  return [...groups.entries()]
    .sort(([a], [b]) => (a === '' ? -1 : b === '' ? 1 : a.localeCompare(b, 'nb', { numeric: true })))
    .map(([header, list]) => ({ header: header || null, calls: list.slice(0, perGroup) }));
}
