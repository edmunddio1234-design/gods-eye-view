// Pure tests for Site Survey geodesy. Run with: npm test (node --test). No Cesium, no DOM.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  AUTHALIC_RADIUS_M,
  WGS84_A,
  WGS84_F,
  authalicLatitude,
  createLocalFrame,
  geodesicDistanceM,
  openRing,
  perimeterM,
  pointInRing,
  polygonAreaM2,
  polygonCentroid,
} from './geodesy.js';

const TALLULAH = { lat: 32.4085, lon: -91.1868 };
const rel = (actual, expected) => Math.abs(actual - expected) / expected;

/** Exact WGS-84 area between two parallels over a longitude span (Snyder 3-12). */
function zoneArea(lat1, lat2, dLonDeg) {
  const e2 = WGS84_F * (2 - WGS84_F);
  const e = Math.sqrt(e2);
  const q = (phi) => {
    const s = Math.sin((phi * Math.PI) / 180);
    return (
      (1 - e2) *
      (s / (1 - e2 * s * s) -
        (1 / (2 * e)) * Math.log((1 - e * s) / (1 + e * s)))
    );
  };
  return (
    ((WGS84_A * WGS84_A) / 2) *
    ((dLonDeg * Math.PI) / 180) *
    (q(lat2) - q(lat1))
  );
}

test('the authalic sphere has the area of the WGS-84 ellipsoid', () => {
  // 510,065,621.7 km² is the published WGS-84 surface area.
  const area = 4 * Math.PI * AUTHALIC_RADIUS_M ** 2;
  assert.ok(rel(area, 510_065_621.724e6) < 1e-9, `area ${area}`);
  assert.equal(authalicLatitude(0), 0);
  assert.ok(Math.abs(authalicLatitude(Math.PI / 2) - Math.PI / 2) < 1e-12);
});

test('polygon area matches the exact ellipsoidal area of a narrow lat/lon quad', () => {
  // Narrow in longitude so a great-circle top edge stays on its parallel.
  const ring = [
    { lon: -91.19, lat: 32.4 },
    { lon: -91.189, lat: 32.4 },
    { lon: -91.189, lat: 32.42 },
    { lon: -91.19, lat: 32.42 },
  ];
  const expected = zoneArea(32.4, 32.42, 0.001);
  assert.ok(rel(polygonAreaM2(ring), expected) < 1e-6);
});

test('a one-degree cell at the equator has its known ellipsoidal area', () => {
  const cell = [
    { lon: 0, lat: 0 },
    { lon: 1, lat: 0 },
    { lon: 1, lat: 1 },
    { lon: 0, lat: 1 },
  ];
  // Great-circle edges bow slightly off the 1° parallel, so allow 1e-4.
  assert.ok(rel(polygonAreaM2(cell), zoneArea(0, 1, 1)) < 1e-4);
  // ≈ 12,308.8 km² on WGS-84; a flat 111.32 km square would say 12,392.
  assert.ok(Math.abs(polygonAreaM2(cell) / 1e6 - 12308.8) < 5);
});

test('area ignores winding, closing vertex and the antimeridian', () => {
  const square = [
    { lon: -91.19, lat: 32.4 },
    { lon: -91.18, lat: 32.4 },
    { lon: -91.18, lat: 32.41 },
    { lon: -91.19, lat: 32.41 },
  ];
  const a = polygonAreaM2(square);
  assert.ok(Math.abs(polygonAreaM2([...square].reverse()) - a) < 1e-6);
  assert.ok(Math.abs(polygonAreaM2([...square, square[0]]) - a) < 1e-6);
  const seam = [
    { lon: 179.995, lat: 10 },
    { lon: -179.995, lat: 10 },
    { lon: -179.995, lat: 10.01 },
    { lon: 179.995, lat: 10.01 },
  ];
  const plain = [
    { lon: 9.995, lat: 10 },
    { lon: 10.005, lat: 10 },
    { lon: 10.005, lat: 10.01 },
    { lon: 9.995, lat: 10.01 },
  ];
  assert.ok(rel(polygonAreaM2(seam), polygonAreaM2(plain)) < 1e-9);
  assert.equal(polygonAreaM2(square.slice(0, 2)), 0);
});

test('a 40-acre quarter-quarter section measures about 40 acres', () => {
  // 1/4 mile = 402.336 m on a side, laid out on the local frame at Tallulah.
  const frame = createLocalFrame(TALLULAH);
  const side = 402.336;
  const ring = [
    { x: 0, y: 0 },
    { x: side, y: 0 },
    { x: side, y: side },
    { x: 0, y: side },
  ].map((p) => frame.toLonLat(p));
  const acres = polygonAreaM2(ring) / 4046.8564224;
  assert.ok(Math.abs(acres - 40) < 0.01, `${acres} ac`);
  const perimeterFt = perimeterM(ring) / 0.3048;
  assert.ok(Math.abs(perimeterFt - 5280) < 1, `${perimeterFt} ft`);
});

