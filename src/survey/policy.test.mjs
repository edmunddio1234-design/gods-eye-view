// Pure tests for Site Survey mode policy and the WMS service table. Run with: npm test.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import {
  SURVEY_HIDDEN_LAYER_IDS,
  SURVEY_LAYER_BLOCK_REASON,
  isSurveyHiddenLayer,
  isSurveyRequested,
  surveyVisibilityVerdict,
  withSurveyFlag,
} from './policy.js';
import { REGISTERED_LAYER_IDS } from '../data/layerState.js';
import {
  SURVEY_WMS_ROUTE,
  SURVEY_WMS_SERVICES,
  surveyWmsBrowserUrl,
  surveyWmsUpstreamUrl,
} from './wmsServices.js';
import {
  SURVEY_FIRE_LAYER_ID,
  SURVEY_OVERLAYS,
  overlayTileSettings,
  overlayWmsSettings,
} from './overlays.js';

const SURVEY_CSS = readFileSync(
  new URL('../ui/styles/survey.css', import.meta.url),
  'utf8',
);

test('surveillance layers are hidden; FIRMS fires and environmental layers are not', () => {
  for (const id of [
    'flights',
    'military',
    'cctv',
    'alpr-cameras',
    'ais-live-vessels',
    'satellites',
  ])
    assert.ok(isSurveyHiddenLayer(id), id);
  for (const id of [
    SURVEY_FIRE_LAYER_ID,
    'fire-perimeters',
    'earthquakes',
    'weather-radar',
    'wind',
  ])
    assert.ok(!isSurveyHiddenLayer(id), id);
  assert.equal(SURVEY_FIRE_LAYER_ID, 'local-firms');
});

test('every hidden id names a real layer and its panel row is hidden by survey.css', () => {
  // local-adsb is local-only and has no share token, so it is not registered.
  const known = new Set([...REGISTERED_LAYER_IDS, 'local-adsb']);
  for (const id of SURVEY_HIDDEN_LAYER_IDS) {
    assert.ok(known.has(id), `${id} is a layer`);
    assert.ok(
      SURVEY_CSS.includes(`[data-layer-id='${id}']`),
      `${id} row hidden`,
    );
  }
});

test('the visibility guard refuses only turning a hidden layer ON', () => {
  assert.equal(
    surveyVisibilityVerdict({ layerId: 'cctv', enabled: true }),
    SURVEY_LAYER_BLOCK_REASON,
  );
  assert.equal(
    surveyVisibilityVerdict({ layerId: 'cctv', enabled: false }),
    null,
  );
  assert.equal(
    surveyVisibilityVerdict({ layerId: 'local-firms', enabled: true }),
    null,
  );
  assert.equal(surveyVisibilityVerdict(null), null);
});

test('survey=1 in the query or the hash asks for survey mode', () => {
  assert.ok(isSurveyRequested({ search: '?survey=1', hash: '' }));
  assert.ok(
    isSurveyRequested({ search: '', hash: '#v=2&lat=1&lon=2&survey=1' }),
  );
  assert.ok(!isSurveyRequested({ search: '?survey=0', hash: '' }));
  assert.ok(!isSurveyRequested({}));
});

test('the address flag is set and cleared without touching the hash', () => {
  const on = withSurveyFlag(
    'https://gev.example/share/AQc?lang=es#v=2&lat=1',
    true,
  );
  assert.equal(on, 'https://gev.example/share/AQc?lang=es&survey=1#v=2&lat=1');
  assert.equal(
    withSurveyFlag(on, false),
    'https://gev.example/share/AQc?lang=es#v=2&lat=1',
  );
});

