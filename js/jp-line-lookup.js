/**
 * Slår opp ruteinfo (fra/til/via) for linjer som ikke finnes i SIRI ET, f.eks. flybuss.
 * Bruker Entur Journey Planner trip-søk for å hente stopp.
 */

const JP_GRAPHQL_URL = '/api/entur-jp/graphql';
const CLIENT_NAME = 'ruterlive-web';

const cache = new Map(); // key: "lineCode|destKey" -> { from, to, via }

// Kjente endepunkter for linjer utenfor RUT ET (flybuss m.m.)
const LINE_ENDPOINTS = {
  FB1: [
    { from: 'Oslo Bussterminal', to: 'Oslo lufthavn' },
    { from: 'Oslo lufthavn', to: 'Oslo Bussterminal' },
  ],
  FB2: [
    { from: 'Oslo Bussterminal', to: 'Oslo lufthavn' },
    { from: 'Oslo lufthavn', to: 'Oslo Bussterminal' },
  ],
  FB3: [
    { from: 'Oslo Bussterminal', to: 'Oslo lufthavn' },
    { from: 'Oslo lufthavn', to: 'Oslo Bussterminal' },
  ],
  FB4: [
    { from: 'Oslo Bussterminal', to: 'Oslo lufthavn' },
    { from: 'Oslo lufthavn', to: 'Oslo Bussterminal' },
  ],
  FB5: [
    { from: 'Oslo Bussterminal', to: 'Oslo lufthavn' },
    { from: 'Oslo lufthavn', to: 'Oslo Bussterminal' },
  ],
  FB9: [
    { from: 'Oslo Bussterminal', to: 'Oslo lufthavn' },
    { from: 'Oslo lufthavn', to: 'Oslo Bussterminal' },
  ],
};

function norm(s) {
  return (s || '').toLowerCase().replace(/\s+/g, ' ').trim();
}

function destMatches(destinationName, toName) {
  if (!destinationName) return true;
  const d = norm(destinationName);
  const t = norm(toName);
  if (d.includes('gardermoen') || d.includes('oslo lufthavn') || d.includes('osl')) {
    return t.includes('lufthavn') || t.includes('gardermoen') || t.includes('osl');
  }
  if (d.includes('oslo') && !d.includes('lufthavn')) {
    return t.includes('oslo') && !t.includes('lufthavn');
  }
  return d.includes(t) || t.includes(d);
}

function buildTripQuery(fromPlace, toPlace) {
  const dateTime = new Date().toISOString().slice(0, 19);
  return {
    query: `query Trip($from: InputCoordinatesOrNamedPlace!, $to: InputCoordinatesOrNamedPlace!, $dateTime: DateTime) {
  trip(
    from: $from
    to: $to
    dateTime: $dateTime
    numTripPatterns: 5
    modes: { transportModes: [bus, coach] }
  ) {
    tripPatterns {
      legs {
        mode
        line { publicCode transportMode }
        fromPlace { name }
        toPlace { name }
        intermediateEstimatedCalls {
          quay { name }
        }
      }
    }
  }
}`,
    variables: {
      from: fromPlace,
      to: toPlace,
      dateTime,
    },
  };
}

/**
 * Henter fra/to/via for en linje via JP trip-søk.
 * @param {string} lineCode - f.eks. "FB1"
 * @param {string} destinationName - f.eks. "Oslo Lufthavn"
 * @param {{ lat?: number, lon?: number }} [options] - kjøretøyposisjon for generisk søk
 * @returns {Promise<{ from: string, to: string, via: string | null } | null>}
 */
export async function fetchLineRouteFromJp(lineCode, destinationName, options = {}) {
  const destKey = norm(destinationName).slice(0, 30);
  const posKey = options.lat && options.lon ? `${options.lat.toFixed(2)},${options.lon.toFixed(2)}` : '';
  const cacheKey = `${lineCode}|${destKey}|${posKey}`;
  if (cache.has(cacheKey)) return cache.get(cacheKey);

  const endpoints = LINE_ENDPOINTS[lineCode?.toUpperCase()];
  if (endpoints) {
    for (const { from, to } of endpoints) {
      if (destinationName && !destMatches(destinationName, to)) continue;
      const result = await runTripQuery({ name: from }, { name: to }, lineCode);
      if (result) {
        cache.set(cacheKey, result);
        return result;
      }
    }
    for (const { from, to } of endpoints) {
      const result = await runTripQuery({ name: from }, { name: to }, lineCode);
      if (result) {
        cache.set(cacheKey, result);
        return result;
      }
    }
  }

  if (destinationName && options.lat != null && options.lon != null) {
    const result = await runTripQuery(
      { coordinates: { latitude: options.lat, longitude: options.lon } },
      { name: destinationName },
      lineCode
    );
    if (result) {
      cache.set(cacheKey, result);
      return result;
    }
  }
  return null;
}

async function runTripQuery(fromPlace, toPlace, filterLineCode) {
  try {
    const body = buildTripQuery(fromPlace, toPlace);
    const res = await fetch(JP_GRAPHQL_URL, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'ET-Client-Name': CLIENT_NAME,
      },
      body: JSON.stringify(body),
    });
    const data = await res.json();
    const patterns = data?.data?.trip?.tripPatterns;
    if (!patterns?.length) return null;

    const fromName = fromPlace?.name ?? '';
    const toName = toPlace?.name ?? '';
    for (const p of patterns) {
      for (const leg of p.legs || []) {
        const code = leg?.line?.publicCode || '';
        if (filterLineCode && code.toUpperCase() !== filterLineCode.toUpperCase()) continue;
        const from = leg.fromPlace?.name || fromName;
        const to = leg.toPlace?.name || toName;
        const calls = leg.intermediateEstimatedCalls || [];
        const midIdx = Math.floor(calls.length / 2);
        const via = calls[midIdx]?.quay?.name || null;
        if (from && to) return { from, to, via };
      }
    }
    const first = patterns[0];
    const leg = first?.legs?.[0];
    if (leg) {
      return {
        from: leg.fromPlace?.name || fromName,
        to: leg.toPlace?.name || toName,
        via: leg.intermediateEstimatedCalls?.[0]?.quay?.name || null,
      };
    }
  } catch (err) {
    if (import.meta.env.DEV) console.warn('[RuterLive] JP line lookup:', err.message);
  }
  return null;
}

