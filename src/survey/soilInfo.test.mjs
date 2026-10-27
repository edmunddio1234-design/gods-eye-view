// Pure tests for the soil look-ups (USDA SDA and ISRIC SoilGrids). Run with: npm test.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  SDA_URL,
  compositionText,
  parseSdaSoil,
  parseSoilGrids,
  sdaSoilRequest,
  soilGridsUrl,
  textureClass,
} from './soilInfo.js';

test('the SDA request places only formatted numbers in its SQL', () => {
  const body = sdaSoilRequest({ lon: -91.2267, lat: 32.4252 });
  assert.equal(body.format, 'JSON+COLUMNNAME');
  assert.ok(body.query.includes('point(-91.226700 32.425200)'));
  assert.ok(body.query.includes('mu.farmlndcl'));
  assert.ok(body.query.includes('c.drainagecl'));
  assert.throws(() => sdaSoilRequest({ lon: "1') DROP", lat: 2 }), RangeError);
  assert.throws(() => sdaSoilRequest({ lon: 200, lat: 2 }), RangeError);
  assert.equal(new URL(SDA_URL).protocol, 'https:');
});

test('an SDA answer becomes name, texture, drainage and farmland class', () => {
  const soil = parseSdaSoil({
    Table: [
      [
        'muname',
        'farmlndcl',
        'compname',
        'comppct_r',
        'drainagecl',
        'sandtotal_r',
        'silttotal_r',
        'claytotal_r',
        'texdesc',
      ],
      [
        'Sharkey clay, 0 to 1 percent slopes',
        'All areas are prime farmland',
        'Sharkey',
        '90',
        'Poorly drained',
        '2.1',
        '37.9',
        '60.0',
        'Clay',
      ],
    ],
  });
  assert.deepEqual(soil, {
    name: 'Sharkey clay, 0 to 1 percent slopes',
    component: 'Sharkey',
    componentPct: 90,
    texture: 'Clay',
    sand: 2,
    silt: 38,
    clay: 60,
    drainage: 'Poorly drained',
    farmland: 'All areas are prime farmland',
  });
  assert.equal(compositionText(soil), 'sand 2%, silt 38%, clay 60%');
  assert.equal(compositionText({ ...soil, clay: null }), '');
  assert.equal(parseSdaSoil({ Table: [['muname']] }), null);
  assert.equal(parseSdaSoil({}), null);
  assert.equal(parseSdaSoil({ Table: [['muname'], ['']] }), null);
});

test('SoilGrids answers become percentages and a USDA texture class', () => {
  const url = new URL(soilGridsUrl({ lon: -1.5, lat: 7 }));
  assert.equal(url.host, 'rest.isric.org');
  assert.deepEqual(url.searchParams.getAll('property'), [
    'clay',
    'sand',
    'silt',
  ]);
  assert.equal(url.searchParams.get('depth'), '0-5cm');
  const layer = (name, mean) => ({
    name,
    unit_measure: { d_factor: 10 },
    depths: [{ values: { mean } }],
  });
  assert.deepEqual(
    parseSoilGrids({
      properties: {
        layers: [layer('clay', 330), layer('sand', 420), layer('silt', 250)],
      },
    }),
    { sand: 42, silt: 25, clay: 33, texture: 'Clay loam' },
  );
  assert.equal(
    parseSoilGrids({
      properties: {
        layers: [layer('clay', null), layer('sand', 400), layer('silt', 200)],
      },
    }),
    null,
  );
});

test('the texture triangle names the classical examples', () => {
  assert.equal(textureClass(92, 5, 3), 'Sand');
  assert.equal(textureClass(40, 40, 20), 'Loam');
  assert.equal(textureClass(20, 65, 15), 'Silt loam');
  assert.equal(textureClass(5, 85, 10), 'Silt');
  assert.equal(textureClass(65, 20, 15), 'Sandy loam');
  assert.equal(textureClass(2, 38, 60), 'Clay');
  assert.equal(textureClass(5, 50, 45), 'Silty clay');
  assert.equal(textureClass(10, 60, 30), 'Silty clay loam');
  assert.equal(textureClass(60, 13, 27), 'Sandy clay loam');
  assert.equal(textureClass(55, 10, 35), 'Sandy clay');
  assert.equal(textureClass(NaN, 1, 1), '');
});
