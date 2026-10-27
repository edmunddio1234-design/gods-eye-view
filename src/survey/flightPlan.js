/**
 * Site Survey drone planner: the pure half.
 *
 * A mapping flight over a boundary is a lawnmower: parallel flight lines,
 * spaced so neighbouring photo strips overlap by the side overlap, with
 * photos taken along each line often enough to overlap by the front overlap.
 * Everything follows from the camera (sensor size, focal length, image size)
 * and the height above ground:
 *
 *   ground sampling distance  GSD = sensor width × altitude / (focal × image width)
 *   footprint across track        = sensor width  × altitude / focal
 *   footprint along track         = sensor height × altitude / focal
 *   line spacing                  = footprint across × (1 − side overlap)
 *   photo spacing                 = footprint along  × (1 − front overlap)
 *
 * The camera's long side lies across the flight line, as DJI's mapping
 * missions fly it. Lines are laid on a plane tangent at the site (see
 * geodesy.js) and clipped to the boundary, so a concave parcel gets more than
 * one pass on a line rather than a pass across land outside it.
 *
 * No Cesium, no DOM.
 */
import { msg } from '../i18n/marker.js';
import {
  createLocalFrame,
  openRing,
  planarBearingDeg,
  polygonCentroid,
} from './geodesy.js';

/** FAA Part 107 ceiling above ground level, metres (400 ft). */
export const PART_107_MAX_AGL_M = 400 * 0.3048;
/** Share of a battery's rated flight time a plan budgets for. */
export const USABLE_BATTERY_FRACTION = 0.75;
/** Seconds allowed for each turn between flight lines. */
export const TURN_SECONDS = 6;
/** Below this shutter interval most mapping cameras cannot keep up. */
export const MIN_PHOTO_INTERVAL_S = 2;
/** Hard ceiling on flight lines, so a bad input cannot hang the page. */
export const MAX_FLIGHT_LINES = 2000;

/**
 * Drone presets. Sensor sizes and image dimensions are the manufacturers'
 * published specifications; battery minutes are rated hover-free flight time.
 */
export const DRONE_PRESETS = Object.freeze([
  Object.freeze({
    id: 'mavic3e',
    name: 'DJI Mavic 3 Enterprise', // i18n-ignore: product name
    sensorWidthMm: 17.3,
    sensorHeightMm: 13.0,
    focalLengthMm: 12.29,
    imageWidthPx: 5280,
    imageHeightPx: 3956,
    batteryMinutes: 42,
  }),
  Object.freeze({
    id: 'phantom4rtk',
    name: 'DJI Phantom 4 RTK', // i18n-ignore: product name
    sensorWidthMm: 13.2,
    sensorHeightMm: 8.8,
    focalLengthMm: 8.8,
    imageWidthPx: 5472,
    imageHeightPx: 3648,
    batteryMinutes: 30,
  }),
  Object.freeze({
    id: 'm350p1',
    name: 'DJI Matrice 350 RTK + Zenmuse P1 35 mm', // i18n-ignore: product name
    sensorWidthMm: 35.9,
    sensorHeightMm: 24,
    focalLengthMm: 35,
    imageWidthPx: 8192,
    imageHeightPx: 5460,
    batteryMinutes: 55,
  }),
]);
export const DEFAULT_DRONE_ID = 'mavic3e';
export const CUSTOM_DRONE_ID = 'custom';

/** Defaults for a new plan, in SI units. */
export const PLAN_DEFAULTS = Object.freeze({
  altitudeM: 300 * 0.3048,
  frontOverlap: 0.75,
  sideOverlap: 0.7,
  speedMps: 22 * 0.44704,
  heading: 'auto',
});

/** Warning ids, mapped to English text the panel translates. */
export const PLAN_WARNINGS = Object.freeze({
  'above-part-107': msg(
    'Altitude is above 400 ft AGL, the FAA Part 107 limit. A waiver is required.',
  ),
  'fast-shutter': msg(
    'Photos are less than 2 s apart. Slow down or fly higher so the camera can keep up.',
  ),
  'many-batteries': msg(
    'This plan needs more than one battery. Plan the battery swaps before flying.',
  ),
});
/** Always shown: no live airspace data is claimed. */
export const AIRSPACE_NOTE = msg(
  'Check airspace before flying: request LAANC or FAA DroneZone authorization where it is required. This plan does not check airspace.',
);

/** The preset for `id`, or null. */
export function dronePreset(id) {
  return DRONE_PRESETS.find((preset) => preset.id === id) || null;
}

/**
 * A camera with every field a positive finite number, or null.
 * @param {object} camera
 */
export function validCamera(camera) {
  if (!camera) return null;
  const fields = [
    'sensorWidthMm',
    'sensorHeightMm',
    'focalLengthMm',
    'imageWidthPx',
    'imageHeightPx',
    'batteryMinutes',
  ];
  const out = {};
  for (const field of fields) {
    const value = Number(camera[field]);
    if (!Number.isFinite(value) || value <= 0) return null;
    out[field] = value;
  }
  return out;
}

