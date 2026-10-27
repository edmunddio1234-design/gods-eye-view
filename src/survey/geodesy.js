/**
 * Site Survey geodesy: the pure half.
 *
 * Everything here works on the WGS-84 ellipsoid rather than on a flat map:
 *
 * - AREA is exact for the ellipsoid. Each latitude is mapped to its AUTHALIC
 *   latitude, which carries the ellipsoid onto a sphere of equal surface area
 *   (radius `AUTHALIC_RADIUS_M`) without changing any area, and the polygon's
 *   spherical excess is summed edge by edge there.
 * - PERIMETER is the sum of ellipsoidal geodesic lengths (Vincenty's inverse
 *   formula, millimetre-accurate), falling back to a great circle only for
 *   the nearly antipodal pairs Vincenty cannot resolve, which no parcel has.
 * - The flight planner and the terrain grid need a plane to lay lines on. They
 *   get a local east/north frame at the site, scaled by the ellipsoid's own
 *   radii of curvature there. Distances on it agree with the ellipsoid to
 *   about one part in 25,000 two kilometres from the origin (8 cm) and one
 *   part in 5,000 at ten — far inside what a flight line or a terrain sample
 *   grid can resolve. Area, perimeter and the report's figures never use it.
 *
 * No Cesium, no DOM: importable under `node --test`.
 */

/** WGS-84 semi-major axis, metres. */
export const WGS84_A = 6378137;
/** WGS-84 flattening. */
export const WGS84_F = 1 / 298.257223563;
const WGS84_B = WGS84_A * (1 - WGS84_F);
const E2 = WGS84_F * (2 - WGS84_F);
const E = Math.sqrt(E2);

const DEG = Math.PI / 180;

/** q(φ) of the authalic-latitude transform (Snyder, Map Projections, 3-12). */
function authalicQ(sinPhi) {
  return (
    (1 - E2) *
    (sinPhi / (1 - E2 * sinPhi * sinPhi) -
      (1 / (2 * E)) * Math.log((1 - E * sinPhi) / (1 + E * sinPhi)))
  );
}
const QP = authalicQ(1);

/** Radius of the sphere with the same surface area as WGS-84, metres. */
export const AUTHALIC_RADIUS_M = WGS84_A * Math.sqrt(QP / 2);

/** Authalic latitude, radians, for a geodetic latitude in radians. */
export function authalicLatitude(phi) {
  const ratio = authalicQ(Math.sin(phi)) / QP;
  return Math.asin(Math.max(-1, Math.min(1, ratio)));
}

/** Whether `point` is a usable {lon, lat}. */
export function isLonLat(point) {
  return (
    Boolean(point) &&
    Number.isFinite(point.lon) &&
    Number.isFinite(point.lat) &&
    Math.abs(point.lat) <= 90 &&
    Math.abs(point.lon) <= 180
  );
}

/**
 * The ring's vertices without a closing repeat, longitudes made continuous
 * relative to the first vertex so nothing tears at the antimeridian.
 * @param {Array<{lon:number, lat:number}>} ring
 * @returns {Array<{lon:number, lat:number}>}
 */
export function openRing(ring) {
  const points = (Array.isArray(ring) ? ring : []).filter(isLonLat);
  if (points.length > 1) {
    const first = points[0];
    const last = points[points.length - 1];
    if (first.lon === last.lon && first.lat === last.lat) points.pop();
  }
  if (!points.length) return [];
  const reference = points[0].lon;
  return points.map((point) => {
    let lon = point.lon;
    while (lon - reference > 180) lon -= 360;
    while (lon - reference < -180) lon += 360;
    return { lon, lat: point.lat };
  });
}

/** A continuous longitude brought back into [-180, 180). */
export function wrapLon(lon) {
  if (!Number.isFinite(lon)) return lon;
  if (lon >= -180 && lon < 180) return lon;
  const value = ((((lon + 180) % 360) + 360) % 360) - 180;
  return Object.is(value, -0) ? 0 : value;
}

/**
 * Area of a polygon on the WGS-84 ellipsoid, square metres. The ring may be
 * open or closed and wound either way; self-intersecting rings give the net
 * signed area, as every polygon-area formula does.
 * @param {Array<{lon:number, lat:number}>} ring
 */
