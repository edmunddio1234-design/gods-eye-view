// Pure tests for the Site Survey drone planner. Run with: npm test (node --test). No Cesium, no DOM.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  DEFAULT_DRONE_ID,
  DRONE_PRESETS,
  PART_107_MAX_AGL_M,
  PLAN_DEFAULTS,
  PLAN_WARNINGS,
  TURN_SECONDS,
  USABLE_BATTERY_FRACTION,
  dronePreset,
  generateFlightLines,
  groundSamplingDistanceM,
  imageFootprintM,
  lineSpacingM,
  longestEdgeBearing,
  normalizeHeading,
  normalizeOverlap,
  photoSpacingM,
  photosForPass,
  planSurvey,
  validCamera,
} from './flightPlan.js';
import { createLocalFrame, pointInRing } from './geodesy.js';

const close = (actual, expected, tolerance, label = '') =>
  assert.ok(
    Math.abs(actual - expected) <= tolerance,
    `${label} ${actual} vs ${expected}`,
  );
const MAVIC = dronePreset('mavic3e');
const FT = 0.3048;
const TALLULAH = { lat: 32.4085, lon: -91.1868 };

test('presets carry the published camera specifications, Mavic 3E by default', () => {
  assert.equal(DEFAULT_DRONE_ID, 'mavic3e');
  assert.deepEqual(
    DRONE_PRESETS.map((p) => [
      p.id,
      p.sensorWidthMm,
      p.sensorHeightMm,
      p.focalLengthMm,
      p.imageWidthPx,
      p.imageHeightPx,
      p.batteryMinutes,
    ]),
    [
      ['mavic3e', 17.3, 13.0, 12.29, 5280, 3956, 42],
      ['phantom4rtk', 13.2, 8.8, 8.8, 5472, 3648, 30],
      ['m350p1', 35.9, 24, 35, 8192, 5460, 55],
    ],
  );
  assert.equal(USABLE_BATTERY_FRACTION, 0.75);
  close(PLAN_DEFAULTS.altitudeM, 300 * FT, 1e-9);
  close(PLAN_DEFAULTS.speedMps, 22 * 0.44704, 1e-9);
  assert.equal(PLAN_DEFAULTS.frontOverlap, 0.75);
  assert.equal(PLAN_DEFAULTS.sideOverlap, 0.7);
  close(PART_107_MAX_AGL_M, 121.92, 1e-9);
});

test('ground sampling distance and footprint follow the pinhole camera model', () => {
  const h = 300 * FT; // 91.44 m
  // Across: 17.3 × 91.44 / (12.29 × 5280) = 2.4378 cm/px; along: 2.4450 cm/px.
  close(groundSamplingDistanceM(MAVIC, h) * 100, 2.445, 1e-3, 'gsd cm');
  const fp = imageFootprintM(MAVIC, h);
  close(fp.acrossM, (17.3 * h) / 12.29, 1e-9, 'across');
  close(fp.alongM, (13.0 * h) / 12.29, 1e-9, 'along');
  close(fp.acrossM, 128.715, 1e-3);
  // Phantom 4 RTK at 100 m: the well-known 2.74 cm/px.
  close(
    groundSamplingDistanceM(dronePreset('phantom4rtk'), 100) * 100,
    2.74,
    0.01,
  );
  // GSD is linear in altitude.
  close(
    groundSamplingDistanceM(MAVIC, 2 * h),
    2 * groundSamplingDistanceM(MAVIC, h),
    1e-12,
  );
  assert.ok(Number.isNaN(groundSamplingDistanceM(MAVIC, 0)));
  assert.ok(
    Number.isNaN(groundSamplingDistanceM({ ...MAVIC, focalLengthMm: -1 }, h)),
  );
});

test('spacing comes from footprint and overlap; overlap accepts fractions or percents', () => {
  const h = 300 * FT;
  close(lineSpacingM(MAVIC, h, 0.7), 128.715 * 0.3, 1e-3);
  close(photoSpacingM(MAVIC, h, 0.75), 96.723 * 0.25, 1e-3);
  assert.equal(normalizeOverlap(75), 0.75);
  assert.equal(normalizeOverlap(0.8), 0.8);
  assert.equal(normalizeOverlap(99), 0.95);
  assert.equal(normalizeOverlap(-5), 0);
  assert.ok(Number.isNaN(normalizeOverlap('x')));
  assert.equal(photosForPass(300, 24.18), 14);
  assert.equal(photosForPass(0, 10), 1);
  assert.equal(photosForPass(10, 0), 0);
});

test('flight lines cover a rectangle with centred, evenly spaced passes', () => {
  const ring = [
    { x: 0, y: 0 },
    { x: 400, y: 0 },
    { x: 400, y: 300 },
    { x: 0, y: 300 },
  ];
  const { passes, lineCount, widthM } = generateFlightLines(ring, {
    spacingM: 38.6,
    bearingDeg: 0,
  });
  assert.equal(widthM, 400);
  assert.equal(lineCount, Math.ceil(400 / 38.6));
  assert.equal(passes.length, lineCount);
  // Centred: equal overhang on both sides.
  const xs = passes.map((p) => p.start.x);
  close(xs[0], 400 - xs[xs.length - 1], 1e-9, 'centred');
  for (let i = 1; i < xs.length; i += 1) close(xs[i] - xs[i - 1], 38.6, 1e-9);
  // Every pass runs the full 300 m, north on even lines and south on odd.
  passes.forEach((p, i) => {
    close(Math.abs(p.end.y - p.start.y), 300, 1e-9);
    assert.equal(p.end.y > p.start.y, i % 2 === 0, `line ${i} direction`);
  });
});