test('every overlay draws from a WMS service or a direct tile template, and is credited', () => {
  const ids = SURVEY_OVERLAYS.map((o) => o.id);
  for (const id of Object.keys(SURVEY_WMS_SERVICES))
    assert.ok(ids.includes(id), `${id} has an overlay`);
  for (const overlay of SURVEY_OVERLAYS) {
    assert.ok(overlay.attribution.length > 20, overlay.id);
    assert.ok(overlay.legend.length >= 1, overlay.id);
    assert.ok(overlay.help.length > 20, overlay.id);
    assert.equal(overlay.coverage, 'us', overlay.id);
    const tiles = overlayTileSettings(overlay.id);
    assert.ok(tiles?.template || tiles?.wms, overlay.id);
    if (tiles.template)
      assert.equal(new URL(tiles.template).protocol, 'https:', overlay.id);
  }
  // FEMA and USFWS draw straight from their REST services in the browser
  // (FEMA's WMS answered 400 and blocks some cloud hosts); the WMS route is
  // their fallback.
  for (const id of ['fema-nfhl', 'usfws-nwi']) {
    const tiles = overlayTileSettings(id);
    assert.match(tiles.template, /\/MapServer\/export\?/);
    assert.equal(tiles.wms.url, `${SURVEY_WMS_ROUTE}/${id}`);
  }
  assert.match(
    overlayTileSettings('usgs-nhd').template,
    /hydro\.nationalmap\.gov/,
  );
  assert.equal(overlayWmsSettings('usgs-nhd'), null);
  assert.equal(overlayTileSettings('nope'), null);
  assert.equal(SURVEY_WMS_SERVICES['fema-nfhl'].layers, '28');
  assert.equal(SURVEY_WMS_SERVICES['usfws-nwi'].layers, '0');
  assert.equal(SURVEY_WMS_SERVICES['nrcs-ssurgo'].layers, 'mapunitpoly');
  assert.equal(
    SURVEY_WMS_SERVICES['mrlc-nlcd'].layers,
    'NLCD_2021_Land_Cover_L48',
  );
  for (const service of Object.values(SURVEY_WMS_SERVICES))
    assert.equal(new URL(service.url).protocol, 'https:');
  assert.equal(
    surveyWmsBrowserUrl('fema-nfhl'),
    `${SURVEY_WMS_ROUTE}/fema-nfhl`,
  );
  assert.equal(
    surveyWmsBrowserUrl('usfws-nwi'),
    `${SURVEY_WMS_ROUTE}/usfws-nwi`,
  );
  assert.equal(
    surveyWmsBrowserUrl('nrcs-ssurgo'),
    SURVEY_WMS_SERVICES['nrcs-ssurgo'].url,
  );
  assert.equal(surveyWmsBrowserUrl('nope'), null);
});

const getMap = (overrides = {}) =>
  new URLSearchParams({
    SERVICE: 'WMS',
    VERSION: '1.1.1',
    REQUEST: 'GetMap',
    LAYERS: '28',
    STYLES: '',
    SRS: 'EPSG:4326',
    BBOX: '-91.25,32.35,-91.12,32.45',
    WIDTH: '256',
    HEIGHT: '256',
    FORMAT: 'image/png',
    TRANSPARENT: 'TRUE',
    ...overrides,
  });

test('the proxy forwards only GetMap for the configured layer, rebuilt from validated values', () => {
  const ok = surveyWmsUpstreamUrl(
    'fema-nfhl',
    getMap({ evil: 'x', callback: 'y' }),
  );
  assert.ok(ok.url);
  const url = new URL(ok.url);
  assert.equal(url.origin, 'https://hazards.fema.gov');
  assert.equal(url.searchParams.get('layers'), '28');
  assert.equal(url.searchParams.get('request'), 'GetMap');
  assert.equal(url.searchParams.get('transparent'), 'true');
  assert.ok(!url.searchParams.has('evil') && !url.searchParams.has('callback'));
  const refused = (id, params) => surveyWmsUpstreamUrl(id, params).error;
  assert.equal(refused('elsewhere', getMap()), 'unknown_service');
  assert.equal(refused('__proto__', getMap()), 'unknown_service');
  assert.equal(
    refused('fema-nfhl', getMap({ REQUEST: 'GetFeatureInfo' })),
    'only_getmap',
  );
  assert.equal(
    refused('fema-nfhl', getMap({ LAYERS: '0,28' })),
    'layer_not_allowed',
  );
  assert.equal(refused('fema-nfhl', getMap({ BBOX: '1,2,3' })), 'bad_bbox');
  assert.equal(refused('fema-nfhl', getMap({ WIDTH: '5000' })), 'bad_size');
  assert.equal(
    refused('fema-nfhl', getMap({ FORMAT: 'text/html' })),
    'bad_format',
  );
  assert.equal(refused('fema-nfhl', getMap({ SRS: 'EPSG:9999' })), 'bad_srs');
  assert.equal(refused('fema-nfhl', getMap({ VERSION: '2.0' })), 'bad_version');
});
