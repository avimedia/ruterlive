// Modusene holdeplassidene viser, delt av siden (etiketter) og stop-service (JP-filter).

/** Grunnmodus → etikett. JP-modusen coach vises som buss. */
export const MODE_LABEL = Object.freeze({ metro: 'T-bane', tram: 'Trikk', rail: 'Tog', bus: 'Buss', water: 'Båt' });

/** JP-moduser siden kan vise: etikettene + coach. Fly, taubane o.l. utelates. */
export const SHOWN_JP_MODES = Object.freeze([...Object.keys(MODE_LABEL), 'coach']);

/** Grunnmodus for en JP-modus (coach → bus), ellers '' for moduser siden ikke viser. */
export function baseMode(transportMode) {
  if (transportMode === 'coach') return 'bus';
  return Object.hasOwn(MODE_LABEL, transportMode) ? transportMode : '';
}
