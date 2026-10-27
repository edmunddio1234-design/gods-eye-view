// Pure tests for the Site Survey map grid. Run with: npm test.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  GRATICULE_STEPS,
  MILE_M,
  degreeCellGrids,
  formatGraticuleLabel,
  graticuleStep,
  linesInRange,
  metresPerDegree,
  siteGridLines,
  siteGridSpacing,
} from './graticule.js';

test('the graticule step follows the span, from 30° down to one minute', () => {
  assert.equal(graticuleStep(180), 30);
  assert.equal(graticuleStep(20), 10);
  assert.equal(graticuleStep(1), 0.5);
  assert.equal(graticuleStep(0.1, 2), 1 / 30);
  assert.equal(graticuleStep(0.0001), 1 / 60);
  assert.equal(graticuleStep(NaN), GRATICULE_STEPS.at(-1));
  for (let i = 1; i < GRATICULE_STEPS.length; i += 1)
    assert.ok(GRATICULE_STEPS[i] < GRATICULE_STEPS[i - 1]);
});

test('lines fall on whole multiples of the step without drift', () => {
  assert.deepEqual(
    linesInRange(-91.3, -91.1, 0.1).map((v) => v.toFixed(6)),
    ['-91.300000', '-91.200000', '-91.100000'],
  );
  assert.deepEqual(linesInRange(-1, 1, 1), [-1, 0, 1]);
  assert.deepEqual(linesInRange(2, 1, 1), []);
  assert.deepEqual(linesInRange(0, 1, 0), []);
});

test('labels read in degrees and minutes with a hemisphere', () => {
  assert.equal(formatGraticuleLabel(32.5, true), '32°30′N');
  assert.equal(formatGraticuleLabel(-91.25, false), '91°15′W');
  assert.equal(formatGraticuleLabel(7.45, true), '7°27′N');
  assert.equal(formatGraticuleLabel(-2.5833, false), '2°35′W');
  assert.equal(formatGraticuleLabel(-30, true), '30°S');
  assert.equal(formatGraticuleLabel(0, true), '0°');
  assert.equal(formatGraticuleLabel(0, false), '0°');
  assert.equal(formatGraticuleLabel(180, false), '180°');
  assert.equal(formatGraticuleLabel(15, false), '15°E');
  assert.equal(formatGraticuleLabel(32 + 59.9999 / 60, true), '33°N');
});

test('metres per degree match WGS-84 at the equator and at 32°N', () => {
  const eq = metresPerDegree(0);
  assert.ok(Math.abs(eq.lat - 110574) < 2, `${eq.lat}`);
  assert.ok(Math.abs(eq.lon - 111320) < 2, `${eq.lon}`);
  const la = metresPerDegree(32.43);
  assert.ok(Math.abs(la.lat - 110871) < 30, `${la.lat}`);
  assert.ok(Math.abs(la.lon - 94070) < 60, `${la.lon}`);
});

test('the site grid is one mile square around the site and stops after 12 cells', () => {
  const anchor = { lon: -91.23, lat: 32.43 };
  const spacing = siteGridSpacing(anchor);
  const per = metresPerDegree(anchor.lat);
  assert.ok(Math.abs(spacing.dLat * per.lat - MILE_M) < 1e-6);
  assert.ok(Math.abs(spacing.dLon * per.lon - MILE_M) < 1e-6);
  const box = { west: -91.26, east: -91.2, south: 32.4, north: 32.46 };
  const lines = siteGridLines(box, spacing);
  assert.ok(lines.lons.some((l) => l.k === 0 && l.value === anchor.lon));
  for (const { value } of [...lines.lons])
    assert.ok(value >= box.west && value <= box.east);
  const far = siteGridLines(
    { west: -95, east: -94, south: 30, north: 31 },
    spacing,
  );
  assert.equal(far.lons.length, 0);
  const wide = siteGridLines(
    { west: -92, east: -90, south: 31, north: 34 },
    spacing,
  );
  assert.equal(wide.lats.length, 25);
});

test('without a site the grid restarts at each whole degree', () => {
  const grids = degreeCellGrids({
    west: -91.3,
    east: -90.9,
    south: 31.9,
    north: 32.2,
  });
  assert.equal(grids.length, 4);
  assert.deepEqual(grids[0].clip, {
    west: -92,
    south: 31,
    east: -91,
    north: 32,
  });
  assert.equal(grids[0].spacing.anchor.lon, -92);
  assert.equal(
    degreeCellGrids({ west: 0.1, east: 0.2, south: 85.1, north: 85.2 }).length,
    0,
  );
});
