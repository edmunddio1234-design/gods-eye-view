// Pure tests for the Site Survey layer catalog. Run with: npm test.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  SURVEY_DEFAULT_ON,
  SURVEY_IMAGERY_ORDER,
  SURVEY_LAYERS,
  SURVEY_LAYER_GROUPS,
  WAYBACK_RELEASES,
  arcgisExportTemplate,
  imageryRank,
  insertionIndex,
  isInUnitedStates,
  surveyLayer,
  waybackTemplate,
  wmsTemplate,
} from './layerCatalog.js';
import { SURVEY_OVERLAYS } from './overlays.js';

test('reference layers open with the survey; roads and everything else start off', () => {
  assert.deepEqual([...SURVEY_DEFAULT_ON].sort(), [
    'ref-boundaries',
    'ref-grid',
    'ref-places',
  ]);
  assert.equal(surveyLayer('ref-roads').defaultOn, false);
  assert.equal(surveyLayer('nope'), null);
});

test('every layer has a group, a label, one sentence of help and a credit', () => {
  const groups = new Set(SURVEY_LAYER_GROUPS.map((g) => g.id));
  const ids = new Set();
  for (const layer of SURVEY_LAYERS) {
    assert.ok(!ids.has(layer.id), `${layer.id} unique`);
    ids.add(layer.id);
    assert.ok(groups.has(layer.group), layer.id);
    assert.ok(layer.label.length > 3, layer.id);
    assert.ok(layer.attribution.length > 15, layer.id);
    assert.ok(['us', 'world'].includes(layer.coverage), layer.id);
    // One plain sentence: ends with a full stop and has no second sentence.
    assert.match(layer.help, /^[A-Z0-9].*\.$/, layer.id);
    assert.ok(!/\.\s+[A-Z]/.test(layer.help), `${layer.id} one sentence`);
    if (layer.coverage === 'world')
      assert.ok(
        /world/.test(layer.help) ||
          ['relief', 'wayback', 'grid'].includes(layer.kind),
        `${layer.id} says it covers the world`,
      );
  }
  for (const overlay of SURVEY_OVERLAYS) {
    assert.match(overlay.help, /\(US only\)\.$/, overlay.id);
    assert.ok(!/\.\s+[A-Z]/.test(overlay.help), `${overlay.id} one sentence`);
  }
});

test('every tile source is https and keyless', () => {
  for (const layer of SURVEY_LAYERS) {
    for (const url of [layer.url, layer.fallback?.url].filter(Boolean)) {
      assert.equal(
        new URL(url.replace(/[{}]/g, '')).protocol,
        'https:',
        layer.id,
      );
      assert.ok(!/(key|token|apikey)=/i.test(url), `${layer.id} has no key`);
    }
  }
});

test('the worldwide group covers the whole world and includes land cover, soils and water', () => {
  const world = SURVEY_LAYERS.filter((l) => l.group === 'world');
  assert.deepEqual(
    world.map((l) => l.id),
    ['world-landcover', 'world-soilgrids', 'world-surface-water'],
  );
  for (const layer of world) assert.equal(layer.coverage, 'world');
  assert.match(
    surveyLayer('world-soilgrids').url,
    /^https:\/\/maps\.isric\.org\//,
  );
  assert.match(
    surveyLayer('world-surface-water').url,
    /global-surface-water\/tiles2021\/occurrence\/\{z\}\/\{x\}\/\{y\}\.png$/,
  );
});

test('ArcGIS export and WMS templates carry Cesium placeholders and fixed values', () => {
  const map = arcgisExportTemplate(
    'https://example.gov/arcgis/rest/services/x/MapServer/',
    {
      layers: 'show:28',
      dpi: 48,
      size: 512,
    },
  );
  assert.equal(
    map,
    'https://example.gov/arcgis/rest/services/x/MapServer/export?bbox={westProjected},{southProjected},{eastProjected},{northProjected}&bboxSR=3857&imageSR=3857&size=512,512&dpi=48&format=png32&transparent=true&layers=show:28&f=image',
  );
  const image = arcgisExportTemplate('https://example.gov/x/ImageServer', {
    extra: 'time=1,2',
  });
  assert.match(image, /\/ImageServer\/exportImage\?/);
  assert.ok(!image.includes('dpi='));
  assert.ok(image.includes('&time=1,2&'));
  const wms = wmsTemplate(
    'https://maps.example/mapserv?map=/map/clay.map',
    'clay 0',
  );
  assert.ok(
    wms.startsWith(
      'https://maps.example/mapserv?map=/map/clay.map&SERVICE=WMS',
    ),
  );
  assert.ok(wms.includes('LAYERS=clay%200'));
  assert.ok(
    wms.includes(
      'BBOX={westProjected},{southProjected},{eastProjected},{northProjected}',
    ),
  );
});

test('Wayback releases are dated, ascending, and build tile URLs', () => {
  assert.ok(WAYBACK_RELEASES.length >= 3);
  const dates = WAYBACK_RELEASES.map((r) => r.date);
  assert.deepEqual([...dates].sort(), dates);
  for (const r of WAYBACK_RELEASES) assert.equal(r.year, r.date.slice(0, 4));
  assert.equal(
    waybackTemplate(10),
    'https://wayback.maptiles.arcgis.com/arcgis/rest/services/World_Imagery/WMTS/1.0.0/default028mm/MapServer/tile/10/{z}/{y}/{x}',
  );
  assert.equal(waybackTemplate('x'), null);
  assert.equal(waybackTemplate(-1), null);
});

test('imagery stacks in a fixed order: past imagery at the bottom, names and grid on top', () => {
  const imageryIds = [
    ...SURVEY_LAYERS.filter((l) =>
      ['tiles', 'grid', 'wayback'].includes(l.kind),
    ).map((l) => l.id),
    ...SURVEY_OVERLAYS.map((o) => o.id),
  ];
  for (const id of imageryIds)
    assert.ok(Number.isFinite(imageryRank(id)), `${id} has a rank`);
  assert.equal(imageryRank('past-wayback'), 0);
  assert.ok(imageryRank('ref-places') > imageryRank('fema-nfhl'));
  assert.ok(imageryRank('ref-grid') > imageryRank('ref-places'));
  assert.equal(imageryRank('nope'), Number.POSITIVE_INFINITY);
  assert.equal(new Set(SURVEY_IMAGERY_ORDER).size, SURVEY_IMAGERY_ORDER.length);
  assert.equal(insertionIndex([], 3), 0);
  assert.equal(insertionIndex([1, 4, 9], 5), 2);
  assert.equal(insertionIndex([1, 4, 9], 0), 0);
  assert.equal(insertionIndex([1, 4, 9], 12), 3);
});

test('the US test knows Louisiana from Ghana', () => {
  assert.ok(isInUnitedStates(-91.23, 32.43));
  assert.ok(isInUnitedStates(-149.9, 61.2)); // Anchorage
  assert.ok(isInUnitedStates(-157.8, 21.3)); // Honolulu
  assert.ok(!isInUnitedStates(-2.58, 7.45)); // Berekum
  assert.ok(!isInUnitedStates(-0.19, 5.56)); // Accra
});
