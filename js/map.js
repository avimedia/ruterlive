import L from 'leaflet';
import { clearRouteSelection } from './routes.js';

const OSLO_CENTER = [59.9139, 10.7522];
const DEFAULT_ZOOM = 12;

let map = null;

export function initMap() {
  map = L.map('map-container', {
    center: OSLO_CENTER,
    zoom: DEFAULT_ZOOM,
    zoomControl: true,
  });
  // Ingen moveend/zoomend-lyssere – vi henter aldri data basert på kartutsnitt

  L.tileLayer('https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png', {
    attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> &copy; <a href="https://carto.com/attributions">CARTO</a>',
    subdomains: 'abcd',
    maxZoom: 19,
  }).addTo(map);

  // Move zoom control to bottom-right
  map.zoomControl.setPosition('bottomright');

  // Route lines layer
  map.routeLayerGroup = L.layerGroup().addTo(map);
  map.routeLayerGroup.setZIndex(500);

  // Klikk på kartet (ikke på rute) fjerner uthevelse
  map.on('click', clearRouteSelection);

  return map;
}

export function getMap() {
  return map;
}
