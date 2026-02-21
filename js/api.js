const POLL_MS = 20000;
const POLL_BACKOFF_MS = 45000; // Ved 502/503: lengre intervall for å ikke spamme
const RETRY_DELAYS = [2000, 4000, 8000]; // Backoff ved 502/503 (cold start)
const OSLO_BOUNDS = { minLat: 59.45, maxLat: 60.2, minLon: 10.15, maxLon: 11.25 };

// I prod: cached. I dev: direkte proxy (Vite har ikke cache)
const VEHICLES_URL = import.meta.env.DEV ? '/api/entur/graphql' : '/api/vehicles-cached';

let pollInterval = null;
let consecutiveErrors = 0;

function parseVehicles(data) {
  const vehicles = data?.data?.vehicles ?? [];
  return Array.isArray(vehicles) ? vehicles : [vehicles];
}

function buildQuery(bounds) {
  const b = bounds || OSLO_BOUNDS;
  return `{ vehicles(boundingBox: { minLat: ${b.minLat}, maxLat: ${b.maxLat}, minLon: ${b.minLon}, maxLon: ${b.maxLon} }) { vehicleId lastUpdated location { latitude longitude } line { publicCode } mode bearing destinationName } }`;
}

function isRetryable(status) {
  return status === 502 || status === 503;
}

function delay(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

async function fetchVehicles(bounds, onVehicles, onError) {
  let lastErr = null;
  for (let attempt = 0; attempt <= RETRY_DELAYS.length; attempt++) {
    try {
      const res = import.meta.env.DEV
        ? await fetch(VEHICLES_URL, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', 'ET-Client-Name': 'ruterlive-web' },
            body: JSON.stringify({ query: buildQuery(bounds) }),
          })
        : await fetch(VEHICLES_URL);

      if (!res.ok) {
        if (isRetryable(res.status) && attempt < RETRY_DELAYS.length) {
          onError?.(
            res.status === 502
              ? 'Serveren våkner opp – vent et øyeblikk'
              : 'Tett trafikk mot server – prøver igjen'
          );
          await delay(RETRY_DELAYS[attempt]);
          continue;
        }
        throw new Error(`API ${res.status}: ${res.statusText}`);
      }

      const data = await res.json();
      if (data.errors) {
        console.error('GraphQL errors:', data.errors);
        onError?.(data.errors[0]?.message || 'API-feil');
        return;
      }
      const vehicles = parseVehicles(data);
      consecutiveErrors = 0;
      onVehicles(vehicles);
      onError?.(null);
      return;
    } catch (err) {
      lastErr = err;
      const statusMatch = /(\d{3})/.exec(err.message || '');
      const status = statusMatch ? parseInt(statusMatch[1], 10) : 0;
      if (isRetryable(status) && attempt < RETRY_DELAYS.length) {
        onError?.('Serveren våkner opp – vent et øyeblikk');
        await delay(RETRY_DELAYS[attempt]);
        continue;
      }
      break;
    }
  }
  consecutiveErrors++;
  console.error('Fetch vehicles error:', lastErr);
  onError?.(lastErr?.message || 'Kunne ikke hente kjøretøy');
}

function scheduleNextPoll(bounds, onVehicles, onError) {
  const interval = consecutiveErrors > 0 ? POLL_BACKOFF_MS : POLL_MS;
  pollInterval = setTimeout(() => {
    fetchVehicles(bounds, onVehicles, onError).then(() => {
      scheduleNextPoll(bounds, onVehicles, onError);
    });
  }, interval);
}

export function connectVehicles(boundingBox, onVehicles, onError) {
  disconnect();
  const bounds = boundingBox || OSLO_BOUNDS;
  fetchVehicles(bounds, onVehicles, onError).then(() => {
    scheduleNextPoll(bounds, onVehicles, onError);
  });
  return () => disconnect();
}

export function disconnect() {
  if (pollInterval) {
    clearTimeout(pollInterval);
    pollInterval = null;
  }
}
