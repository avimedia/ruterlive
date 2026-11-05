/**
 * Kodeområder for avvik (SIRI SX), gruppert i områder med norske navn.
 * Brukes av /avvik, regionfilteret og kartets avviksknapp (js/situations.js). Ukjente kodeområder havner i «Andre».
 */

// Kodeområder som regnes som tog og vises i alle regioner
export const RAIL_CODESPACES = Object.freeze(['VYG', 'GOA', 'SJN', 'FLT', 'BNR', 'NSB']);

// Kodeområder en linjes avvik kan ligge under i tillegg til linjens eget (Vy-tog meldes som NSB)
export const CODESPACE_ALIASES = Object.freeze({ VYG: ['NSB'] });

export const SITUATION_AREAS = Object.freeze([
  { id: 'rail', name: 'Tog', codespaces: RAIL_CODESPACES },
  { id: 'RUT', name: 'Ruter (Oslo og Akershus)', codespaces: ['RUT'] },
  { id: 'SKY', name: 'Skyss (Vestland)', codespaces: ['SKY'] },
  { id: 'ATB', name: 'AtB (Trøndelag)', codespaces: ['ATB'] },
  { id: 'KOL', name: 'Kolumbus (Rogaland)', codespaces: ['KOL'] },
  { id: 'AKT', name: 'AKT (Agder)', codespaces: ['AKT'] },
  { id: 'VKT', name: 'Vestfold og Telemark', codespaces: ['VKT', 'TEL'] },
  { id: 'INN', name: 'Innlandstrafikk (Innlandet)', codespaces: ['INN'] },
  { id: 'BRA', name: 'Brakar (Buskerud)', codespaces: ['BRA'] },
  { id: 'OST', name: 'Østfold', codespaces: ['OST'] },
  { id: 'MOR', name: 'Møre og Romsdal', codespaces: ['MOR'] },
  { id: 'TRO', name: 'Troms', codespaces: ['TRO'] },
  { id: 'VY', name: 'Vy Buss og Vy Express', codespaces: ['VYB', 'VYX'] },
  { id: 'other', name: 'Andre', codespaces: [] },
]);

const OTHER = SITUATION_AREAS.find((a) => a.id === 'other');

/** Området et kodeområde hører til; ukjente gir «Andre». */
export function areaFor(codespace) {
  return SITUATION_AREAS.find((a) => a.codespaces.includes(codespace)) || OTHER;
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

/** Om avviket gjelder linja med nøklene fra lineRefKeys: lineRef, eller avvikets kodeområde + kode. */
export function situationOnLine(s, { refs, codes }) {
  const refSet = refs instanceof Set ? refs : new Set(refs);
  const codeSet = codes instanceof Set ? codes : new Set(codes);
  return (s?.lines || []).some((l) => refSet.has(l.ref)
    || codeSet.has(`${s.codespace}|${String(l.code ?? '').toUpperCase()}`));
}
