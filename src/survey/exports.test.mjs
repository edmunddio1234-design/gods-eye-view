// Pure tests for Site Survey KML/GeoJSON exports and the report page. Run with: npm test.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  boundaryRingCoordinates,
  escapeXml,
  fileStem,
  surveyGeoJson,
  surveyKml,
} from './exports.js';
import { PLAN_DEFAULTS, dronePreset, planSurvey } from './flightPlan.js';
import { buildSiteReportHtml, safeImageDataUrl } from './report.js';
import { profileChartSvg, niceStep } from './profileChart.js';

const BOUNDARY = [
  { lon: -91.19, lat: 32.4 },
  { lon: -91.19, lat: 32.41 },
  { lon: -91.18, lat: 32.41 },
  { lon: -91.18, lat: 32.4 },
];
const PLAN = planSurvey(BOUNDARY, {
  camera: dronePreset('mavic3e'),
  ...PLAN_DEFAULTS,
});

test('the boundary ring is closed and counter-clockwise', () => {
  const ring = boundaryRingCoordinates(BOUNDARY);
  assert.equal(ring.length, 5);
  assert.deepEqual(ring[0], ring[4]);
  let twice = 0;
  for (let i = 0; i < ring.length - 1; i += 1)
    twice += ring[i][0] * ring[i + 1][1] - ring[i + 1][0] * ring[i][1];
  assert.ok(twice > 0);
});

test('GeoJSON carries the boundary, the flight path, waypoints and plan numbers', () => {
  const fc = surveyGeoJson({
    siteName: 'Tract 4',
    boundary: BOUNDARY,
    plan: PLAN,
    droneName: 'DJI Mavic 3 Enterprise',
  });
  assert.equal(fc.type, 'FeatureCollection');
  const roles = fc.features.map((f) => f.properties.role);
  assert.equal(roles[0], 'boundary');
  assert.equal(roles[1], 'flight-path');
  assert.equal(roles.filter((r) => r === 'waypoint').length, PLAN.path.length);
  const path = fc.features[1];
  assert.equal(path.geometry.type, 'LineString');
  assert.equal(path.properties.photos, PLAN.photoCount);
  assert.equal(path.properties.flight_lines, PLAN.lineCount);
  assert.equal(fc.features.at(-1).properties.kind, 'end');
  for (const [lon, lat] of path.geometry.coordinates) {
    assert.ok(lon >= -91.19 - 1e-6 && lon <= -91.18 + 1e-6);
    assert.ok(lat >= 32.4 - 1e-6 && lat <= 32.41 + 1e-6);
  }
  // Without a plan: just the boundary.
  assert.equal(surveyGeoJson({ boundary: BOUNDARY }).features.length, 1);
});

test('KML is well formed, escaped and flies the path relative to ground', () => {
  const kml = surveyKml({
    siteName: 'Smith & Sons <North>',
    boundary: BOUNDARY,
    plan: PLAN,
  });
  assert.match(kml, /^<\?xml version="1.0" encoding="UTF-8"\?>/);
  assert.match(kml, /<name>Smith &amp; Sons &lt;North&gt;<\/name>/);
  assert.ok(!kml.includes('<North>'));
  assert.match(kml, /<Polygon>[\s\S]*<coordinates>[\s\S]*<\/Polygon>/);
  assert.match(
    kml,
    /<LineString><altitudeMode>relativeToGround<\/altitudeMode>/,
  );
  const height = String(Math.round(PLAN.altitudeM * 1e6) / 1e6);
  assert.ok(kml.includes(`,${height} `) || kml.includes(`,${height}<`));
  assert.equal(
    (kml.match(/<name>WP\d+<\/name>/g) || []).length,
    PLAN.path.length,
  );
  // Every element opened is closed.
  for (const tag of [
    'kml',
    'Document',
    'Placemark',
    'Folder',
    'Polygon',
    'LineString',
  ])
    assert.equal(
      (kml.match(new RegExp(`<${tag}[\\s>]`, 'g')) || []).length,
      (kml.match(new RegExp(`</${tag}>`, 'g')) || []).length,
      tag,
    );
});

