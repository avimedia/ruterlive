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

/** Retning mot sentrum i en overskrift («mot sentrum», «retning sentrum»), ikke «fra sentrum». */
const TOWARDS_CENTRE = /\b(mot|retning|til)\s+(oslo\s+)?sentrum\b/i;
/** Destinasjoner som betyr «mot sentrum» når quayen mangler retning. */
const CENTRE_DESTINATIONS = /^(oslo\s+s|jernbanetorget|nationaltheatret|stortinget|oslo bussterminal|(oslo\s+)?sentrum)\b/i;

const natural = (a, b) => String(a).localeCompare(String(b), 'nb', { numeric: true, sensitivity: 'base' });

function frontText(c) {
  return String(c?.destinationDisplay?.frontText ?? '').trim();
}

/** De vanligste destinasjonene (maks to) fra en quay, til overskrift når quayen mangler retning. */
export function destinationsOf(calls, max = 2) {
  const count = new Map();
  for (const c of calls) {
    const d = frontText(c);
    if (d) count.set(d, (count.get(d) ?? 0) + 1);
  }
  return [...count.entries()].sort((a, b) => b[1] - a[1]).slice(0, max).map(([d]) => d);
}

/**
 * Avganger gruppert per retning. Quays uten description og plattform får «Mot X, Y» ut fra
 * destinasjonene når stedet har flere quays, så to retninger på en vanlig holdeplass blir to grupper.
 * Fast rekkefølge: mot sentrum først (når det kan sees), så plattform/spor, så retningsnavn, så quay-ID.
 * @param {object[]} calls estimatedCalls (med quayId)
 * @param {{ id, publicCode?, description? }[]} quays
 * @returns {{ header: string|null, calls: object[] }[]}
 */
export function groupDepartures(calls, quays = []) {
  const sorted = (calls ?? []).filter((c) => depTime(c) > 0).sort((a, b) => depTime(a) - depTime(b));
  const byId = new Map((quays ?? []).map((q) => [q.id, q]));
  const callsByQuay = new Map();
  for (const c of sorted) {
    if (!callsByQuay.has(c.quayId)) callsByQuay.set(c.quayId, []);
    callsByQuay.get(c.quayId).push(c);
  }
  const multi = callsByQuay.size > 1;
  const groups = new Map();
  for (const [quayId, list] of callsByQuay) {
    const quay = byId.get(quayId);
    const explicit = quayHeader(quay, [...new Set(list.map(callMode))]);
    const dests = explicit || !multi ? [] : destinationsOf(list);
    const header = explicit ?? (dests.length ? `Mot ${dests.join(', ')}` : '');
    const centre = explicit ? TOWARDS_CENTRE.test(explicit) : dests.some((d) => CENTRE_DESTINATIONS.test(d));
    const code = String(quay?.publicCode ?? '').trim();
    let g = groups.get(header);
    if (!g) {
      g = { header, explicit: Boolean(explicit), centre, code, quayId: String(quayId ?? ''), calls: [] };
      groups.set(header, g);
    }
    g.centre ||= centre;
    if (code && (!g.code || natural(code, g.code) < 0)) g.code = code;
    if (natural(String(quayId ?? ''), g.quayId) < 0) g.quayId = String(quayId ?? '');
    g.calls.push(...list);
  }
  if (groups.size <= 1) return sorted.length ? [{ header: null, calls: flatSelection(sorted) }] : [];
  const perGroup = groups.size <= 2 ? 5 : groups.size <= 4 ? 3 : 2;
  return [...groups.values()]
    .sort(
      (a, b) =>
        (a.header === '' ? -1 : b.header === '' ? 1 : 0) ||
        Number(b.centre) - Number(a.centre) ||
        (a.code && b.code ? natural(a.code, b.code) : a.code ? -1 : b.code ? 1 : 0) ||
        (a.explicit && b.explicit ? natural(a.header, b.header) : 0) ||
        natural(a.quayId, b.quayId)
    )
    .map((g) => ({ header: g.header || null, calls: g.calls.sort((x, y) => depTime(x) - depTime(y)).slice(0, perGroup) }));
}
