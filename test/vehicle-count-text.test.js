import { test } from 'node:test';
import assert from 'node:assert/strict';
import { formatVehicleCounts } from '../js/vehicle-count-text.js';

test('bruker flertall når antallet ikke er 1', () => {
  assert.equal(
    formatVehicleCounts({ total: 900, bus: 856, flybuss: 3, metro: 20, tram: 12, water: 2, rail: 5, flytog: 2 }),
    '900 kjøretøy: 856 busser, 3 flybusser, 20 T-banetog, 12 trikker, 2 båter, 5 regiontog, 2 flytog'
  );
});

test('bruker entall for 1 og hopper over 0', () => {
  assert.equal(
    formatVehicleCounts({ total: 4, bus: 1, flybuss: 1, metro: 1, tram: 0, water: 1 }),
    '4 kjøretøy: 1 buss, 1 flybuss, 1 T-banetog, 1 båt'
  );
});

test('bare totalen når ingen typer har kjøretøy', () => {
  assert.equal(formatVehicleCounts({ total: 3 }), '3 kjøretøy');
});
