// Felles logikk for ET-turer (brukes av både server og klient):
// stabil kjøretøy-id og utvelgelse av én tur per kjøretøy.

/**
 * Stabil id for en tur/kjøretøy. Bruker VehicleRef hvis satt, ellers
 * DatedVehicleJourneyRef, ellers en id utledet fra linje, første stopp og tid
 * (aldri listeindeks, siden den endrer seg mellom oppdateringer).
 */
export function journeyVehicleId({ vehicleRef, datedVehicleJourneyRef, lineRef, firstQuayId, firstTime }) {
  if (vehicleRef) return vehicleRef;
  if (datedVehicleJourneyRef) return `et-${datedVehicleJourneyRef}`;
  return `et-${lineRef}-${firstQuayId}-${firstTime}`;
}

function firstDeparture(j) {
  const c = j.estimatedCalls[0];
  return c ? (c.depTime || c.arrTime) : Infinity;
}

function lastRecordedTime(j) {
  const c = j.recordedCalls[j.recordedCalls.length - 1];
  return c ? c.time : -Infinity;
}

function isUnderway(j, now) {
  return j.recordedCalls.length > 0 || firstDeparture(j) <= now;
}

/**
 * Velger hvilke turer som skal bli kjøretøy: fjerner fullførte turer og
 * beholder bare én tur per kjøretøy-id (turen i gang, ellers den som starter først).
 */
export function selectJourneysForVehicles(journeys, now) {
  const best = new Map();
  for (const j of journeys) {
    if (j.estimatedCalls.length === 0) continue;
    const cur = best.get(j.vehicleId);
    if (!cur) {
      best.set(j.vehicleId, j);
      continue;
    }
    const jGoing = isUnderway(j, now);
    const curGoing = isUnderway(cur, now);
    let replace;
    if (jGoing !== curGoing) replace = jGoing;
    else if (jGoing) replace = lastRecordedTime(j) > lastRecordedTime(cur);
    else replace = firstDeparture(j) < firstDeparture(cur);
    if (replace) best.set(j.vehicleId, j);
  }
  return [...best.values()];
}
