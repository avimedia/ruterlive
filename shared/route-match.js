/**
 * Finner fra/til/via for et GPS-kjøretøy fra kjente rutekart (jernbane, flybuss, ET).
 * Brukes av serveren (/api/vehicles-live), så nettleseren slipper egne Journey Planner-søk.
 * Ren funksjon, ingen avhengigheter.
 */

// GPS-feeden sier RAIL/BUS, rutekartene flytog/flybuss: sammenlign på modusfamilie
const FAMILY = { rail: 'rail', flytog: 'rail', bus: 'bus', coach: 'bus', flybuss: 'bus' };
const family = (m) => {
  const k = (m || '').toLowerCase();
  return FAMILY[k] || k;
};

const normDest = (d) => (d || '').toLowerCase().replace(/\s+(stasjon|holdeplass|st\.?)$/i, '').trim();
const overlaps = (a, b) => !!a && !!b && (a.includes(b) || b.includes(a));

/**
 * @param {{ line?: { publicCode?: string }, mode?: string, destinationName?: string }} vehicle
 * @param {Array<{ mode?: string, line?: string, from?: string, to?: string, via?: string }>} shapes
 * @returns {{ from: string, to: string, via: string|null } | null}
 */
export function matchRouteForVehicle(vehicle, shapes) {
  const line = String(vehicle?.line?.publicCode ?? '');
  if (!line || !Array.isArray(shapes) || shapes.length === 0) return null;
  const fam = family(vehicle.mode);
  const dest = normDest(vehicle.destinationName);
  const candidates = shapes.filter(
    (s) => String(s.line ?? '') === line && (!s.mode || !fam || family(s.mode) === fam)
  );
  if (candidates.length === 0) return null;
  // Bare rute som ender ved destinasjonen: en annen rute på samme linje gir lett feil retning
  const match = !dest ? candidates[0] : candidates.find((s) => overlaps(dest, normDest(s.to)));
  if (!match || !match.from || !match.to) return null;
  return { from: match.from, to: match.to, via: match.via ?? null };
}
