/**
 * Avgangstavle som bunnark på mobil (≤ 600 px). På større skjermer brukes Leaflet-popupen.
 *
 * Bruk fra routes.js:
 *   showDepartures({ name, quayIds, load })  – åpner (eller bytter til) holdeplassen; load() henter avganger
 *   showDepartures({ name, quayIds, html })  – innhold for holdeplassen (ignoreres hvis arket viser en annen)
 *
 * Arket setter --sheet-height på <body> mens det er åpent, så kontrollene nede til høyre kan flyttes opp.
 * Den rene logikken (tilstand, mediespørring, oppfriskning) er eksportert for tester.
 */
import { runWhenVisible } from './visibility.js';

export const SHEET_MEDIA_QUERY = '(max-width: 600px)';
export const REFRESH_MS = 30_000;

/** Skal avgangstavla vises som bunnark? matchMediaFn injiseres i tester. */
export function prefersDepartureSheet(
  matchMediaFn = typeof window !== 'undefined' ? window.matchMedia?.bind(window) : undefined
) {
  if (typeof matchMediaFn !== 'function') return false;
  try {
    return Boolean(matchMediaFn(SHEET_MEDIA_QUERY)?.matches);
  } catch {
    return false;
  }
}

/** Nøkkel som identifiserer en holdeplass (samme quays i samme rekkefølge). */
export function stopKey(quayIds) {
  return (Array.isArray(quayIds) ? quayIds : [quayIds]).filter(Boolean).join(',');
}

/** Hva slags HTML showDepartureBoard leverte. */
export function classifyContent(html) {
  const s = String(html ?? '');
  if (s.includes('departure-loading')) return 'loading';
  if (s.includes('departure-error')) return 'error';
  return 'ready';
}

export const CLOSED = Object.freeze({ status: 'closed', key: null, name: '', html: '', seq: 0 });

/**
 * Tilstandsmaskin: closed → loading → ready/error; open erstatter, close lukker.
 * Ved oppfriskning (allerede ready) ignoreres «Henter…» og feil, så tavla ikke blinker
 * eller forsvinner ved et forbigående nettverksbrudd.
 */
export function sheetReducer(state, action) {
  switch (action.type) {
    case 'open':
      return {
        status: 'loading',
        key: stopKey(action.quayIds),
        name: action.name || 'Holdeplass',
        html: '',
        seq: state.seq + 1,
      };
    case 'content': {
      if (state.status === 'closed' || stopKey(action.quayIds) !== state.key) return state;
      const kind = classifyContent(action.html);
      if (state.status === 'ready' && kind !== 'ready') return state;
      return { ...state, status: kind, html: action.html };
    }
    case 'close':
      return state.status === 'closed' ? state : { ...CLOSED, seq: state.seq };
    default:
      return state;
  }
}

/**
 * Henter på nytt hvert intervalMs mens arket er åpent. Tidtakere injiseres i tester.
 * tick bør selv hoppe over kall når fanen er skjult (runWhenVisible).
 */
export function createRefreshScheduler({
  intervalMs = REFRESH_MS,
  tick,
  setIntervalFn = (fn, ms) => setInterval(fn, ms),
  clearIntervalFn = (id) => clearInterval(id),
}) {
  let id = null;
  return {
    start() {
      if (id !== null) clearIntervalFn(id);
      id = setIntervalFn(() => tick(), intervalMs);
    },
    stop() {
      if (id !== null) clearIntervalFn(id);
      id = null;
    },
    isRunning: () => id !== null,
  };
}

/* ---------- DOM ---------- */

const MODE_BY_COLOR = {
  '#e63946': 'Buss',
  '#ff6b35': 'Flybuss',
  '#2a9d8f': 'T-bane',
  '#e9c46a': 'Trikk',
  '#457b9d': 'Båt',
  '#9b59b6': 'Tog',
  '#e056fd': 'Flytoget',
};
/** Lyse linjefarger får mørk tekst i merket. */
const DARK_TEXT_COLORS = new Set(['#e9c46a']);

let state = CLOSED;
let els = null;
let currentLoad = null;
let lastFocus = null;
let resizeObserver = null;

let refreshTick = null; // runWhenVisible opprettes først når arket brukes (DOM finnes ikke i tester)
const scheduler = createRefreshScheduler({ tick: () => refreshTick?.() });

function reducedMotion() {
  return typeof window !== 'undefined' && window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
}

