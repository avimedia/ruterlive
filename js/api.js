// Bruk alltid proxy (Vite i dev, Express i prod) – unngår CORS og hjelper med dårlig båndbredde
const GRAPHQL_URL = '/api/entur/graphql';
const CLIENT_NAME = 'ruterlive-web';

// Stor-Oslo: dekker Oslo, Akershus, Lillestrøm, Drammen-området, Ski, Nesodden
const OSLO_BOUNDS = {
  minLat: 59.45,
  maxLat: 60.2,
  minLon: 10.15,
  maxLon: 11.25,
};

// Inline boundingBox (BoundingBoxInput type causes validation error)
function buildVehiclesQuery(bounds) {
  const b = bounds || OSLO_BOUNDS;
  return `{
  vehicles(boundingBox: { minLat: ${b.minLat}, maxLat: ${b.maxLat}, minLon: ${b.minLon}, maxLon: ${b.maxLon} }) {
    vehicleId
    lastUpdated
    location { latitude longitude }
    line { publicCode }
    mode
    bearing
    destinationName
  }
}`;
}

let pollInterval = null;

function parseVehicles(data) {
  const vehicles = data?.data?.vehicles ?? [];
  return Array.isArray(vehicles) ? vehicles : [vehicles];
}

async function fetchVehicles(boundingBox, onVehicles, onError) {
  try {
    const res = await fetch(GRAPHQL_URL, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'ET-Client-Name': CLIENT_NAME,
      },
      body: JSON.stringify({
        query: buildVehiclesQuery(boundingBox),
      }),
    });

    if (!res.ok) {
      throw new Error(`API ${res.status}: ${res.statusText}`);
    }

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
  // Stop existing connections
  disconnect();

  const bounds = boundingBox || OSLO_BOUNDS;

  // HTTP polling every 10 seconds (reliable, avoids WebSocket issues)
  fetchVehicles(bounds, onVehicles, onError);
  pollInterval = setInterval(
    () => fetchVehicles(bounds, onVehicles, onError),
    10000
  );

  return () => disconnect();
}

export function disconnect() {
  if (pollInterval) {
    clearInterval(pollInterval);
    pollInterval = null;
  }
}