test('escaping and file names', () => {
  assert.equal(escapeXml(`a<b>&"c'`), 'a&lt;b&gt;&amp;&quot;c&apos;');
  assert.equal(fileStem('Tallulah Tract #4 (East)'), 'tallulah-tract-4-east');
  assert.equal(fileStem(''), 'site-survey');
});

test('the report is titled, escaped, states screening-only and credits sources', () => {
  const page = buildSiteReportHtml({
    siteName: '<script>alert(1)</script> Farm',
    generatedAt: new Date('2026-10-27T15:00:00Z'),
    units: 'us',
    boundary: {
      areaM2: 161_874,
      perimeterM: 1609,
      centroid: { lon: -91.185, lat: 32.405 },
      mgrs: '15S XR 12345 67890',
      vertexCount: 4,
    },
    terrain: {
      status: 'ok',
      stats: { count: 400, min: 24, max: 31, mean: 27, reliefM: 7 },
      slope: { meanPct: 0.8, maxPct: 4.1 },
      spacingM: 20,
      datum: 'egm96',
    },
    overlays: [
      { label: 'FEMA flood hazard zones', checked: true },
      { label: 'USFWS National Wetlands Inventory', checked: false },
    ],
    plan: PLAN,
    droneName: 'DJI Mavic 3 Enterprise',
    snapshot: 'data:image/jpeg;base64,AAAA',
    attributions: [
      'FEMA National Flood Hazard Layer (NFHL)',
      'Esri World Imagery',
    ],
  });
  assert.match(page, /<title>Preliminary Desktop Site Screening/);
  assert.match(page, /<h1>Preliminary Desktop Site Screening<\/h1>/);
  assert.ok(!page.includes('<script>'));
  assert.ok(page.includes('&lt;script&gt;'));
  assert.match(
    page,
    /screening only and need field verification by a qualified professional/,
  );
  assert.match(page, /<img src="data:image\/jpeg;base64,AAAA"/);
  assert.match(page, /Yes — viewed over the site/);
  assert.match(page, /Not checked/);
  assert.match(page, /FEMA National Flood Hazard Layer/);
  assert.match(page, /DJI Mavic 3 Enterprise/);
  assert.match(page, /LAANC/);
  assert.match(page, /mean sea level/);
  // Nothing loads from the network.
  assert.ok(!/<(script|link)\b/i.test(page));
  assert.ok(!/src="https?:/i.test(page));
});

test('the report says so when terrain was not loaded, and drops unsafe snapshots', () => {
  const page = buildSiteReportHtml({
    siteName: '',
    generatedAt: Date.now(),
    units: 'metric',
    boundary: {
      areaM2: 10_000,
      perimeterM: 400,
      centroid: { lon: 0, lat: 0 },
      mgrs: '',
      vertexCount: 4,
    },
    terrain: { status: 'unavailable' },
    overlays: [],
    plan: null,
    snapshot: 'javascript:alert(1)',
    attributions: [],
  });
  assert.match(
    page,
    /Terrain not loaded — add a Cesium ion token for elevation/,
  );
  assert.match(page, /Untitled site/);
  assert.ok(!page.includes('javascript:'));
  assert.equal(safeImageDataUrl('data:image/svg+xml;base64,AAAA'), null);
  assert.equal(
    safeImageDataUrl('data:image/png;base64,AAAA'),
    'data:image/png;base64,AAAA',
  );
});

test('the profile chart draws a line, breaks it at gaps, and escapes its label', () => {
  const samples = [0, 100, 200, 300, 400].map((d, i) => ({
    distanceM: d,
    height: i === 2 ? NaN : 20 + i,
  }));
  const svg = profileChartSvg(samples, 'us', { ariaLabel: 'Profile "A" <1>' });
  assert.match(svg, /^<svg /);
  assert.equal((svg.match(/<polyline /g) || []).length, 2);
  assert.ok(svg.includes('&quot;A&quot; &lt;1&gt;'));
  assert.ok(svg.includes('>ft<'));
  assert.equal(profileChartSvg([{ distanceM: 0, height: 1 }], 'us'), '');
  assert.equal(niceStep(87), 20);
  assert.equal(niceStep(1.2), 0.2);
});