/**
 * Ground sampling distance in metres per pixel: the coarser of the two sensor
 * axes, which is the figure a deliverable can promise.
 */
export function groundSamplingDistanceM(camera, altitudeM) {
  const c = validCamera(camera);
  if (!c || !(altitudeM > 0)) return NaN;
  const across =
    (c.sensorWidthMm * altitudeM) / (c.focalLengthMm * c.imageWidthPx);
  const along =
    (c.sensorHeightMm * altitudeM) / (c.focalLengthMm * c.imageHeightPx);
  return Math.max(across, along);
}

/** Ground footprint of one photo, metres: across and along the flight line. */
export function imageFootprintM(camera, altitudeM) {
  const c = validCamera(camera);
  if (!c || !(altitudeM > 0)) return { acrossM: NaN, alongM: NaN };
  return {
    acrossM: (c.sensorWidthMm * altitudeM) / c.focalLengthMm,
    alongM: (c.sensorHeightMm * altitudeM) / c.focalLengthMm,
  };
}

/** An overlap fraction clamped into [0, 0.95]; percentages over 1 are read as %. */
export function normalizeOverlap(value) {
  let number = Number(value);
  if (!Number.isFinite(number)) return NaN;
  if (number > 1) number /= 100;
  return Math.min(0.95, Math.max(0, number));
}

/** Distance between neighbouring flight lines, metres. */
export function lineSpacingM(camera, altitudeM, sideOverlap) {
  const { acrossM } = imageFootprintM(camera, altitudeM);
  const overlap = normalizeOverlap(sideOverlap);
  return acrossM * (1 - overlap);
}

/** Distance between photos along a flight line, metres. */
export function photoSpacingM(camera, altitudeM, frontOverlap) {
  const { alongM } = imageFootprintM(camera, altitudeM);
  const overlap = normalizeOverlap(frontOverlap);
  return alongM * (1 - overlap);
}

/**
 * Bearing (degrees from north, [0, 180)) of the boundary's longest edge on
 * the local plane. Flight lines run along it, which usually means the fewest
 * turns.
 * @param {Array<{x:number, y:number}>} localRing
 */
export function longestEdgeBearing(localRing) {
  let best = -1;
  let bearing = 0;
  for (let index = 0; index < localRing.length; index += 1) {
    const a = localRing[index];
    const b = localRing[(index + 1) % localRing.length];
    const length = Math.hypot(b.x - a.x, b.y - a.y);
    if (length > best) {
      best = length;
      bearing = planarBearingDeg(a, b);
    }
  }
  return bearing % 180;
}

/** A heading input as degrees in [0, 180), or 'auto'. */
export function normalizeHeading(value) {
  if (value === 'auto' || value === '' || value == null) return 'auto';
  const number = Number(value);
  if (!Number.isFinite(number)) return 'auto';
  return ((number % 180) + 180) % 180;
}

/**
 * Parallel flight lines over a planar ring, clipped to it.
 *
 * Lines run along `bearingDeg`; they are `spacingM` apart, centred on the
 * ring's extent across that bearing so the outermost strips overhang both
 * sides equally. Each line meets the ring's edges in an even number of
 * places; consecutive pairs are the passes inside it. Passes are returned in
 * serpentine order — every other line reversed — which is the lawnmower path.
 *
 * @param {Array<{x:number, y:number}>} ring planar, open
 * @param {{spacingM:number, bearingDeg:number}} options
 * @returns {{passes: Array<{start:{x,y}, end:{x,y}, line:number}>, lineCount:number, widthM:number}}
 */
export function generateFlightLines(ring, { spacingM, bearingDeg }) {
  if (!Array.isArray(ring) || ring.length < 3 || !(spacingM > 0))
    return { passes: [], lineCount: 0, widthM: 0 };
  const theta = (bearingDeg * Math.PI) / 180;
  // Along the flight line, and across it (90° clockwise).
  const along = { x: Math.sin(theta), y: Math.cos(theta) };
  const across = { x: Math.cos(theta), y: -Math.sin(theta) };
  const dot = (p, v) => p.x * v.x + p.y * v.y;
  const offsets = ring.map((p) => dot(p, across));
  const min = Math.min(...offsets);
  const max = Math.max(...offsets);
  const widthM = max - min;
  const lineCount = Math.min(
    MAX_FLIGHT_LINES,
    Math.max(1, Math.ceil(widthM / spacingM - 1e-9)),
  );
  const centre = (min + max) / 2;
  const first = centre - ((lineCount - 1) * spacingM) / 2;
  const passes = [];
  for (let line = 0; line < lineCount; line += 1) {
    const offset = first + line * spacingM;
    const hits = [];
    for (let index = 0; index < ring.length; index += 1) {
      const a = ring[index];
      const b = ring[(index + 1) % ring.length];
      const oa = dot(a, across) - offset;
      const ob = dot(b, across) - offset;
      // Half-open test so a vertex exactly on the line is counted once.
      if (oa > 0 === ob > 0) continue;
      const t = oa / (oa - ob);
      hits.push(dot(a, along) + t * (dot(b, along) - dot(a, along)));
    }
    hits.sort((p, q) => p - q);
    const segments = [];
    for (let index = 0; index + 1 < hits.length; index += 2) {
      if (hits[index + 1] - hits[index] > 1e-6)
        segments.push([hits[index], hits[index + 1]]);
    }
    const reverse = line % 2 === 1;
    if (reverse) segments.reverse();
    for (const [from, to] of segments) {
      const [s, e] = reverse ? [to, from] : [from, to];
      passes.push({
        line,
        start: {
          x: across.x * offset + along.x * s,
          y: across.y * offset + along.y * s,
        },
        end: {
          x: across.x * offset + along.x * e,
          y: across.y * offset + along.y * e,
        },
      });
    }
  }
  return { passes, lineCount, widthM };
}

