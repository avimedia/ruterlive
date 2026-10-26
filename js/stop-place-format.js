/**
 * Felles visning av stoppested i søkeresultat og avgangstavle: kommune, avstand og linjemerker
 * gruppert på modus. Ren logikk og HTML-strenger (ingen DOM), så testene kan bruke den.
 */

import { MODE_COLORS } from '../shared/line-list.js';

const MODE_ORDER = ['metro', 'tram', 'rail', 'flytog', 'flybuss', 'bus', 'water'];
/** Lyse modusfarger får mørk tekst. */
const DARK_TEXT = new Set(['tram']);

export function escapeHtml(s) {
  return String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
}

/** «850 m», «1,2 km», «24 km». */
export function formatDistance(km) {
  if (!Number.isFinite(km)) return '';
  if (km < 1) return `${Math.max(10, Math.round((km * 1000) / 10) * 10)} m`;
  if (km < 10) return `${km.toFixed(1).replace('.', ',')} km`;
  return `${Math.round(km)} km`;
}

/** [{ code, mode }] → [{ mode, codes }] i fast modusrekkefølge. */
export function groupLinesByMode(lines) {
  const by = new Map();
  for (const l of lines ?? []) {
    if (!l?.code) continue;
    const mode = l.mode || 'bus';
    if (!by.has(mode)) by.set(mode, []);
    if (!by.get(mode).includes(l.code)) by.get(mode).push(l.code);
  }
  const rank = (m) => (MODE_ORDER.includes(m) ? MODE_ORDER.indexOf(m) : MODE_ORDER.length);
  return [...by.entries()].sort((a, b) => rank(a[0]) - rank(b[0])).map(([mode, codes]) => ({ mode, codes }));
}

/**
 * Små linjemerker gruppert på modus. max: maks antall merker, resten som «+N».
 * @returns {string} HTML (tom streng uten linjer)
 */
export function lineBadgesHtml(lines, { max = 14 } = {}) {
  const groups = groupLinesByMode(lines);
  if (!groups.length) return '';
  let left = max;
  let hidden = 0;
  const parts = [];
  for (const { mode, codes } of groups) {
    const shown = codes.slice(0, Math.max(0, left));
    hidden += codes.length - shown.length;
    left -= shown.length;
    if (!shown.length) continue;
    const color = MODE_COLORS[mode] || '#888';
    const cls = DARK_TEXT.has(mode) ? 'mini-badge mini-badge--dark' : 'mini-badge';
    parts.push(
      `<span class="mini-badge-group">${shown.map((c) => `<span class="${cls}" style="background:${color}">${escapeHtml(c)}</span>`).join('')}</span>`
    );
  }
  if (hidden > 0) parts.push(`<span class="mini-badge-more">+${hidden}</span>`);
  return parts.join('');
}
