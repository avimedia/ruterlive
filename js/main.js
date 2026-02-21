import { initMap } from './map.js';
import { connectVehicles } from './api.js';
import { fetchEstimatedVehicles } from './et-api.js';
import { updateMarkers, applyFilter, getVehicleCounts } from './markers.js';
import { initLayers, getVisibleModes, updateVehicleCount } from './layers.js';
import { updateRouteLines } from './routes.js';

let graphqlVehicles = [];
let etVehicles = [];
let routeShapes = [];
let etLoaded = false;

function mergeAndUpdate() {
  const merged = [...graphqlVehicles];
  const seenIds = new Set(graphqlVehicles.map((v) => v.vehicleId));
  for (const v of etVehicles) {
    if (!seenIds.has(v.vehicleId)) {
      seenIds.add(v.vehicleId);
      merged.push(v);
    }
  }
  const visibleModes = getVisibleModes();
  updateMarkers(merged, visibleModes);
  updateVehicleCount(getVehicleCounts(merged), null, !etLoaded);
  updateRouteLines(routeShapes, visibleModes);
}

initMap();
initLayers((visibleModes) => {
  applyFilter(visibleModes);
  updateRouteLines(routeShapes, visibleModes);
});

updateVehicleCount(null, null, true);

connectVehicles(
  null,
  (vehicles) => {
    graphqlVehicles = vehicles;
    mergeAndUpdate();
  },
  (error) => {
    updateVehicleCount(null, error, false);
  }
);

// Hent beregnede posisjoner og rutelinjer fra SIRI ET hvert 30. sekund
async function pollEt() {
  const result = await fetchEstimatedVehicles();
  etVehicles = result.vehicles ?? result;
  routeShapes = result.routeShapes ?? [];
  etLoaded = true;
  mergeAndUpdate();
}
pollEt();
setInterval(pollEt, 30000);
