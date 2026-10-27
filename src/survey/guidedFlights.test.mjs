// Pure tests for the guided flights. Run with: npm test.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  FLIGHT_MANAGED_LAYERS,
  FLIGHT_SECONDS,
  GUIDED_FLIGHTS,
  HOLD_MS,
  SAMPLE_SITE,
  SAMPLE_SITE_OUTLINE,
  flightById,
  isLastShot,
  requestedTour,
  shotLayerPlan,
  stepShot,
} from './guidedFlights.js';
import { polygonAreaM2 } from './geodesy.js';
import { surveyLayer } from './layerCatalog.js';
import { SURVEY_OVERLAYS } from './overlays.js';

const known = (id) =>
  Boolean(surveyLayer(id)) || SURVEY_OVERLAYS.some((o) => o.id === id);

test('two flights of six shots each, with honest one-line captions', () => {
  assert.deepEqual(
    GUIDED_FLIGHTS.map((f) => [f.id, f.shots.length]),
    [
      ['louisiana', 6],
      ['ghana', 6],
    ],
  );
  for (const flight of GUIDED_FLIGHTS)
    for (const shot of flight.shots) {
      assert.ok(shot.caption.length > 10 && shot.caption.length < 260, shot.id);
      assert.ok(!shot.caption.includes('\n'), shot.id);
      const { lon, lat, range, heading, pitch } = shot.camera;
      assert.ok(
        [lon, lat, range, heading, pitch].every(Number.isFinite),
        shot.id,
      );
      assert.ok(pitch < 0 && pitch >= -90 && range > 100, shot.id);
      for (const id of [...shot.layers, ...shot.ensureOn])
        assert.ok(known(id), `${shot.id}: ${id}`);
      for (const id of shot.layers)
        assert.ok(
          FLIGHT_MANAGED_LAYERS.includes(id),
          `${shot.id}: ${id} managed`,
        );
    }
});

test('the Louisiana flight follows delta → northeast → site → flood/wetlands → soils → topography', () => {
  const la = flightById('louisiana');
  assert.deepEqual(
    la.shots.map((s) => s.id),
    ['delta', 'northeast', 'site', 'flood-wetlands', 'soils', 'topography'],
  );
  const site = la.shots[2];
  assert.ok(site.outline);
  assert.ok(site.caption.startsWith(SAMPLE_SITE.name));
  assert.deepEqual(la.shots[3].layers, ['fema-nfhl', 'usfws-nwi']);
  assert.deepEqual(la.shots[4].layers, ['nrcs-ssurgo']);
  assert.ok(la.shots[5].layers.includes('topo-contours'));
  assert.ok(la.shots[5].layers.includes('topo-relief'));
});

test('the Ghana flight uses worldwide layers and links the research at Berekum', () => {
  const gh = flightById('ghana');
  assert.deepEqual(
    gh.shots.map((s) => s.id),
    [
      'africa',
      'west-africa',
      'ghana',
      'accra',
      'berekum',
      'berekum-topography',
    ],
  );
  for (const shot of gh.shots)
    for (const id of shot.layers)
      assert.notEqual(
        surveyLayer(id)?.coverage ?? 'us',
        'us',
        `${shot.id} uses only worldwide layers (${id})`,
      );
  const berekum = gh.shots[4];
  assert.deepEqual(berekum.layers, ['ref-roads', 'world-landcover']);
  assert.equal(
    berekum.link.href,
    'https://2s-global-demo.vercel.app/news-insights/what-roads-reveal-about-rising-urban-heat-in-ghana/',
  );
  assert.ok(gh.shots[2].ensureOn.includes('ref-places'));
  assert.ok(Math.abs(gh.shots[3].camera.lat - 5.56) < 0.01);
  assert.ok(Math.abs(berekum.camera.lon + 2.58) < 0.01);
});

test('wording stays neutral', () => {
  const text = JSON.stringify(GUIDED_FLIGHTS) + SAMPLE_SITE.name;
  for (const word of [/madison/i, /campus/i, /district/i])
    assert.ok(!word.test(text), String(word));
});

test('the sample outline is about 300 acres around 32.43 N, 91.23 W', () => {
  const acres = polygonAreaM2(SAMPLE_SITE_OUTLINE) / 4046.8564224;
  assert.ok(Math.abs(acres - 300) < 1, `${acres}`);
  assert.equal(SAMPLE_SITE.lat, 32.43);
  assert.equal(SAMPLE_SITE.lon, -91.23);
});

test('shots turn their layers on and the other managed layers off, never reference layers', () => {
  const on = new Set(['ref-places', 'ref-grid', 'topo-relief', 'fema-nfhl']);
  const plan = shotLayerPlan(
    { layers: ['fema-nfhl', 'usfws-nwi'], ensureOn: ['ref-boundaries'] },
    (id) => on.has(id),
  );
  assert.deepEqual(plan.on.sort(), ['ref-boundaries', 'usfws-nwi']);
  assert.deepEqual(plan.off, ['topo-relief']);
  assert.ok(!FLIGHT_MANAGED_LAYERS.includes('ref-places'));
  assert.ok(!FLIGHT_MANAGED_LAYERS.includes('ref-boundaries'));
});

test('stepping stays inside the flight; timings are short and immediate', () => {
  const la = flightById('louisiana');
  assert.equal(stepShot(la, 0, -1), 0);
  assert.equal(stepShot(la, 5, 1), 5);
  assert.equal(stepShot(la, 2, 1), 3);
  assert.ok(isLastShot(la, 5) && !isLastShot(la, 4));
  assert.equal(flightById('nope').id, 'louisiana');
  assert.ok(FLIGHT_SECONDS >= 2.5 && FLIGHT_SECONDS <= 3.5);
  assert.ok(HOLD_MS >= 2500 && HOLD_MS <= 3500);
});

test('?tour= picks a flight from the query or the hash', () => {
  assert.equal(
    requestedTour({ search: '?embed=1&survey=1&tour=ghana' }),
    'ghana',
  );
  assert.equal(requestedTour({ search: '?tour=Louisiana' }), 'louisiana');
  assert.equal(requestedTour({ search: '', hash: '#v=2&tour=ghana' }), 'ghana');
  assert.equal(requestedTour({ search: '?tour=mars' }), null);
  assert.equal(requestedTour({}), null);
});
