/**
 * Rydder GPS-kjøretøy fra Entur Vehicles API (brukes av server og klient).
 * - Mangler publicCode (f.eks. buss for tog, GOA:Line:50B), brukes siste ledd i lineRef.
 * - Samme vehicleId kommer én gang per tur (forrige og neste); behold én: med destinasjon, ellers sist oppdatert.
 */

function withLineCode(v) {
  const line = v.line || {};
  if (line.publicCode || !line.lineRef) return v;
  const code = String(line.lineRef).split(':').pop();
  return code ? { ...v, line: { ...line, publicCode: code } } : v;
}

function isBetter(a, b) {
  if (Boolean(a.destinationName) !== Boolean(b.destinationName)) return Boolean(a.destinationName);
  return String(a.lastUpdated || '') > String(b.lastUpdated || '');
}

export function normalizeGpsVehicles(vehicles) {
  if (!Array.isArray(vehicles)) return [];
  const byId = new Map();
  for (const raw of vehicles) {
    if (!raw?.vehicleId) continue;
    const v = withLineCode(raw);
    const existing = byId.get(v.vehicleId);
    if (!existing || isBetter(v, existing)) byId.set(v.vehicleId, v);
  }
  return [...byId.values()];
}
