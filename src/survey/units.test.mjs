// Pure tests for Site Survey units. Run with: npm test (node --test). No Cesium, no DOM.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  M2_PER_ACRE,
  UNIT_STORAGE_KEY,
  formatArea,
  formatDistance,
  formatDuration,
  formatGsd,
  formatHeight,
  formatLatLon,
  formatLength,
  formatSpeed,
  heightInputToMetres,
  metresToHeightInput,
  mpsToSpeedInput,
  normalizeUnitSystem,
  readUnitSystem,
  speedInputToMps,
  writeUnitSystem,
} from './units.js';

const NB = ' ';

test('US customary is the default and metric is the switch', () => {
  assert.equal(normalizeUnitSystem(undefined), 'us');
  assert.equal(normalizeUnitSystem('metric'), 'metric');
  assert.equal(normalizeUnitSystem('imperial'), 'us');
});

test('the unit choice is remembered and survives broken storage', () => {
  const store = new Map();
  const storage = {
    getItem: (k) => store.get(k) ?? null,
    setItem: (k, v) => store.set(k, v),
  };
  assert.equal(readUnitSystem(storage), 'us');
  assert.equal(writeUnitSystem('metric', storage), true);
  assert.equal(store.get(UNIT_STORAGE_KEY), 'metric');
  assert.equal(readUnitSystem(storage), 'metric');
  const broken = {
    getItem() {
      throw new Error('denied');
    },
    setItem() {
      throw new Error('denied');
    },
  };
  assert.equal(readUnitSystem(broken), 'us');
  assert.equal(writeUnitSystem('metric', broken), false);
});

test('areas, lengths and heights format in either system', () => {
  assert.equal(formatArea(40 * M2_PER_ACRE, 'us'), `40.0${NB}ac`);
  assert.equal(formatArea(40 * M2_PER_ACRE, 'metric'), `16.2${NB}ha`);
  assert.equal(formatArea(2 * M2_PER_ACRE, 'us'), `2.00${NB}ac`);
  assert.equal(formatLength(1609.344, 'us'), `5,280${NB}ft`);
  assert.equal(formatLength(1609.344, 'metric'), `1,609${NB}m`);
  assert.equal(formatDistance(5 * 1609.344, 'us'), `5.00${NB}mi`);
  assert.equal(formatDistance(300, 'us'), `984${NB}ft`);
  assert.equal(formatDistance(12_345, 'metric'), `12.3${NB}km`);
  assert.equal(formatHeight(30.48, 'us'), `100${NB}ft`);
  assert.equal(formatHeight(26.54, 'metric'), `26.5${NB}m`);
  assert.equal(formatSpeed(22 * 0.44704, 'us'), `22${NB}mph`);
  assert.equal(formatSpeed(10, 'metric'), `36${NB}km/h`);
  assert.equal(formatArea(NaN, 'us'), '—');
});

test('GSD shows inches and centimetres per pixel together', () => {
  assert.equal(formatGsd(0.0254), `1.00${NB}in/px · 2.54${NB}cm/px`);
});

test('durations and coordinates', () => {
  assert.equal(formatDuration(1085), `18${NB}min 05${NB}s`);
  assert.equal(formatDuration(-1), '—');
  assert.equal(
    formatLatLon({ lat: 32.4085, lon: -91.1868 }),
    `32.40850°${NB}N, 91.18680°${NB}W`,
  );
});

test('inputs convert between the shown unit and SI', () => {
  assert.equal(heightInputToMetres('300', 'us'), 300 * 0.3048);
  assert.equal(heightInputToMetres('90', 'metric'), 90);
  assert.equal(metresToHeightInput(91.44, 'us'), '300');
  assert.ok(Math.abs(speedInputToMps('22', 'us') - 9.83488) < 1e-9);
  assert.equal(mpsToSpeedInput(10, 'metric'), '36');
  assert.ok(Number.isNaN(heightInputToMetres('abc', 'us')));
});
