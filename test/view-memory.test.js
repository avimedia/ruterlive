import { test } from 'node:test';
import assert from 'node:assert/strict';
import { serializeView, parseView, serializeLayers, parseLayers, isValidView } from '../js/view-memory.js';

test('visning: rundtur', () => {
  const s = serializeView(59.91391234, 10.75221234, 14);
  assert.deepEqual(parseView(s), { lat: 59.91391, lng: 10.75221, z: 14 });
});

test('visning: utenfor Oslo-bbox eller lavt zoom huskes ikke', () => {
  assert.equal(serializeView(63.4, 10.4, 14), null);
  assert.equal(serializeView(59.9, 5.3, 14), null);
  assert.equal(serializeView(59.9, 10.7, 8), null);
  assert.notEqual(serializeView(59.9, 10.7, 9), null);
  assert.equal(serializeView(59.9, 10.7, 20), null);
});

test('visning: ugyldig JSON og feil typer gir null', () => {
  assert.equal(parseView(null), null);
  assert.equal(parseView('{'), null);
  assert.equal(parseView('[]'), null);
  assert.equal(parseView('{"lat":"59.9","lng":10.7,"z":12}'), null);
  assert.equal(parseView('{"lat":59.9,"lng":10.7}'), null);
  assert.equal(isValidView({ lat: NaN, lng: 10.7, z: 12 }), false);
});

test('lag: rundtur og filtrering av ukjente', () => {
  const s = serializeLayers({ bus: false, metro: true, routes: false });
  assert.deepEqual(parseLayers(s, ['bus', 'metro', 'routes', 'tram']), { bus: false, metro: true, routes: false });
  assert.deepEqual(parseLayers(s, ['metro']), { metro: true });
});

test('lag: ugyldig data gir tomt objekt', () => {
  assert.deepEqual(parseLayers(null, ['bus']), {});
  assert.deepEqual(parseLayers('xx', ['bus']), {});
  assert.deepEqual(parseLayers('[1]', ['bus']), {});
  assert.deepEqual(parseLayers('{"bus":"nei"}', ['bus']), {});
});