/** Photos needed to cover a pass of `lengthM` at `spacingM` (both ends shot). */
export function photosForPass(lengthM, spacingM) {
  if (!(lengthM >= 0) || !(spacingM > 0)) return 0;
  return Math.ceil(lengthM / spacingM - 1e-9) + 1;
}

/**
 * The whole plan for a boundary.
 * @param {Array<{lon:number, lat:number}>} boundary
 * @param {{camera:object, altitudeM:number, frontOverlap:number,
 *   sideOverlap:number, speedMps:number, heading:('auto'|number)}} settings
 * @returns {object|null} null when the boundary or the settings cannot make a plan
 */
export function planSurvey(boundary, settings) {
  const ring = openRing(boundary);
  const camera = validCamera(settings?.camera);
  const altitudeM = Number(settings?.altitudeM);
  const speedMps = Number(settings?.speedMps);
  const frontOverlap = normalizeOverlap(settings?.frontOverlap);
  const sideOverlap = normalizeOverlap(settings?.sideOverlap);
  if (
    ring.length < 3 ||
    !camera ||
    !(altitudeM > 0) ||
    !(speedMps > 0) ||
    !Number.isFinite(frontOverlap) ||
    !Number.isFinite(sideOverlap)
  )
    return null;
  const centre = polygonCentroid(ring);
  const frame = createLocalFrame(centre);
  const local = ring.map((p) => frame.toLocal(p));
  const heading = normalizeHeading(settings?.heading);
  const bearingDeg = heading === 'auto' ? longestEdgeBearing(local) : heading;
  const gsdM = groundSamplingDistanceM(camera, altitudeM);
  const footprint = imageFootprintM(camera, altitudeM);
  const spacingM = lineSpacingM(camera, altitudeM, sideOverlap);
  const shotSpacingM = photoSpacingM(camera, altitudeM, frontOverlap);
  const { passes, lineCount } = generateFlightLines(local, {
    spacingM,
    bearingDeg,
  });
  let photoCount = 0;
  let surveyDistanceM = 0;
  let transitDistanceM = 0;
  for (let index = 0; index < passes.length; index += 1) {
    const pass = passes[index];
    const length = Math.hypot(
      pass.end.x - pass.start.x,
      pass.end.y - pass.start.y,
    );
    surveyDistanceM += length;
    photoCount += photosForPass(length, shotSpacingM);
    if (index > 0) {
      const previous = passes[index - 1].end;
      transitDistanceM += Math.hypot(
        pass.start.x - previous.x,
        pass.start.y - previous.y,
      );
    }
  }
  const totalDistanceM = surveyDistanceM + transitDistanceM;
  const turns = Math.max(0, passes.length - 1);
  const flightTimeS = totalDistanceM / speedMps + turns * TURN_SECONDS;
  const batterySeconds = camera.batteryMinutes * 60 * USABLE_BATTERY_FRACTION;
  const batteries = passes.length
    ? Math.max(1, Math.ceil(flightTimeS / batterySeconds))
    : 0;
  const photoIntervalS = shotSpacingM / speedMps;
  const warnings = [];
  if (altitudeM > PART_107_MAX_AGL_M + 1e-6) warnings.push('above-part-107');
  if (photoIntervalS < MIN_PHOTO_INTERVAL_S) warnings.push('fast-shutter');
  if (batteries > 1) warnings.push('many-batteries');
  const toLonLat = (p) => frame.toLonLat(p);
  const path = [];
  for (const pass of passes) {
    path.push(toLonLat(pass.start), toLonLat(pass.end));
  }
  return {
    camera,
    altitudeM,
    speedMps,
    frontOverlap,
    sideOverlap,
    bearingDeg,
    headingMode: heading === 'auto' ? 'auto' : 'manual',
    gsdM,
    footprint,
    lineSpacingM: spacingM,
    photoSpacingM: shotSpacingM,
    photoIntervalS,
    lineCount,
    passCount: passes.length,
    photoCount,
    surveyDistanceM,
    transitDistanceM,
    totalDistanceM,
    flightTimeS,
    batterySeconds,
    batteries,
    warnings,
    passes: passes.map((pass) => ({
      line: pass.line,
      start: toLonLat(pass.start),
      end: toLonLat(pass.end),
    })),
    path,
    start: path[0] || null,
    end: path[path.length - 1] || null,
  };
}