test('geodesic distance agrees with published Vincenty results', () => {
  // Flinders Peak to Buninyong (Vincenty 1975 test line): 54,972.271 m.
  const d = geodesicDistanceM(
    {
      lat: -(37 + 57 / 60 + 3.7203 / 3600),
      lon: 144 + 25 / 60 + 29.5244 / 3600,
    },
    {
      lat: -(37 + 39 / 60 + 10.1561 / 3600),
      lon: 143 + 55 / 60 + 35.3839 / 3600,
    },
  );
  assert.ok(Math.abs(d - 54972.271) < 0.01, `${d}`);
  // One degree of latitude at the equator: 110,574.389 m on WGS-84.
  assert.ok(
    Math.abs(
      geodesicDistanceM({ lat: 0, lon: 0 }, { lat: 1, lon: 0 }) - 110574.389,
    ) < 0.01,
  );
  assert.equal(geodesicDistanceM(TALLULAH, TALLULAH), 0);
  assert.ok(Number.isNaN(geodesicDistanceM(TALLULAH, { lat: 99, lon: 0 })));
  // Nearly antipodal: still a finite answer near half the circumference.
  const far = geodesicDistanceM({ lat: 0, lon: 0 }, { lat: 0.5, lon: 179.7 });
  assert.ok(far > 19_900_000 && far < 20_040_000, `${far}`);
});

test('the local frame round-trips and measures like the ellipsoid near the site', () => {
  const frame = createLocalFrame(TALLULAH);
  const p = { lon: -91.17, lat: 32.42 };
  const back = frame.toLonLat(frame.toLocal(p));
  assert.ok(
    Math.abs(back.lon - p.lon) < 1e-12 && Math.abs(back.lat - p.lat) < 1e-12,
  );
  // About 2 km away on a diagonal: within 1 part in 20,000 (10 cm).
  const local = frame.toLocal(p);
  assert.ok(
    rel(Math.hypot(local.x, local.y), geodesicDistanceM(TALLULAH, p)) < 5e-5,
  );
  // Along a parallel or a meridian through the origin it is far closer.
  const east = { lon: -91.15, lat: TALLULAH.lat };
  assert.ok(
    rel(frame.toLocal(east).x, geodesicDistanceM(TALLULAH, east)) < 1e-7,
  );
  // Continuous across the antimeridian.
  const seam = createLocalFrame({ lon: 179.999, lat: 0 });
  assert.ok(seam.toLocal({ lon: -179.999, lat: 0 }).x > 0);
  assert.ok(seam.toLocal({ lon: -179.999, lat: 0 }).x < 300);
});

test('centroid of a symmetric shape is its centre; of an L it leans to the mass', () => {
  const square = [
    { lon: -91.19, lat: 32.4 },
    { lon: -91.18, lat: 32.4 },
    { lon: -91.18, lat: 32.41 },
    { lon: -91.19, lat: 32.41 },
  ];
  const c = polygonCentroid(square);
  assert.ok(Math.abs(c.lon + 91.185) < 1e-6 && Math.abs(c.lat - 32.405) < 1e-6);
  const frame = createLocalFrame(TALLULAH);
  const L = [
    { x: 0, y: 0 },
    { x: 300, y: 0 },
    { x: 300, y: 100 },
    { x: 100, y: 100 },
    { x: 100, y: 300 },
    { x: 0, y: 300 },
  ].map((p) => frame.toLonLat(p));
  const lc = frame.toLocal(polygonCentroid(L));
  // Exact L-shape centroid: (110, 110).
  assert.ok(
    Math.abs(lc.x - 110) < 0.01 && Math.abs(lc.y - 110) < 0.01,
    JSON.stringify(lc),
  );
});

test('openRing drops invalid points and the closing repeat', () => {
  const ring = openRing([
    { lon: 1, lat: 1 },
    { lon: NaN, lat: 2 },
    { lon: 2, lat: 1 },
    { lon: 2, lat: 2 },
    { lon: 1, lat: 1 },
  ]);
  assert.equal(ring.length, 3);
  assert.ok(
    pointInRing({ x: 1, y: 1 }, [
      { x: 0, y: 0 },
      { x: 2, y: 0 },
      { x: 2, y: 2 },
      { x: 0, y: 2 },
    ]),
  );
  assert.ok(
    !pointInRing({ x: 3, y: 1 }, [
      { x: 0, y: 0 },
      { x: 2, y: 0 },
      { x: 2, y: 2 },
      { x: 0, y: 2 },
    ]),
  );
});
