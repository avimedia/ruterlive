const POLL_MS = 20000;
const OSLO_BOUNDS = { minLat: 59.45, maxLat: 60.2, minLon: 10.15, maxLon: 11.25 };

// I prod: cached. I dev: direkte proxy (Vite har ikke cache)
const VEHICLES_URL = import.meta.env.DEV ? '/api/entur/graphql' : '/api/vehicles-cached';

let pollInterval = null;

function parseVehicles(data) {
  const vehicles = data?.data?.vehicles ?? [];
  return Array.isArray(vehicles) ? vehicles : [vehicles];
}

function buildQuery(bounds) {
  const b = bounds || OSLO_BOUNDS;
  return `{ vehicles(boundingBox: { minLat: ${b.minLat}, maxLat: ${b.maxLat}, minLon: ${b.minLon}, maxLon: ${b.maxLon} }) { vehicleId lastUpdated location { latitude longitude } line { publicCode } mode bearing destinationName } }`;
}

async function fetchVehicles(bounds, onVehicles, onError) {
  try {
    const res = import.meta.env.DEV
      ? await fetch(VEHICLES_URL, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', 'ET-Client-Name': 'ruterlive-web' },
          body: JSON.stringify({ query: buildQuery(bounds) }),
        })
      : await fetch(VEHICLES_URL);

    if (!res.ok) throw new Error(`API ${res.status}: ${res.statusText}`);

    const data = await res.json();
    if (data.errors) {
      console.error('GraphQL errors:', data.errors);
      onError?.(data.errors[0]?.message || 'API-feil');
      return;
    }
    const vehicles = parseVehicles(data);
    onVehicles(vehicles);
    onError?.(null);
  } catch (err) {
    console.error('Fetch vehicles error:', err);
    onError?.(err.message);
  }
}

export function connectVehicles(boundingBox, onVehicles, onError) {
  disconnect();
  const bounds = boundingBox || OSLO_BOUNDS;
  fetchVehicles(bounds, onVehicles, onError);
  pollInterval = setInterval(() => fetchVehicles(bounds, onVehicles, onError), POLL_MS);
  return () => disconnect();
}

export function disconnect() {
  if (pollInterval) {
    clearInterval(pollInterval);
    pollInterval = null;
  }
}
