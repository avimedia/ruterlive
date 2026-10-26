/**
 * Transportmodus fra Journey Planner og linjenummer-fallback, delt av server og nettleser.
 */

const METRO_LINE_NUMS = new Set([1, 2, 3, 4, 5, 6]);
const TRAM_LINE_NUMS = new Set([11, 12, 13, 14, 15, 16, 17, 18, 19]);

/** Ruter-linje (lineRef som «RUT:Line:5»)? Linjenumrene hos andre operatører betyr noe annet. */
export function isRuterLine(lineRef) {
  return typeof lineRef === 'string' && lineRef.startsWith('RUT:');
}

/**
 * Fallback når JP ikke har transportmodus: T-bane 1–6, trikk 11–19, resten buss.
 * Bare for Ruter-linjer; andre operatører gir null. Unngår 90–99/390–399 som båt – linjenumre er upålitelige.
 */
export function getModeFromLineNumFallback(lineRef) {
  if (!isRuterLine(lineRef)) return null;
  const m = /:Line:(\d+)/.exec(lineRef);
  const num = m ? parseInt(m[1], 10) : null;
  if (!num) return null;
  if (METRO_LINE_NUMS.has(num)) return 'metro';
  if (TRAM_LINE_NUMS.has(num)) return 'tram';
  if (num >= 20) return 'bus';
  return null;
}

export function mapJpTransportMode(jpMode) {
  if (!jpMode) return null;
  const m = (typeof jpMode === 'object' ? jpMode?.name ?? jpMode?.transportMode : jpMode).toString().toLowerCase();
  if (['metro', 'bus', 'tram', 'water', 'rail'].includes(m)) return m;
  if (['ferry', 'ferje'].includes(m)) return 'water';
  return null;
}
