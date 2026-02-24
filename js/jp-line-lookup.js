/**
 * Slår opp ruteinfo (fra/til/via) for linjer som ikke finnes i SIRI ET, f.eks. flybuss.
 * Bruker Entur Journey Planner trip-søk for å hente stopp.
 */

const JP_GRAPHQL_URL = '/api/entur-jp/graphql';
const CLIENT_NAME = 'ruterlive-web';

const cache = new Map(); // key: "lineCode|destKey" -> { from, to, via }

function norm(s) {
  return (s || '').toLowerCase().replace(/\s+/g, ' ').trim();
}

function buildTripQuery(fromPlace, toPlace, useRail = false) {
  const dateTime = new Date().toISOString().slice(0, 19);
  const modesStr = useRail ? '[rail]' : '[bus, coach]';
  return {
    query: `query Trip($from: InputCoordinatesOrNamedPlace!, $to: InputCoordinatesOrNamedPlace!, $dateTime: DateTime) {
  trip(
    from: $from
    to: $to
    dateTime: $dateTime
    numTripPatterns: 5
    modes: { transportModes: ${modesStr} }
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

  if (destinationName && options.lat != null && options.lon != null) {
    const result = await runTripQuery(
      { coordinates: { latitude: options.lat, longitude: options.lon } },
      { name: destinationName },
      lineCode,
      /^(R|L|F)\d*$/i.test(lineCode)
    );
    if (result) {
      cache.set(cacheKey, result);
      return result;
    }
  }
  if (destinationName && /^(R|L|F)\d*$/i.test(lineCode)) {
    const toOslo = /oslo\s*s|jernbanetorget/i.test(destinationName);
    const fromPlace = toOslo ? { name: 'Drammen' } : { name: 'Oslo S' };
    const toPlace = toOslo ? { name: 'Oslo S' } : { name: destinationName };
    const result = await runTripQuery(fromPlace, toPlace, lineCode, true);
    if (result) {
      cache.set(cacheKey, result);
      return result;
    }
  }
  if (destinationName && /^(FB|NW)\d*$/i.test(lineCode)) {
    const toLufthavn = /lufthavn|gardermoen|osl/i.test(destinationName);
    const result = toLufthavn
      ? await runTripQuery({ name: 'Oslo Bussterminal' }, { name: 'Oslo lufthavn' }, lineCode)
      : await runTripQuery({ name: 'Oslo lufthavn' }, { name: 'Oslo Bussterminal' }, lineCode);
    if (result) {
      cache.set(cacheKey, result);
      return result;
    }
  }
  return null;
}

async function runTripQuery(fromPlace, toPlace, filterLineCode, useRail = false) {
  try {
    const body = buildTripQuery(fromPlace, toPlace, useRail);
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

