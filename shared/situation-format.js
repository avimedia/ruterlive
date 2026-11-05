/**
 * Tekster for avvik som både /avvik-siden (server) og kartets avvikspanel (js/situations-panel.js) bruker.
 * Ren modul: norsk dato og klokkeslett i Europe/Oslo.
 */

const TZ = 'Europe/Oslo';
const DAY_MS = 24 * 60 * 60 * 1000;

// Entur sine alvorlighetsgrader; «undefined» får ingen merkelapp
export const SEVERITY_LABEL = Object.freeze({
  verySevere: 'Svært alvorlig',
  severe: 'Alvorlig',
  normal: 'Normal',
  slight: 'Liten',
  noImpact: 'Ingen påvirkning',
});

const ESC = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' };
const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ESC[c]);

/** Merkelapp for en alvorlighetsgrad, eller null (ukjent, «undefined», arvede nøkler som «constructor»). */
export const severityLabel = (sev) => (typeof sev === 'string' && Object.hasOwn(SEVERITY_LABEL, sev) ? SEVERITY_LABEL[sev] : null);

/** Operatørtekst: escapet først; tom linje gir nytt avsnitt, enkelt linjeskift <br>. */
export const textHtml = (s, cls = '') => String(s).split(/\r?\n\s*\n/)
  .map((p) => p.trim()).filter(Boolean)
  .map((p) => `<p${cls ? ` class="${cls}"` : ''}>${esc(p).replace(/\r?\n/g, '<br>')}</p>`)
  .join('');

const dateFmt = new Intl.DateTimeFormat('nb-NO', { timeZone: TZ, day: 'numeric', month: 'short', year: 'numeric' });
const timeFmt = new Intl.DateTimeFormat('nb-NO', { timeZone: TZ, hour: '2-digit', minute: '2-digit', hourCycle: 'h23' });

function dateParts(ms) {
  const p = Object.fromEntries(dateFmt.formatToParts(new Date(ms)).map((x) => [x.type, x.value]));
  return { day: p.day, month: p.month, year: p.year };
}

/** «08.00» i Europe/Oslo. */
export const timeOf = (ms) => timeFmt.format(new Date(ms)).replace(':', '.');

const sameDay = (a, b) => dateFmt.format(new Date(a)) === dateFmt.format(new Date(b));

/** «5. nov.», med år når det ikke er inneværende år. Med relative: «i dag» og «i morgen». */
function dayText(ms, now, relative) {
  if (relative && sameDay(ms, now)) return 'i dag';
  if (relative && sameDay(ms, now + DAY_MS)) return 'i morgen';
  const d = dateParts(ms);
  const year = d.year === dateParts(now).year ? '' : ` ${d.year}`;
  return `${d.day}. ${d.month}${year}`;
}

/**
 * «Gjelder fra 5. nov. kl. 08.00 til 20. nov.»; åpen slutt gir «inntil videre».
 * relative: true gir «i dag»/«i morgen» i stedet for datoen (kartpanelet).
 */
export function formatValidityPeriod({ start, end }, now, { relative = false } = {}) {
  if (start == null && end == null) return 'Gjelder inntil videre';
  if (start == null) return `Gjelder til ${dayText(end, now, relative)}`;
  const from = `Gjelder fra ${dayText(start, now, relative)} kl. ${timeOf(start)}`;
  if (end == null) return `${from} inntil videre`;
  return sameDay(start, end) ? `${from} til kl. ${timeOf(end)}` : `${from} til ${dayText(end, now, relative)}`;
}
