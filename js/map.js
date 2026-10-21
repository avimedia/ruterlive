import L from 'leaflet';
import { clearRouteSelection } from './routes.js';

const OSLO_CENTER = [59.9110, 10.7525]; // Oslo S / Jernbanetorget
const DEFAULT_ZOOM = 14;

// Kartverket gråtone (CC BY 4.0, ingen nøkkel). Mørkt tema = samme fliser med CSS-filter
// på .basemap-tiles (se css/style.css), så rutelinjer, markører og jernbaneoverlay påvirkes ikke.
const TILE_URL = 'https://cache.kartverket.no/v1/wmts/1.0.0/topograatone/default/webmercator/{z}/{y}/{x}.png';

const TILE_OPTS = {
  attribution: '&copy; <a href="https://www.kartverket.no/">Kartverket</a>',
  maxZoom: 18,
  className: 'basemap-tiles',
};

const OPENRAILWAYMAP_ATTR = 'Data &copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>, Style <a href="https://creativecommons.org/licenses/by-sa/2.0/">CC-BY-SA 2.0</a> <a href="https://openrailwaymap.org/">OpenRailwayMap</a>';

let map = null;
let tileLayer = null;
let openRailwayMapLayer = null;

export function initMap() {
  map = L.map('map-container', {
    center: OSLO_CENTER,
    zoom: DEFAULT_ZOOM,
    zoomControl: true,
  });

  tileLayer = L.tileLayer(TILE_URL, TILE_OPTS).addTo(map);

  // OpenRailwayMap overlay – jernbanelinjer. Toggle via setOpenRailwayMapVisible.
  openRailwayMapLayer = L.tileLayer('https://tiles.openrailwaymap.org/standard/{z}/{x}/{y}.png', {
    attribution: OPENRAILWAYMAP_ATTR,
    maxZoom: 19,
    opacity: 0.65,
    pane: 'overlayPane',
  });
  const ormChecked = localStorage.getItem('ruterlive-openrailwaymap') !== 'false';
  if (ormChecked) openRailwayMapLayer.addTo(map);

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

// Temaet styres av CSS ([data-theme="dark"] .basemap-tiles); ingen nytt flislag ved bytte.
export function setMapTheme() {}

export function setOpenRailwayMapVisible(visible) {
  if (!map || !openRailwayMapLayer) return;
  if (visible) {
    if (!map.hasLayer(openRailwayMapLayer)) openRailwayMapLayer.addTo(map);
  } else {
    map.removeLayer(openRailwayMapLayer);
  }
  localStorage.setItem('ruterlive-openrailwaymap', String(visible));
}

export function isOpenRailwayMapVisible() {
  return map && openRailwayMapLayer && map.hasLayer(openRailwayMapLayer);
}
