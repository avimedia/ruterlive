/**
 * Trykk på en avgang i tavla (popup eller ark) viser kjøretøyet som kjører den.
 * Serveren slår opp turen i dataene den alt har (/api/journey-vehicle), uten kall mot Entur.
 */

import { focusVehicle } from './markers.js';
import { closeDepartures, isDepartureSheetOpen } from './departure-sheet.js';

const NOT_FOUND_MS = 2500;

function flash(row, text) {
  const cell = row.querySelector('.departure-badges');
  if (!cell || row.dataset.flashing) return;
  row.dataset.flashing = '1';
  const prev = cell.innerHTML;
  cell.innerHTML = '';
  const note = document.createElement('span');
  note.className = 'departure-not-on-map';
  note.textContent = text;
  cell.appendChild(note);
  setTimeout(() => {
    cell.innerHTML = prev;
    delete row.dataset.flashing;
  }, NOT_FOUND_MS);
}

async function showVehicleFor(row) {
  const sj = row.dataset.sj;
  if (!sj || row.dataset.busy) return;
  row.dataset.busy = '1';
  try {
    const res = await fetch(`/api/journey-vehicle?sj=${encodeURIComponent(sj)}`);
    const data = res.ok ? await res.json() : null;
    if (data?.vehicleId && focusVehicle(data.vehicleId)) {
      if (isDepartureSheetOpen()) closeDepartures();
    } else {
      flash(row, 'Ikke på kartet nå');
    }
  } catch {
    flash(row, 'Fikk ikke kontakt');
  } finally {
    delete row.dataset.busy;
  }
}

export function initDepartureFocus() {
  // Fangstfase: tavla ligger i kartet, og Leaflet stopper klikk der før de når document
  document.addEventListener('click', (e) => {
    const row = e.target.closest?.('tr[data-sj]');
    if (row) showVehicleFor(row);
  }, true);
  document.addEventListener('keydown', (e) => {
    if (e.key !== 'Enter' && e.key !== ' ') return;
    const row = e.target.closest?.('tr[data-sj]');
    if (!row) return;
    e.preventDefault();
    showVehicleFor(row);
  }, true);
}
