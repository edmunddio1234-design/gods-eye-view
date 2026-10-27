/**
 * What the soil is at a clicked point: the pure half.
 *
 * In the US, USDA NRCS Soil Data Access (SSURGO) gives the map unit name, its
 * main soil component, the surface texture with sand/silt/clay percentages,
 * the drainage class and the farmland class. Soil Data Access answers a
 * browser POST with `Access-Control-Allow-Origin: *` (checked 2026-10-27),
 * so the browser asks it directly; no server route is needed.
 *
 * Worldwide, ISRIC SoilGrids 2.0 gives modelled sand/silt/clay for the top
 * 5 cm (REST API, CORS `*`). Towns and water are masked there.
 *
 * No Cesium, no DOM.
 */
import { msg } from '../i18n/marker.js';

export const SDA_URL =
  'https://SDMDataAccess.sc.egov.usda.gov/Tabular/post.rest';
export const SOILGRIDS_QUERY_URL =
  'https://rest.isric.org/soilgrids/v2.0/properties/query';

const coord = (value, min, max) => {
  const n = Number(value);
  if (!Number.isFinite(n) || n < min || n > max)
    throw new RangeError('coordinate');
  return n.toFixed(6);
};

/**
 * The Soil Data Access request body for the soil under a point. Only numbers
 * the function formats itself are placed in the SQL.
 * @param {{lon:number, lat:number}} point
 */
export function sdaSoilRequest(point) {
  const lon = coord(point.lon, -180, 180);
  const lat = coord(point.lat, -90, 90);
  const query =
    'SELECT TOP 1 mu.muname, mu.farmlndcl, c.compname, c.comppct_r, c.drainagecl, ' +
    'h.sandtotal_r, h.silttotal_r, h.claytotal_r, ' +
    "(SELECT TOP 1 tg.texdesc FROM chtexturegrp tg WHERE tg.chkey = h.chkey AND tg.rvindicator = 'Yes') AS texdesc " +
    "FROM mapunit mu INNER JOIN component c ON c.mukey = mu.mukey AND c.majcompflag = 'Yes' " +
    'LEFT JOIN chorizon h ON h.cokey = c.cokey AND h.hzdept_r = 0 ' +
    `WHERE mu.mukey IN (SELECT * FROM SDA_Get_Mukey_from_intersection_with_WktWgs84('point(${lon} ${lat})')) ` +
    'ORDER BY c.comppct_r DESC';
  return { query, format: 'JSON+COLUMNNAME' };
}

const text = (v) => (v === null || v === undefined ? '' : String(v).trim());
const pct = (v) => {
  const n = Number(v);
  return v === null || v === '' || !Number.isFinite(n) ? null : Math.round(n);
};

/**
 * The soil summary from a Soil Data Access answer, or null when the point
 * has no soil record (water, built-up land, or outside the survey).
 * @returns {{name:string, component:string, componentPct:number|null, texture:string, sand:number|null, silt:number|null, clay:number|null, drainage:string, farmland:string}|null}
 */
export function parseSdaSoil(answer) {
  const table = answer?.Table;
  if (!Array.isArray(table) || table.length < 2 || !Array.isArray(table[0]))
    return null;
  const row = {};
  table[0].forEach((key, index) => {
    row[key] = table[1][index];
  });
  if (!text(row.muname)) return null;
  return {
    name: text(row.muname),
    component: text(row.compname),
    componentPct: pct(row.comppct_r),
    texture: text(row.texdesc),
    sand: pct(row.sandtotal_r),
    silt: pct(row.silttotal_r),
    clay: pct(row.claytotal_r),
    drainage: text(row.drainagecl),
    farmland: text(row.farmlndcl),
  };
}

/** `sand 12%, silt 38%, clay 50%`, or '' when any is missing. */
export function compositionText(soil) {
  if (
    [soil?.sand, soil?.silt, soil?.clay].some(
      (v) => v === null || v === undefined,
    )
  )
    return '';
  return `sand ${soil.sand}%, silt ${soil.silt}%, clay ${soil.clay}%`;
}

/** The SoilGrids point query for the top 5 cm sand, silt and clay. */
export function soilGridsUrl(point) {
  const lon = coord(point.lon, -180, 180);
  const lat = coord(point.lat, -90, 90);
  return `${SOILGRIDS_QUERY_URL}?lon=${lon}&lat=${lat}&property=clay&property=sand&property=silt&depth=0-5cm&value=mean`;
}

/**
 * USDA texture class from sand/silt/clay percentages (the soil texture
 * triangle), as the English class name marked for translation.
 */
export function textureClass(sand, silt, clay) {
  if (![sand, silt, clay].every(Number.isFinite)) return '';
  if (silt + 1.5 * clay < 15) return msg('Sand');
  if (silt + 1.5 * clay >= 15 && silt + 2 * clay < 30) return msg('Loamy sand');
  if (
    (clay >= 7 && clay < 20 && sand > 52 && silt + 2 * clay >= 30) ||
    (clay < 7 && silt < 50 && silt + 2 * clay >= 30)
  )
    return msg('Sandy loam');
  if (clay >= 7 && clay < 27 && silt >= 28 && silt < 50 && sand <= 52)
    return msg('Loam');
  if (
    (silt >= 50 && clay >= 12 && clay < 27) ||
    (silt >= 50 && silt < 80 && clay < 12)
  )
    return msg('Silt loam');
  if (silt >= 80 && clay < 12) return msg('Silt');
  if (clay >= 20 && clay < 35 && silt < 28 && sand > 45)
    return msg('Sandy clay loam');
  if (clay >= 27 && clay < 40 && sand > 20 && sand <= 45)
    return msg('Clay loam');
  if (clay >= 27 && clay < 40 && sand <= 20) return msg('Silty clay loam');
  if (clay >= 35 && sand > 45) return msg('Sandy clay');
  if (clay >= 40 && silt >= 40) return msg('Silty clay');
  if (clay >= 40 && sand <= 45 && silt < 40) return msg('Clay');
  return '';
}

/**
 * Sand/silt/clay percentages from a SoilGrids answer, or null where the
 * model has no value (towns and water are masked).
 */
export function parseSoilGrids(answer) {
  const values = {};
  for (const layer of answer?.properties?.layers || []) {
    const depth = layer?.depths?.[0];
    const mean = depth?.values?.mean;
    const factor = Number(layer?.unit_measure?.d_factor) || 10;
    if (mean === null || mean === undefined || !Number.isFinite(Number(mean)))
      continue;
    values[layer.name] = Math.round(Number(mean) / factor);
  }
  if (!['sand', 'silt', 'clay'].every((k) => Number.isFinite(values[k])))
    return null;
  return {
    sand: values.sand,
    silt: values.silt,
    clay: values.clay,
    texture: textureClass(values.sand, values.silt, values.clay),
  };
}
