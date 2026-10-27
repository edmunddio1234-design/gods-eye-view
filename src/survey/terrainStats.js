/**
 * Site Survey elevation and slope: the pure half.
 *
 * The boundary is covered with a square grid on the plane tangent at the site
 * (see geodesy.js); the grid nodes inside the boundary are sampled from the
 * globe's terrain by the Cesium half, and the heights come back here for
 * statistics. Slope at a node is the gradient magnitude from its grid
 * neighbours (central differences where both exist, one-sided at the edge),
 * as a percentage: 100 × rise / run.
 *
 * The profile is the same idea along a drawn line: evenly spaced stations,
 * each carrying its distance from the start.
 *
 * No Cesium, no DOM.
 */
import {
  createLocalFrame,
  geodesicDistanceM,
  openRing,
  pointInRing,
  polygonAreaM2,
  polygonCentroid,
} from './geodesy.js';

/** Grid nodes sampled at most, so a county-sized boundary stays responsive. */
export const MAX_GRID_POINTS = 900;
/** Finer than this says more about the terrain tiles than about the land. */
export const MIN_GRID_SPACING_M = 10;
/** Stations along an elevation profile. */
export const PROFILE_STATIONS = 120;

/**
 * Grid nodes inside a boundary.
 * @param {Array<{lon:number, lat:number}>} boundary
 * @param {{maxPoints?:number, minSpacingM?:number}} [options]
 * @returns {{spacingM:number, points:Array<{lon:number, lat:number, i:number, j:number}>}}
 */
export function gridSamplePoints(
  boundary,
  { maxPoints = MAX_GRID_POINTS, minSpacingM = MIN_GRID_SPACING_M } = {},
) {
  const ring = openRing(boundary);
  if (ring.length < 3) return { spacingM: 0, points: [] };
  const frame = createLocalFrame(polygonCentroid(ring));
  const local = ring.map((p) => frame.toLocal(p));
  const area = polygonAreaM2(ring);
  let spacingM = Math.max(minSpacingM, Math.sqrt(area / maxPoints));
  const xs = local.map((p) => p.x);
  const ys = local.map((p) => p.y);
  const minX = Math.min(...xs);
  const maxX = Math.max(...xs);
  const minY = Math.min(...ys);
  const maxY = Math.max(...ys);
  const collect = () => {
    const points = [];
    const columns = Math.floor((maxX - minX) / spacingM) + 1;
    const rows = Math.floor((maxY - minY) / spacingM) + 1;
    // Centre the grid on the bounding box so neither edge is favoured.
    const x0 = (minX + maxX) / 2 - ((columns - 1) * spacingM) / 2;
    const y0 = (minY + maxY) / 2 - ((rows - 1) * spacingM) / 2;
    for (let j = 0; j < rows; j += 1) {
      for (let i = 0; i < columns; i += 1) {
        const p = { x: x0 + i * spacingM, y: y0 + j * spacingM };
        if (!pointInRing(p, local)) continue;
        points.push({ ...frame.toLonLat(p), i, j });
      }
    }
    return points;
  };
  let points = collect();
  // Concave shapes fit fewer nodes than area / spacing² predicts; the other
  // way round (more than the budget) only happens on slivers, so coarsen.
  while (points.length > maxPoints) {
    spacingM *= 1.25;
    points = collect();
  }
  // A boundary narrower than one grid step still deserves a sample.
  if (!points.length) {
    const centre = polygonCentroid(ring);
    points = [{ ...centre, i: 0, j: 0 }];
  }
  return { spacingM, points };
}

/**
 * Min, max and mean of the finite heights.
 * @param {Array<{height:number}>} samples
 */
export function elevationStats(samples) {
  let min = Infinity;
  let max = -Infinity;
  let sum = 0;
  let count = 0;
  for (const sample of samples || []) {
    const h = sample?.height;
    if (!Number.isFinite(h)) continue;
    if (h < min) min = h;
    if (h > max) max = h;
    sum += h;
    count += 1;
  }
  if (!count) return { count: 0, min: NaN, max: NaN, mean: NaN, reliefM: NaN };
  return { count, min, max, mean: sum / count, reliefM: max - min };
}