export function polygonAreaM2(ring) {
  const points = openRing(ring);
  if (points.length < 3) return 0;
  let excess = 0;
  for (let index = 0; index < points.length; index += 1) {
    const a = points[index];
    const b = points[(index + 1) % points.length];
    const beta1 = authalicLatitude(a.lat * DEG);
    const beta2 = authalicLatitude(b.lat * DEG);
    const dLon = (b.lon - a.lon) * DEG;
    // Signed excess of the triangle between this edge and the north pole,
    // expressed through the equator (tan half-angle form, stable for the
    // short edges a parcel has).
    const t1 = Math.tan(beta1 / 2);
    const t2 = Math.tan(beta2 / 2);
    excess += 2 * Math.atan2(Math.tan(dLon / 2) * (t1 + t2), 1 + t1 * t2);
  }
  return Math.abs(excess) * AUTHALIC_RADIUS_M * AUTHALIC_RADIUS_M;
}

/**
 * Ellipsoidal geodesic distance in metres (Vincenty inverse). Identical
 * points give 0; a pair Vincenty cannot converge on falls back to a great
 * circle on the authalic sphere.
 * @param {{lon:number, lat:number}} from
 * @param {{lon:number, lat:number}} to
 */
export function geodesicDistanceM(from, to) {
  if (!isLonLat(from) || !isLonLat(to)) return NaN;
  const phi1 = from.lat * DEG;
  const phi2 = to.lat * DEG;
  let lonDelta = (to.lon - from.lon) * DEG;
  while (lonDelta > Math.PI) lonDelta -= 2 * Math.PI;
  while (lonDelta < -Math.PI) lonDelta += 2 * Math.PI;
  if (phi1 === phi2 && lonDelta === 0) return 0;
  const U1 = Math.atan((1 - WGS84_F) * Math.tan(phi1));
  const U2 = Math.atan((1 - WGS84_F) * Math.tan(phi2));
  const sinU1 = Math.sin(U1);
  const cosU1 = Math.cos(U1);
  const sinU2 = Math.sin(U2);
  const cosU2 = Math.cos(U2);
  let lambda = lonDelta;
  for (let iteration = 0; iteration < 200; iteration += 1) {
    const sinLambda = Math.sin(lambda);
    const cosLambda = Math.cos(lambda);
    const sinSigma = Math.hypot(
      cosU2 * sinLambda,
      cosU1 * sinU2 - sinU1 * cosU2 * cosLambda,
    );
    if (sinSigma === 0) return 0;
    const cosSigma = sinU1 * sinU2 + cosU1 * cosU2 * cosLambda;
    const sigma = Math.atan2(sinSigma, cosSigma);
    const sinAlpha = (cosU1 * cosU2 * sinLambda) / sinSigma;
    const cos2Alpha = 1 - sinAlpha * sinAlpha;
    const cos2SigmaM =
      cos2Alpha === 0 ? 0 : cosSigma - (2 * sinU1 * sinU2) / cos2Alpha;
    const C = (WGS84_F / 16) * cos2Alpha * (4 + WGS84_F * (4 - 3 * cos2Alpha));
    const previous = lambda;
    lambda =
      lonDelta +
      (1 - C) *
        WGS84_F *
        sinAlpha *
        (sigma +
          C *
            sinSigma *
            (cos2SigmaM + C * cosSigma * (-1 + 2 * cos2SigmaM * cos2SigmaM)));
    if (Math.abs(lambda - previous) < 1e-12) {
      const uSq =
        (cos2Alpha * (WGS84_A * WGS84_A - WGS84_B * WGS84_B)) /
        (WGS84_B * WGS84_B);
      const A =
        1 + (uSq / 16384) * (4096 + uSq * (-768 + uSq * (320 - 175 * uSq)));
      const B = (uSq / 1024) * (256 + uSq * (-128 + uSq * (74 - 47 * uSq)));
      const deltaSigma =
        B *
        sinSigma *
        (cos2SigmaM +
          (B / 4) *
            (cosSigma * (-1 + 2 * cos2SigmaM * cos2SigmaM) -
              (B / 6) *
                cos2SigmaM *
                (-3 + 4 * sinSigma * sinSigma) *
                (-3 + 4 * cos2SigmaM * cos2SigmaM)));
      return WGS84_B * A * (sigma - deltaSigma);
    }
  }
  // Nearly antipodal: Vincenty does not converge. A great circle on the
  // authalic sphere is within half a percent, and no survey site is here.
  const b1 = authalicLatitude(phi1);
  const b2 = authalicLatitude(phi2);
  const h =
    Math.sin((b2 - b1) / 2) ** 2 +
    Math.cos(b1) * Math.cos(b2) * Math.sin(lonDelta / 2) ** 2;
  return 2 * AUTHALIC_RADIUS_M * Math.asin(Math.min(1, Math.sqrt(h)));
}

