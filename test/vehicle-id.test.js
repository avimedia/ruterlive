import { test } from 'node:test';
import assert from 'node:assert/strict';
import { shortVehicleId } from '../server/vehicle-id.js';
import { buildVehiclesPayload } from '../server/vehicles-payload.js';

test('shortVehicleId: stabil, kort og uten kollisjoner i et realistisk sett', () => {
  const long = 'et-RUT:ServiceJourney:767be7337aaf1584efb2aa5ff458b2eb';
  assert.equal(shortVehicleId(long), shortVehicleId(long));
  assert.equal(shortVehicleId(long).length, 8);
  assert.equal(shortVehicleId('1234'), '1234');
  const ids = Array.from({ length: 5000 }, (_, i) => `et-RUT:ServiceJourney:${i.toString(16).padStart(32, '0')}`);
  assert.equal(new Set(ids.map(shortVehicleId)).size, ids.length);
});

test('buildVehiclesPayload sender korte id-er', () => {
  const p = buildVehiclesPayload([{ vehicleId: 'et-RUT:ServiceJourney:abc0123456789abcdef', location: { latitude: 59.9, longitude: 10.7 } }], { nowMs: 0 });
  assert.equal(p.vehicles[0].vehicleId.length, 8);
});
