/**
 * Kodeområder for avvik (SIRI SX), gruppert i områder med norske navn.
 * Brukes av /avvik og av regionfilteret. Ukjente kodeområder havner i «Andre».
 */

// Kodeområder som regnes som tog og vises i alle regioner
export const RAIL_CODESPACES = Object.freeze(['VYG', 'GOA', 'SJN', 'FLT', 'BNR', 'NSB']);

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
