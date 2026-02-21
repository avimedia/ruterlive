import L from 'leaflet';
import { getMap } from './map.js';

const MODE_COLORS = {
  bus: '#e63946',
  flybuss: '#ff6b35',
  metro: '#2a9d8f',
  tram: '#e9c46a',
  water: '#457b9d',
  rail: '#9b59b6',
  flytog: '#e056fd',
};

const SHADE_STEPS = 5; // Antall toner per transporttype

function hexToRgb(hex) {
  const m = hex.match(/^#?([a-f\d]{2})([a-f\d]{2})([a-f\d]{2})$/i);
  return m ? [parseInt(m[1], 16), parseInt(m[2], 16), parseInt(m[3], 16)] : [128, 128, 128];
}

function rgbToHex(r, g, b) {
  return '#' + [r, g, b].map((x) => Math.round(Math.max(0, Math.min(255, x))).toString(16).padStart(2, '0')).join('');
}

function getShapeColor(mode, lineOrFrom) {
  const base = MODE_COLORS[mode] || '#888';
  const [r, g, b] = hexToRgb(base);
  const hash = (lineOrFrom || '').split('').reduce((a, c) => (a * 31 + c.charCodeAt(0)) | 0, 0);
  const step = Math.abs(hash % SHADE_STEPS);
  const factor = 0.7 + (step / (SHADE_STEPS - 1)) * 0.6;
  return rgbToHex(r * factor, g * factor, b * factor);
}

let routeLayers = [];
let selectedPolyline = null;
let routesVisible = true;
let lastRenderedShapesKey = '';
let lastRenderedModesKey = '';

export function updateRouteLines(shapes, visibleModes) {
  const map = getMap();
  if (!map || !map.routeLayerGroup) return;

  const shapesKey = shapes?.length ? `${shapes.length}-${shapes.slice(0, 5).map((s) => s.line + s.from).join('|')}` : '0';
  const modesKey = [...(visibleModes || [])].sort().join(',');
  if (shapesKey === lastRenderedShapesKey && modesKey === lastRenderedModesKey) {
    return; // Ingen endring – unngå å tømme og tegne på nytt (f.eks. ved zoom/pan)
  }
  lastRenderedShapesKey = shapesKey;
  lastRenderedModesKey = modesKey;

  map.routeLayerGroup.clearLayers();
  routeLayers = [];
  selectedPolyline = null;

  if (import.meta.env.DEV) {
    console.debug('[RuterLive] updateRouteLines:', { routesVisible, shapesCount: shapes?.length ?? 0, visibleModes: [...(visibleModes || [])] });
  }

  if (!routesVisible || !shapes?.length) return;

  for (const shape of shapes) {
    const mode = shape.mode?.toLowerCase();
    if (!visibleModes.has(mode)) continue;

    const latlngs = shape.points.map(([lat, lon]) => [lat, lon]);
    const color = getShapeColor(mode, shape.line + (shape.from || ''));
    const polyline = L.polyline(latlngs, {
      color,
      weight: 5,
      opacity: 0.9,
      className: 'route-line',
    });
    polyline._ruterOriginalColor = color;

    const line = shape.line || '?';
    const from = shape.from || '—';
    const to = shape.to || '—';
    const tooltipText = `Linje ${line}: ${from} → ${to}`;

    polyline.bindTooltip(tooltipText, { permanent: false, direction: 'top', opacity: 0.95 });
    polyline.on('click', (e) => {
      L.DomEvent.stopPropagation(e);
      if (selectedPolyline && selectedPolyline !== polyline) {
        selectedPolyline.setStyle({
          weight: 5,
          opacity: 0.9,
          color: selectedPolyline._ruterOriginalColor,
        });
      }
      selectedPolyline = polyline;
      polyline.setStyle({ weight: 8, opacity: 1, color: '#fff' });
      polyline.bringToFront();
    });
    polyline.addTo(map.routeLayerGroup);
    routeLayers.push(polyline);
  }
}


export function setRoutesVisible(visible) {
  routesVisible = visible;
}

export function isRoutesVisible() {
  return routesVisible;
}

export function clearRouteSelection() {
  if (selectedPolyline) {
    selectedPolyline.setStyle({
      weight: 5,
      opacity: 0.9,
      color: selectedPolyline._ruterOriginalColor,
    });
    selectedPolyline = null;
  }
}