/** Length of an open path, metres. */
export function pathLengthM(points) {
  let total = 0;
  for (let index = 1; index < (points?.length || 0); index += 1)
    total += geodesicDistanceM(points[index - 1], points[index]);
  return total;
}

/** Perimeter of a ring (open or closed), metres. */
export function perimeterM(ring) {
  const points = openRing(ring);
  if (points.length < 2) return 0;
  return pathLengthM([...points, points[0]]);
}

/**
 * A plane tangent to the ellipsoid at `origin`: x east and y north, metres.
 * Scaled by the meridional (M) and prime-vertical (N) radii of curvature at
 * the origin, so distances agree with the ellipsoid near the site (see the
 * module note for how near).
 * @param {{lon:number, lat:number}} origin
 */
export function createLocalFrame(origin) {
  const phi0 = origin.lat * DEG;
  const sin0 = Math.sin(phi0);
  const w = Math.sqrt(1 - E2 * sin0 * sin0);
  const N = WGS84_A / w;
  const M = (WGS84_A * (1 - E2)) / (w * w * w);
  const kx = N * Math.cos(phi0) * DEG;
  const ky = M * DEG;
  const lon0 = origin.lon;
  const lat0 = origin.lat;
  const continuous = (lon) => {
    let value = lon;
    while (value - lon0 > 180) value -= 360;
    while (value - lon0 < -180) value += 360;
    return value;
  };
  return Object.freeze({
    origin: Object.freeze({ lon: lon0, lat: lat0 }),
    /** @param {{lon:number, lat:number}} point */
    toLocal(point) {
      return {
        x: (continuous(point.lon) - lon0) * kx,
        y: (point.lat - lat0) * ky,
      };
    },
    /** @param {{x:number, y:number}} point */
    toLonLat(point) {
      return {
        lon: wrapLon(lon0 + point.x / kx),
        lat: lat0 + point.y / ky,
      };
    },
  });
}

/** Vertex-average {lon, lat} of a ring, continuous across the antimeridian. */
export function vertexCentre(ring) {
  const points = openRing(ring);
  if (!points.length) return null;
  return {
    lon: wrapLon(points.reduce((sum, p) => sum + p.lon, 0) / points.length),
    lat: points.reduce((sum, p) => sum + p.lat, 0) / points.length,
  };
}

/** Signed planar area of an {x, y} ring (positive counter-clockwise). */
export function planarSignedArea(points) {
  let twice = 0;
  for (let index = 0; index < points.length; index += 1) {
    const a = points[index];
    const b = points[(index + 1) % points.length];
    twice += a.x * b.y - b.x * a.y;
  }
  return twice / 2;
}

/**
 * Area-weighted centroid of a ring, {lon, lat}. Computed on the local frame
 * at the ring's centre, where the plane and the ellipsoid agree to well under
 * a metre for any parcel. Falls back to the vertex centre for a ring with no
 * area.
 * @param {Array<{lon:number, lat:number}>} ring
 */
export function polygonCentroid(ring) {
  const points = openRing(ring);
  if (!points.length) return null;
  const centre = vertexCentre(points);
  if (points.length < 3) return centre;
  const frame = createLocalFrame(centre);
  const local = points.map((p) => frame.toLocal(p));
  const area = planarSignedArea(local);
  if (Math.abs(area) < 1e-9) return centre;
  let cx = 0;
  let cy = 0;
  for (let index = 0; index < local.length; index += 1) {
    const a = local[index];
    const b = local[(index + 1) % local.length];
    const cross = a.x * b.y - b.x * a.y;
    cx += (a.x + b.x) * cross;
    cy += (a.y + b.y) * cross;
  }
  return frame.toLonLat({ x: cx / (6 * area), y: cy / (6 * area) });
}

/** Whether planar point `p` lies inside planar ring `ring` (even-odd rule). */
export function pointInRing(p, ring) {
  let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i, i += 1) {
    const a = ring[i];
    const b = ring[j];
    if (
      a.y > p.y !== b.y > p.y &&
      p.x < ((b.x - a.x) * (p.y - a.y)) / (b.y - a.y) + a.x
    )
      inside = !inside;
  }
  return inside;
}

/**
 * Initial bearing from `from` to `to` on the local frame, degrees clockwise
 * from north in [0, 360).
 */
export function planarBearingDeg(from, to) {
  const degrees = Math.atan2(to.x - from.x, to.y - from.y) / DEG;
  return (degrees + 360) % 360;
}
