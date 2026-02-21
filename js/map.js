import L from 'leaflet';
import { clearRouteSelection } from './routes.js';

const OSLO_CENTER = [59.9139, 10.7522];
const DEFAULT_ZOOM = 14;

const TILE_URLS = {
  dark: 'https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png',
  light: 'https://{s}.basemaps.cartocdn.com/light_all/{z}/{x}/{y}{r}.png',
};

const TILE_OPTS = {
  attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> &copy; <a href="https://carto.com/attributions">CARTO</a>',
  subdomains: 'abcd',
  maxZoom: 19,
};

let map = null;
let tileLayer = null;
let currentTileTheme = null;

export function initMap() {
  map = L.map('map-container', {
    center: OSLO_CENTER,
    zoom: DEFAULT_ZOOM,
    zoomControl: true,
  });

  const theme = document.documentElement.dataset.theme || 'dark';
  currentTileTheme = theme;
  tileLayer = L.tileLayer(TILE_URLS[theme] || TILE_URLS.dark, TILE_OPTS).addTo(map);

  // Move zoom control to bottom-right
  map.zoomControl.setPosition('bottomright');

  // Route lines layer
  map.routeLayerGroup = L.layerGroup().addTo(map);
  map.routeLayerGroup.setZIndex(500);

  // Holdeplasser – z-index under kjøretøy slik at kjøretøy er klikkbart når det er på holdeplass
  map.stopsLayerGroup = L.layerGroup().addTo(map);
  map.stopsLayerGroup.setZIndex(700);

  // Kjøretøy over holdeplasser (så de er klikkbare)
  map.createPane('vehiclePane');
  map.getPane('vehiclePane').style.zIndex = 750;

  // Rute-tooltip (Linje X: Fra→Til) over kjøretøy
  map.getPane('tooltipPane').style.zIndex = 800;

  // Popup (kjøretøy-info) over kjøretøypunktene
  map.getPane('popupPane').style.zIndex = 900;

  // Søkeresultat-marker (vedvarer til neste søk)
  map.searchResultLayer = L.layerGroup().addTo(map);
  map.searchResultLayer.setZIndex(950);

  // Klikk på kartet (ikke på rute) fjerner uthevelse
  map.on('click', clearRouteSelection);

  return map;
}

export function getMap() {
  return map;
}

export function setMapTheme(theme) {
  if (!map || !tileLayer) return;
  const t = theme || 'dark';
  if (currentTileTheme === t) return;
  currentTileTheme = t;
  map.removeLayer(tileLayer);
  tileLayer = L.tileLayer(TILE_URLS[t] || TILE_URLS.dark, TILE_OPTS).addTo(map);
}
