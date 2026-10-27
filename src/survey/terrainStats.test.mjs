// Pure tests for Site Survey elevation and slope. Run with: npm test (node --test). No Cesium, no DOM.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  MAX_GRID_POINTS,
  elevationStats,
  gridSamplePoints,
  profileStations,
  profileSummary,
  slopeStats,
} from './terrainStats.js';
import { createLocalFrame, geodesicDistanceM, pointInRing } from './geodesy.js';

const TALLULAH = { lat: 32.4085, lon: -91.1868 };
const frame = createLocalFrame(TALLULAH);
const square = (side) =>
  [
    { x: 0, y: 0 },
    { x: side, y: 0 },
    { x: side, y: side },
    { x: 0, y: side },
  ].map((p) => frame.toLonLat(p));

test('the grid stays inside the boundary and within its point budget', () => {
  const boundary = square(800);
  const grid = gridSamplePoints(boundary);
  assert.ok(grid.points.length > 0 && grid.points.length <= MAX_GRID_POINTS);
  assert.ok(grid.spacingM >= 10);
  const local = boundary.map((p) => frame.toLocal(p));
  for (const p of grid.points) assert.ok(pointInRing(frame.toLocal(p), local));
  // A county-sized boundary is coarsened, not oversampled.
  const huge = gridSamplePoints(square(40_000));
  assert.ok(huge.points.length <= MAX_GRID_POINTS);
  // A sliver narrower than one step still gets its centre sampled.
  const sliver = [
    { x: 0, y: 0 },
    { x: 500, y: 0 },
    { x: 500, y: 2 },
    { x: 0, y: 2 },
  ].map((p) => frame.toLonLat(p));
  assert.ok(gridSamplePoints(sliver).points.length >= 1);
  assert.deepEqual(gridSamplePoints([]).points, []);
});

test('elevation statistics skip missing heights', () => {
  const stats = elevationStats([
    { height: 10 },
    { height: NaN },
    { height: 30 },
    { height: 20 },
  ]);
  assert.deepEqual(stats, {
    count: 3,
    min: 10,
    max: 30,
    mean: 20,
    reliefM: 20,
  });
  assert.equal(elevationStats([{ height: NaN }]).count, 0);
});

test('slope of a uniform 5% plane is 5% everywhere; a flat plane is 0%', () => {
  const grid = gridSamplePoints(square(500), { minSpacingM: 25 });
  const tilted = grid.points.map((p) => ({
    ...p,
    height: 0.05 * frame.toLocal(p).x + 0.0 * frame.toLocal(p).y + 12,
  }));
  const slope = slopeStats(tilted, grid.spacingM);
  assert.ok(slope.count > 0);
  assert.ok(Math.abs(slope.meanPct - 5) < 0.01, `${slope.meanPct}`);
  assert.ok(Math.abs(slope.maxPct - 5) < 0.01, `${slope.maxPct}`);
  const flat = slopeStats(
    grid.points.map((p) => ({ ...p, height: 3 })),
    grid.spacingM,
  );
  assert.equal(flat.maxPct, 0);
  // A 3-4-5 plane: rise 3 east and 4 north per 100 m is a 5% slope.
  const diagonal = slopeStats(
    grid.points.map((p) => {
      const l = frame.toLocal(p);
      return { ...p, height: 0.03 * l.x + 0.04 * l.y };
    }),
    grid.spacingM,
  );
  assert.ok(Math.abs(diagonal.meanPct - 5) < 0.01);
  assert.ok(Number.isNaN(slopeStats([], 10).meanPct));
});

test('profile stations run the whole line, evenly, through every bend', () => {
  const a = frame.toLonLat({ x: 0, y: 0 });
  const b = frame.toLonLat({ x: 600, y: 0 });
  const c = frame.toLonLat({ x: 600, y: 400 });
  const stations = profileStations([a, b, c], { stations: 51 });
  const total = geodesicDistanceM(a, b) + geodesicDistanceM(b, c);
  assert.ok(Math.abs(stations.at(-1).distanceM - total) < 1e-6);
  assert.equal(stations[0].distanceM, 0);
  // The bend is a station.
  assert.ok(
    stations.some(
      (s) => Math.abs(s.distanceM - geodesicDistanceM(a, b)) < 1e-6,
    ),
  );
  for (let i = 1; i < stations.length; i += 1)
    assert.ok(stations[i].distanceM > stations[i - 1].distanceM);
  assert.deepEqual(profileStations([a]), []);
});

test('profile summary: extremes, climb, descent and steepest grade', () => {
  const summary = profileSummary([
    { distanceM: 0, height: 10 },
    { distanceM: 100, height: 15 },
    { distanceM: 200, height: NaN },
    { distanceM: 300, height: 5 },
    { distanceM: 400, height: 25 },
  ]);
  assert.equal(summary.min, 5);
  assert.equal(summary.max, 25);
  assert.equal(summary.gainM, 25);
  assert.equal(summary.lossM, 10);
  assert.equal(summary.lengthM, 400);
  assert.equal(summary.maxGradePct, 20);
});
