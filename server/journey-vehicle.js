/**
 * Hvilket kjøretøy kjører en gitt tur (serviceJourney.id fra avgangstavla)?
 * Slås opp i data serveren alt har: GPS-kjøretøy (journeyIds) og ET-turer (DatedVehicleJourneyRef
 * er samme id som i Journey Planner). Ingen kall mot Entur.
 */

export const SERVICE_JOURNEY_RE = /^[A-Z]{2,5}:ServiceJourney:[A-Za-z0-9_\-.:]{1,100}$/;

/**
 * @param {string} sj serviceJourney.id
 * @param {{ gps: object[][], etJourneys: object[] }} sources GPS-lister og ET-turer
 * @returns {string|null} vehicleId slik den brukes i /api/vehicles-live
 */
export function findJourneyVehicle(sj, { gps = [], etJourneys = [] } = {}) {
  for (const list of gps) {
    for (const v of list || []) {
      if (v.journeyIds?.includes(sj)) return v.vehicleId;
    }
  }
  // ET har flere turer per fysisk kjøretøy med samme VehicleRef, så en senere tur gir bussen
  // som kjører nå (vehicleId er VehicleRef når den finnes)
  for (const j of etJourneys || []) {
    if (j.datedVehicleJourneyRef === sj) return j.vehicleId;
  }
  return null;
}
