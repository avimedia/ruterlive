/**
 * Hindrer sidezoom i iOS Safari på kartsiden. Knipe-zoom på et panel (f.eks. avgangstavlen)
 * zoomer hele siden, så knappene til høyre havner utenfor skjermen. Kartet zoomes av Leaflet.
 */

const BASE_VIEWPORT = 'width=device-width, initial-scale=1, maximum-scale=1, viewport-fit=cover';

/** Nullstiller en zoom Safari har beholdt (å skrive viewport-taggen på nytt tvinger skala 1). */
function resetZoom() {
  const vv = window.visualViewport;
  if (!vv || vv.scale <= 1.01) return;
  const meta = document.querySelector('meta[name="viewport"]');
  if (!meta) return;
  meta.setAttribute('content', `${BASE_VIEWPORT}, minimum-scale=1`);
  requestAnimationFrame(() => meta.setAttribute('content', BASE_VIEWPORT));
}

export function initNoPageZoom() {
  // Safari-spesifikke gesture-hendelser: bare utenfor kartet, Leaflet bruker pointer-hendelser
  document.addEventListener('gesturestart', (e) => {
    if (!e.target?.closest?.('.leaflet-container')) e.preventDefault();
  }, { passive: false });
  resetZoom();
  window.visualViewport?.addEventListener('resize', resetZoom);
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible') resetZoom();
  });
}