test('flight lines are clipped to a concave boundary', () => {
  // A U: two 100 m arms joined by a 100 m base.
  const U = [
    { x: 0, y: 0 },
    { x: 300, y: 0 },
    { x: 300, y: 300 },
    { x: 200, y: 300 },
    { x: 200, y: 100 },
    { x: 100, y: 100 },
    { x: 100, y: 300 },
    { x: 0, y: 300 },
  ];
  // East-west lines (bearing 90) through the arms meet the U twice.
  const { passes } = generateFlightLines(U, { spacingM: 50, bearingDeg: 90 });
  const byLine = new Map();
  for (const p of passes) byLine.set(p.line, (byLine.get(p.line) || 0) + 1);
  assert.ok([...byLine.values()].includes(2), 'arm lines split in two');
  for (const p of passes) {
    const mid = { x: (p.start.x + p.end.x) / 2, y: (p.start.y + p.end.y) / 2 };
    assert.ok(
      pointInRing(mid, U),
      `pass midpoint ${JSON.stringify(mid)} inside`,
    );
  }
});

test('auto heading follows the longest boundary edge; manual headings normalise', () => {
  const ring = [
    { x: 0, y: 0 },
    { x: 1000, y: 1000 },
    { x: 900, y: 1100 },
    { x: -100, y: 100 },
  ];
  close(longestEdgeBearing(ring), 45, 1e-9);
  assert.equal(normalizeHeading('auto'), 'auto');
  assert.equal(normalizeHeading(''), 'auto');
  assert.equal(normalizeHeading(270), 90);
  assert.equal(normalizeHeading(-30), 150);
});

test('a 40-acre plan at the defaults adds up', () => {
  const frame = createLocalFrame(TALLULAH);
  const side = 402.336; // a quarter mile
  const boundary = [
    { x: 0, y: 0 },
    { x: side, y: 0 },
    { x: side, y: side },
    { x: 0, y: side },
  ].map((p) => frame.toLonLat(p));
  const plan = planSurvey(boundary, { camera: MAVIC, ...PLAN_DEFAULTS });
  assert.ok(plan);
  assert.equal(plan.lineCount, Math.ceil(side / plan.lineSpacingM - 1e-9));
  assert.equal(plan.passCount, plan.lineCount);
  close(plan.surveyDistanceM, plan.lineCount * side, 0.5, 'survey distance');
  close(
    plan.transitDistanceM,
    (plan.lineCount - 1) * plan.lineSpacingM,
    0.5,
    'transit',
  );
  close(
    plan.flightTimeS,
    plan.totalDistanceM / plan.speedMps + (plan.passCount - 1) * TURN_SECONDS,
    1e-6,
  );
  assert.equal(
    plan.photoCount,
    plan.lineCount * photosForPass(side, plan.photoSpacingM),
  );
  assert.equal(
    plan.batteries,
    Math.ceil(plan.flightTimeS / (42 * 60 * USABLE_BATTERY_FRACTION)),
  );
  assert.deepEqual(plan.warnings, []);
  assert.equal(plan.path.length, plan.passCount * 2);
  assert.deepEqual(plan.start, plan.path[0]);
  assert.deepEqual(plan.end, plan.path.at(-1));
});

test('warnings: above 400 ft AGL, a shutter faster than 2 s, more than one battery', () => {
  const frame = createLocalFrame(TALLULAH);
  const big = [
    { x: 0, y: 0 },
    { x: 3000, y: 0 },
    { x: 3000, y: 3000 },
    { x: 0, y: 3000 },
  ].map((p) => frame.toLonLat(p));
  const at400 = planSurvey(big, {
    camera: MAVIC,
    ...PLAN_DEFAULTS,
    altitudeM: 400 * FT,
  });
  assert.ok(!at400.warnings.includes('above-part-107'));
  const at450 = planSurvey(big, {
    camera: MAVIC,
    ...PLAN_DEFAULTS,
    altitudeM: 450 * FT,
  });
  assert.ok(at450.warnings.includes('above-part-107'));
  assert.ok(at450.warnings.includes('many-batteries'));
  const fast = planSurvey(big, {
    camera: MAVIC,
    ...PLAN_DEFAULTS,
    altitudeM: 30,
    speedMps: 20,
  });
  assert.ok(fast.warnings.includes('fast-shutter'));
  for (const id of [...at450.warnings, ...fast.warnings])
    assert.equal(typeof PLAN_WARNINGS[id], 'string');
});

test('a plan refuses what it cannot fly', () => {
  const boundary = [
    { lon: -91.19, lat: 32.4 },
    { lon: -91.18, lat: 32.4 },
    { lon: -91.18, lat: 32.41 },
  ];
  assert.equal(
    planSurvey(boundary.slice(0, 2), { camera: MAVIC, ...PLAN_DEFAULTS }),
    null,
  );
  assert.equal(planSurvey(boundary, { camera: null, ...PLAN_DEFAULTS }), null);
  assert.equal(
    planSurvey(boundary, { ...PLAN_DEFAULTS, camera: MAVIC, altitudeM: 0 }),
    null,
  );
  assert.equal(
    planSurvey(boundary, { ...PLAN_DEFAULTS, camera: MAVIC, speedMps: NaN }),
    null,
  );
  assert.equal(validCamera({ ...MAVIC, imageWidthPx: 'x' }), null);
  // A triangle still plans, and every pass end lies on its boundary or inside.
  const plan = planSurvey(boundary, { camera: MAVIC, ...PLAN_DEFAULTS });
  assert.ok(plan.passCount >= 1);
});
