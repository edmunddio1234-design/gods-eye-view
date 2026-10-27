/**
 * Site Survey map grid: the pure half.
 *
 * A latitude/longitude graticule whose spacing follows the zoom, with
 * degree-minute labels, and — when zoomed in — a square grid one statute mile
 * (or one kilometre) on a side, centred on the site. The grid is drawn into
 * map tiles by graticuleProvider.js; this file decides where the lines go
 * and what they say.
 *
 * No Cesium, no DOM.
 */

export const MILE_M = 1609.344;
const A = 6378137; // WGS-84 semi-major axis
const E2 = 0.00669437999014; // WGS-84 first eccentricity squared

/** Graticule spacings in degrees, coarse to fine (down to one minute). */
export const GRATICULE_STEPS = Object.freeze([
  30,
  15,
  10,
  5,
  2,
  1,
  0.5,
  0.25,
  1 / 6,
  1 / 12,
  1 / 30,
  1 / 60,
]);

/**
 * The coarsest step that puts at least `minLines` lines across `spanDeg`.
 * @param {number} spanDeg
 * @param {number} [minLines]
 */
export function graticuleStep(spanDeg, minLines = 2) {
  const span = Math.abs(Number(spanDeg));
  if (!Number.isFinite(span) || span <= 0)
    return GRATICULE_STEPS[GRATICULE_STEPS.length - 1];
  for (const step of GRATICULE_STEPS) if (span / step >= minLines) return step;
  return GRATICULE_STEPS[GRATICULE_STEPS.length - 1];
}

/**
 * Line positions (degrees) that are whole multiples of `step` within
 * [min, max], computed from integer multiples so they do not drift.
 */
export function linesInRange(min, max, step) {
  if (!(step > 0) || !(max >= min)) return [];
  const out = [];
  const first = Math.ceil(min / step - 1e-9);
  const last = Math.floor(max / step + 1e-9);
  for (let k = first; k <= last && out.length < 1000; k += 1) {
    const value = k * step;
    out.push(Math.abs(value) < 1e-12 ? 0 : value);
  }
  return out;
}

/**
 * A graticule label: `32°N`, `32°30′N`, `91°15′W`, `0°`. Values are
 * rounded to the nearest minute.
 * @param {number} value degrees
 * @param {boolean} isLat
 */
export function formatGraticuleLabel(value, isLat) {
  let totalMinutes = Math.round(Math.abs(value) * 60);
  if (!isLat && totalMinutes > 180 * 60) totalMinutes = 360 * 60 - totalMinutes;
  const deg = Math.floor(totalMinutes / 60);
  const min = totalMinutes % 60;
  const text = min ? `${deg}°${String(min).padStart(2, '0')}′` : `${deg}°`;
  if (totalMinutes === 0) return '0°';
  if (!isLat && totalMinutes === 180 * 60) return '180°';
  let hemisphere;
  if (isLat) hemisphere = value > 0 ? 'N' : 'S';
  else {
    const wrapped = ((((value + 180) % 360) + 360) % 360) - 180;
    hemisphere = wrapped > 0 ? 'E' : 'W';
  }
  return `${text}${hemisphere}`;
}

/** Metres per degree of latitude and of longitude at a latitude (WGS-84). */
export function metresPerDegree(latDeg) {
  const phi = (latDeg * Math.PI) / 180;
  const s = Math.sin(phi);
  const w = Math.sqrt(1 - E2 * s * s);
  const n = A / w; // prime vertical radius
  const m = (A * (1 - E2)) / (w * w * w); // meridional radius
  return {
    lat: (Math.PI / 180) * m,
    lon: (Math.PI / 180) * n * Math.cos(phi),
  };
}

/**
 * The site grid: lines `cellM` apart in a local square grid centred on
 * `anchor`, expressed as degree offsets (valid for the few tens of
 * kilometres the grid is drawn over).
 * @param {{lon:number, lat:number}} anchor
 * @param {number} cellM
 */
export function siteGridSpacing(anchor, cellM = MILE_M) {
  const per = metresPerDegree(anchor.lat);
  return {
    anchor: { lon: anchor.lon, lat: anchor.lat },
    dLat: cellM / per.lat,
    dLon: cellM / per.lon,
    cellM,
  };
}

/**
 * Site-grid line positions within a box, as whole cell counts from the
 * anchor. Lines beyond `maxCells` cells of the anchor are left out, so the
 * grid stays around the site.
 * @param {{west:number, south:number, east:number, north:number}} box degrees
 * @param {ReturnType<typeof siteGridSpacing>} spacing
 * @param {number} [maxCells]
 */
export function siteGridLines(box, spacing, maxCells = 12) {
  const { anchor, dLat, dLon } = spacing;
  const pick = (min, max, origin, step) => {
    const out = [];
    const lo = Math.max(-maxCells, Math.ceil((min - origin) / step - 1e-9));
    const hi = Math.min(maxCells, Math.floor((max - origin) / step + 1e-9));
    for (let k = lo; k <= hi; k += 1) out.push({ k, value: origin + k * step });
    return out;
  };
  const lonLo = anchor.lon - maxCells * dLon;
  const lonHi = anchor.lon + maxCells * dLon;
  const latLo = anchor.lat - maxCells * dLat;
  const latHi = anchor.lat + maxCells * dLat;
  return {
    lons: pick(box.west, box.east, anchor.lon, dLon),
    lats: pick(box.south, box.north, anchor.lat, dLat),
    extent: {
      west: lonLo,
      east: lonHi,
      south: latLo,
      north: latHi,
    },
  };
}

/**
 * Grid anchors for a box when no site is drawn: the south-west corner of
 * every whole-degree cell the box touches, each with the cell as the extent
 * its lines stay inside. Within a cell the grid is square to within a
 * fraction of a percent; it restarts at each whole degree.
 * @param {{west:number, south:number, east:number, north:number}} box
 * @param {number} cellM
 */
export function degreeCellGrids(box, cellM = MILE_M) {
  const out = [];
  for (
    let lat = Math.floor(box.south);
    lat < box.north && out.length < 16;
    lat += 1
  )
    for (
      let lon = Math.floor(box.west);
      lon < box.east && out.length < 16;
      lon += 1
    ) {
      if (lat < -85 || lat >= 85) continue;
      const spacing = siteGridSpacing({ lon, lat }, cellM);
      out.push({
        spacing,
        clip: { west: lon, south: lat, east: lon + 1, north: lat + 1 },
      });
    }
  return out;
}

/** The tile level from which the site grid is drawn (cells a few px wide below it). */
export const SITE_GRID_MIN_LEVEL = 11;
