/**
 * Slår sammen holdeplassmarkører med samme navn som ligger tett (én markør per stasjon i stedet for
 * én per plattform/spor/quay). Rene funksjoner uten Leaflet, brukt av js/routes.js.
 */

/** Maks avstand (meter) til nærmeste stopp i gruppen. 120 m samler f.eks. Nationaltheatret stasjon og T-banen/trikken. */
export const GROUP_LINK_M = 120;
/** Maks avstand (meter) fra gruppens første stopp, så like navn langs en gate ikke lenkes i det uendelige. */
export const GROUP_MAX_SPAN_M = 400;

const M_PER_DEG = 111320;

const PLATFORM_SUFFIX = /[\s,–-]+(spor|plattform|platform|perrong)\s*[\w]{0,3}$/i;

/** Navn til visning: uten « [4311]» og «spor 3»/«plattform B» til slutt. */
export function displayStopName(name) {
  const raw = String(name ?? '').replace(/\s+/g, ' ').trim();
  let s = raw, prev;
  do {
    prev = s;
    s = s.replace(/\s*\[[^\]]*\]$/, '').replace(PLATFORM_SUFFIX, '').trim();
  } while (s !== prev && s);
  return s || raw;
}

/** Sammenligningsnøkkel: visningsnavn i små bokstaver, uten «stasjon» og tall til slutt. */
export function normalizeStopName(name) {
  let s = displayStopName(name).toLocaleLowerCase('nb'), prev;
  do {
    prev = s;
    s = s.replace(/\s+(stasjon|st\.)$/, '').replace(/\s+\d{1,3}[a-z]?$/, '').trim();
  } while (s !== prev && s);
  return s;
}

function distM(aLat, aLon, bLat, bLon) {
  const k = Math.cos(((aLat + bLat) / 2) * (Math.PI / 180));
  return Math.hypot((bLon - aLon) * k * M_PER_DEG, (bLat - aLat) * M_PER_DEG);
}

/**
 * Grupperer stopp { lat, lon, name, quayId?, ... } med likt normalisert navn innenfor GROUP_LINK_M
 * av et stopp i gruppen (og GROUP_MAX_SPAN_M fra det første). Stopp uten navn får egen gruppe.
 * Rekkefølgen bevares: gruppen arver det første stoppets egenskaper (farge osv.); navnet er det
 * korteste visningsnavnet i gruppen («Nationaltheatret» foran «Nationaltheatret stasjon»).
 * @returns {{ lat: number, lon: number, name: string, quayIds: string[], first: object, members: object[] }[]}
 */
export function groupStops(stops, linkM = GROUP_LINK_M, maxSpanM = GROUP_MAX_SPAN_M) {
  const groups = [];
  const byName = new Map(); // normalisert navn -> grupper
  for (const st of stops ?? []) {
    if (!st || !Number.isFinite(st.lat) || !Number.isFinite(st.lon)) continue;
    const key = st.name ? normalizeStopName(st.name) : '';
    let group = null;
    if (key) {
      // Alle grupper stoppet kan lenkes til; binder det sammen flere, slås de sammen (enkel lenking)
      const list = byName.get(key) ?? [];
      for (let i = 0; i < list.length; i++) {
        const g = list[i];
        if (distM(g.first.lat, g.first.lon, st.lat, st.lon) > maxSpanM) continue;
        if (!g.members.some((m) => distM(m.lat, m.lon, st.lat, st.lon) <= linkM)) continue;
        if (!group) {
          group = g;
          continue;
        }
        for (const m of g.members) {
          group.members.push(m);
          if (m.quayId && !group.quayIds.includes(m.quayId)) group.quayIds.push(m.quayId);
        }
        g.merged = true;
        list.splice(i--, 1);
      }
    }
    if (!group) {
      group = { lat: 0, lon: 0, name: st.name ? displayStopName(st.name) : '', quayIds: [], first: st, members: [] };
      groups.push(group);
      if (key) {
        if (!byName.has(key)) byName.set(key, []);
        byName.get(key).push(group);
      }
    }
    group.members.push(st);
    if (st.quayId && !group.quayIds.includes(st.quayId)) group.quayIds.push(st.quayId);
  }
  const out = groups.filter((g) => !g.merged);
  for (const g of out) {
    let lat = 0, lon = 0;
    for (const m of g.members) {
      lat += m.lat;
      lon += m.lon;
    }
    g.lat = lat / g.members.length;
    g.lon = lon / g.members.length;
    for (const m of g.members) {
      const d = m.name ? displayStopName(m.name) : '';
      if (d && (!g.name || d.length < g.name.length)) g.name = d;
    }
  }
  return out;
}
