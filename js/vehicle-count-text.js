/**
 * Oppsummeringstekst for antall kjøretøy per type, med riktig entall/flertall.
 */

const MODE_NOUNS = [
  ['bus', 'buss', 'busser'],
  ['flybuss', 'flybuss', 'flybusser'],
  ['metro', 'T-banetog', 'T-banetog'],
  ['tram', 'trikk', 'trikker'],
  ['water', 'båt', 'båter'],
  ['rail', 'tog', 'tog'],
  ['flytog', 'flytog', 'flytog'],
];

export function formatVehicleCounts(counts) {
  const total = counts?.total ?? 0;
  const parts = MODE_NOUNS.filter(([mode]) => counts?.[mode] > 0).map(
    ([mode, singular, plural]) => `${counts[mode]} ${counts[mode] === 1 ? singular : plural}`
  );
  return parts.length > 0 ? `${total} kjøretøy: ${parts.join(', ')}` : `${total} kjøretøy`;
}