function ensureDom() {
  if (els) return els;
  refreshTick = runWhenVisible(() => {
    if (state.status !== 'closed' && currentLoad) currentLoad();
  });
  const root = document.createElement('section');
  root.className = 'departure-sheet';
  root.id = 'departure-sheet';
  root.setAttribute('role', 'dialog');
  root.setAttribute('aria-modal', 'false');
  root.setAttribute('aria-labelledby', 'departure-sheet-title');
  root.hidden = true;
  root.innerHTML = `
    <button type="button" class="departure-sheet-grip" tabindex="-1" aria-hidden="true"><span class="departure-sheet-handle"></span></button>
    <header class="departure-sheet-header">
      <div class="departure-sheet-heading">
        <h2 id="departure-sheet-title" class="departure-sheet-title"></h2>
        <div class="departure-sheet-modes"></div>
      </div>
      <button type="button" class="departure-sheet-close" aria-label="Lukk avgangstavla">×</button>
    </header>
    <div class="departure-sheet-body" aria-live="polite"></div>`;
  (document.getElementById('map-container') || document.body).appendChild(root);
  els = {
    root,
    grip: root.querySelector('.departure-sheet-grip'),
    header: root.querySelector('.departure-sheet-header'),
    title: root.querySelector('.departure-sheet-title'),
    modes: root.querySelector('.departure-sheet-modes'),
    close: root.querySelector('.departure-sheet-close'),
    body: root.querySelector('.departure-sheet-body'),
  };
  // Arket ligger inne i Leaflet-containeren: ikke la trykk, dra og rulling nå kartet
  // (samme som L.DomEvent.disableClickPropagation/disableScrollPropagation)
  for (const type of ['pointerdown', 'mousedown', 'touchstart', 'click', 'dblclick', 'contextmenu', 'wheel']) {
    root.addEventListener(type, (e) => e.stopPropagation());
  }
  els.close.addEventListener('click', () => closeDepartures());
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && state.status !== 'closed') closeDepartures();
  });
  initOutsideTap();
  initSwipe();
  // Bredere vindu (f.eks. snudd til liggende): lukk arket, neste trykk gir popup
  window.matchMedia?.(SHEET_MEDIA_QUERY).addEventListener?.('change', (e) => {
    if (!e.matches) closeDepartures();
  });
  if (typeof ResizeObserver !== 'undefined') {
    resizeObserver = new ResizeObserver(() => syncSheetHeight());
    resizeObserver.observe(root);
  }
  return els;
}

/**
 * Trykk på kartet utenfor arket lukker det (ikke dra, ikke kontroller, holdeplasser eller kjøretøy:
 * et valgt kjøretøy får popup og «Følg» over arket).
 */
function initOutsideTap() {
  let down = null;
  document.addEventListener('pointerdown', (e) => { down = { x: e.clientX, y: e.clientY }; }, true);
  document.addEventListener('click', (e) => {
    if (state.status === 'closed') return;
    const t = e.target;
    if (!(t instanceof Element)) return;
    if (t.closest('.departure-sheet, .stop-marker, .vehicle-marker, .leaflet-popup, .leaflet-control, .btn-float, .map-chrome, #layers-panel, .overlay')) return;
    if (!t.closest('#map-container')) return;
    if (down && Math.hypot(e.clientX - down.x, e.clientY - down.y) > 10) return;
    closeDepartures();
  });
}

/**
 * Sveip ned på håndtaket eller toppen av arket lukker det; trykk på håndtaket også.
 * Håndtaket er en knapp så touch-justeringen i nettleseren ikke flytter trykket til
 * lenkene i kildehenvisningen rett over arket.
 */
function initSwipe() {
  const { root, grip, header } = els;
  let start = null;
  let dragged = false;
  const onDown = (e) => {
    if (e.target.closest('.departure-sheet-close')) return;
    start = { y: e.clientY, t: performance.now(), id: e.pointerId };
    dragged = false;
    root.classList.add('is-dragging');
    e.currentTarget.setPointerCapture?.(e.pointerId);
  };
  const onMove = (e) => {
    if (!start || e.pointerId !== start.id) return;
    const dy = Math.max(0, e.clientY - start.y);
    if (Math.abs(e.clientY - start.y) > 8) dragged = true;
    root.style.transform = dy ? `translateY(${dy}px)` : '';
  };
  const onUp = (e) => {
    if (!start || e.pointerId !== start.id) return;
    const dy = Math.max(0, e.clientY - start.y);
    const v = dy / Math.max(1, performance.now() - start.t);
    start = null;
    root.classList.remove('is-dragging');
    root.style.transform = '';
    if (dy > Math.min(120, root.offsetHeight * 0.3) || (dy > 30 && v > 0.5)) closeDepartures();
  };
  grip.addEventListener('click', () => {
    if (!dragged) closeDepartures();
  });
  for (const el of [grip, header]) {
    el.addEventListener('pointerdown', onDown);
    el.addEventListener('pointermove', onMove);
    el.addEventListener('pointerup', onUp);
    el.addEventListener('pointercancel', onUp);
  }
}