/**
 * Slope at each grid node with at least one neighbour on each axis.
 * @param {Array<{i:number, j:number, height:number}>} samples
 * @param {number} spacingM
 * @returns {{count:number, meanPct:number, maxPct:number}}
 */
export function slopeStats(samples, spacingM) {
  const heights = new Map();
  for (const s of samples || []) {
    if (Number.isFinite(s?.height)) heights.set(`${s.i},${s.j}`, s.height);
  }
  const at = (i, j) => heights.get(`${i},${j}`);
  const gradient = (minus, here, plus) => {
    if (minus !== undefined && plus !== undefined)
      return (plus - minus) / (2 * spacingM);
    if (plus !== undefined) return (plus - here) / spacingM;
    if (minus !== undefined) return (here - minus) / spacingM;
    return undefined;
  };
  let sum = 0;
  let max = 0;
  let count = 0;
  if (!(spacingM > 0)) return { count: 0, meanPct: NaN, maxPct: NaN };
  for (const s of samples || []) {
    const here = at(s.i, s.j);
    if (here === undefined) continue;
    const dx = gradient(at(s.i - 1, s.j), here, at(s.i + 1, s.j));
    const dy = gradient(at(s.i, s.j - 1), here, at(s.i, s.j + 1));
    if (dx === undefined || dy === undefined) continue;
    const pct = 100 * Math.hypot(dx, dy);
    sum += pct;
    if (pct > max) max = pct;
    count += 1;
  }
  if (!count) return { count: 0, meanPct: NaN, maxPct: NaN };
  return { count, meanPct: sum / count, maxPct: max };
}

/**
 * Evenly spaced stations along a path, each with its distance from the start.
 * Stations are interpolated on the local plane, segment by segment, and every
 * vertex of the path is a station so bends are not cut.
 * @param {Array<{lon:number, lat:number}>} path
 * @param {{stations?:number}} [options]
 * @returns {Array<{lon:number, lat:number, distanceM:number}>}
 */
export function profileStations(path, { stations = PROFILE_STATIONS } = {}) {
  const points = (path || []).filter(
    (p) => p && Number.isFinite(p.lon) && Number.isFinite(p.lat),
  );
  if (points.length < 2) return [];
  const lengths = [];
  let total = 0;
  for (let index = 1; index < points.length; index += 1) {
    const length = geodesicDistanceM(points[index - 1], points[index]);
    lengths.push(length);
    total += length;
  }
  if (!(total > 0)) return [];
  const step = total / Math.max(1, stations - 1);
  const out = [];
  let travelled = 0;
  for (let index = 0; index < lengths.length; index += 1) {
    const a = points[index];
    const b = points[index + 1];
    const length = lengths[index];
    const frame = createLocalFrame(a);
    const end = frame.toLocal(b);
    const count = Math.max(1, Math.round(length / step));
    for (let k = 0; k < count; k += 1) {
      const t = k / count;
      out.push({
        ...frame.toLonLat({ x: end.x * t, y: end.y * t }),
        distanceM: travelled + length * t,
      });
    }
    travelled += length;
  }
  const last = points[points.length - 1];
  out.push({ lon: last.lon, lat: last.lat, distanceM: total });
  return out;
}

/**
 * Length, extremes and cumulative climb/descent of a sampled profile.
 * @param {Array<{distanceM:number, height:number}>} samples
 */
export function profileSummary(samples) {
  const valid = (samples || []).filter((s) => Number.isFinite(s?.height));
  const stats = elevationStats(valid);
  let gainM = 0;
  let lossM = 0;
  let maxGradePct = 0;
  for (let index = 1; index < valid.length; index += 1) {
    const rise = valid[index].height - valid[index - 1].height;
    if (rise > 0) gainM += rise;
    else lossM -= rise;
    const run = valid[index].distanceM - valid[index - 1].distanceM;
    if (run > 0)
      maxGradePct = Math.max(maxGradePct, (100 * Math.abs(rise)) / run);
  }
  const lengthM = samples?.length ? samples[samples.length - 1].distanceM : 0;
  return { ...stats, gainM, lossM, lengthM, maxGradePct };
}
