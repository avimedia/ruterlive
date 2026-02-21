import L from 'leaflet';
import { getMap } from './map.js';

const MODE_COLORS = {
  bus: '#e63946',
  flybuss: '#ff6b35',
  metro: '#2a9d8f',
  tram: '#e9c46a',
  water: '#457b9d',
  rail: '#9b59b6',
};

let routeLayers = [];
let routesVisible = true;

export function updateRouteLines(shapes, visibleModes) {
  const map = getMap();
  if (!map || !map.routeLayerGroup) return;

  map.routeLayerGroup.clearLayers();
  routeLayers = [];

  if (import.meta.env.DEV) {
    console.debug('[RuterLive] updateRouteLines:', { routesVisible, shapesCount: shapes?.length ?? 0, visibleModes: [...(visibleModes || [])] });
  }

  if (!routesVisible || !shapes?.length) return;

  for (const shape of shapes) {
    const mode = shape.mode?.toLowerCase();
    if (!visibleModes.has(mode)) continue;

    const latlngs = shape.points.map(([lat, lon]) => [lat, lon]);
    const color = MODE_COLORS[mode] || '#888';
    const polyline = L.polyline(latlngs, {
      color,
      weight: 5,
      opacity: 0.9,
      className: 'route-line',
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