function syncSheetHeight() {
  if (!els) return;
  const h = state.status === 'closed' ? 0 : Math.round(els.root.offsetHeight);
  document.body.style.setProperty('--sheet-height', `${h}px`);
  document.body.classList.toggle('departure-sheet-open', h > 0);
}

/** Linjenummer som fargede merker + modusmerker i overskriften. */
function decorate(body) {
  const modes = [];
  for (const td of body.querySelectorAll('td.departure-line')) {
    const color = (td.getAttribute('style') || '').match(/#[0-9a-f]{6}/i)?.[0]?.toLowerCase();
    if (!color) continue;
    const badge = document.createElement('span');
    badge.className = 'departure-line-badge';
    badge.style.background = color;
    if (DARK_TEXT_COLORS.has(color)) badge.classList.add('departure-line-badge--dark');
    badge.textContent = td.textContent;
    td.textContent = '';
    td.appendChild(badge);
    const label = MODE_BY_COLOR[color];
    if (label && !modes.some((m) => m.label === label)) modes.push({ label, color });
  }
  return modes;
}

function render() {
  const { root, title, modes, body } = ensureDom();
  if (state.status === 'closed') return;
  title.textContent = state.name;
  if (state.status === 'loading') {
    body.innerHTML = '<div class="departure-loading">Henter avganger…</div>';
    modes.replaceChildren();
  } else {
    body.innerHTML = state.html;
    // Overskriften fra tavla (stoppested + kommune) flyttes til arkets tittel
    const h = body.querySelector('.departure-stop-name');
    const placeName = (h?.dataset.name || h?.textContent || '').trim();
    if (placeName) {
      title.textContent = placeName;
      const locality = (h?.dataset.locality || '').trim();
      if (locality) {
        const span = document.createElement('span');
        span.className = 'departure-locality';
        span.textContent = ` · ${locality}`;
        title.appendChild(span);
      }
    }
    const found = state.status === 'ready' ? decorate(body) : [];
    // Linjemerkene i tavla viser allerede modusene; modusmerkene trengs bare uten dem
    const hasPlaceLines = Boolean(body.querySelector('.departure-place-lines'));
    modes.replaceChildren(
      ...(hasPlaceLines ? [] : found).map(({ label, color }) => {
        const s = document.createElement('span');
        s.className = 'departure-sheet-mode';
        s.style.setProperty('--mode-color', color);
        s.textContent = label;
        return s;
      })
    );
  }
  root.hidden = false;
  syncSheetHeight();
}

function dispatch(action) {
  const prev = state;
  state = sheetReducer(state, action);
  if (state !== prev) render();
  return state !== prev;
}

/** Åpne/bytt holdeplass (uten html) eller lever innhold for holdeplassen (med html). */
export function showDepartures({ name, quayIds, html, load } = {}) {
  if (html !== undefined) {
    dispatch({ type: 'content', quayIds, html });
    return;
  }
  const wasClosed = state.status === 'closed';
  const { root, body } = ensureDom();
  if (wasClosed && typeof document !== 'undefined') lastFocus = document.activeElement;
  dispatch({ type: 'open', name, quayIds });
  body.scrollTop = 0;
  if (wasClosed) {
    root.classList.toggle('no-anim', Boolean(reducedMotion()));
    root.classList.remove('is-open');
    void root.offsetHeight; // start slide-in fra lukket posisjon
    root.classList.add('is-open');
    els.close.focus({ preventScroll: true });
  }
  currentLoad = typeof load === 'function' ? load : null;
  currentLoad?.();
  scheduler.start();
}

export function closeDepartures() {
  if (state.status === 'closed') return;
  dispatch({ type: 'close' });
  scheduler.stop();
  currentLoad = null;
  if (!els) return;
  const { root } = els;
  root.classList.remove('is-open');
  root.style.transform = '';
  const hide = () => {
    if (state.status === 'closed') root.hidden = true;
  };
  if (root.classList.contains('no-anim')) hide();
  else setTimeout(hide, 250);
  syncSheetHeight();
  if (lastFocus && typeof lastFocus.focus === 'function' && document.contains(lastFocus)) {
    lastFocus.focus({ preventScroll: true });
  }
  lastFocus = null;
}

export function isDepartureSheetOpen() {
  return state.status !== 'closed';
}
