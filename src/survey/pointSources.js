/**
 * Site Survey monitoring points: USGS water stations and EPA regulated
 * sites. The pure half — request URLs, turning answers into sites, and the
 * rows a click shows. The browser fetches straight from the agencies (both
 * answer with CORS headers); surveyLayers.js does the fetching and drawing.
 *
 * No Cesium, no DOM.
 */
import { msg } from '../i18n/marker.js';

export const USGS_OGC_API =
  'https://api.waterdata.usgs.gov/ogcapi/v0/collections';
export const EPA_EMEF =
  'https://geopub.epa.gov/arcgis/rest/services/EMEF/efpoints/MapServer';

/** Points are fetched only for views smaller than this (degrees). */
export const POINT_VIEW_MAX_DEG = 4;

/**
 * The view box to fetch points for, padded a little and rounded so a small
 * pan reuses the last answer, or null when the view is too large.
 * @param {{west:number, south:number, east:number, north:number}} view degrees
 */
export function pointQueryBox(view, pad = 0.1) {
  if (!view) return null;
  let width = view.east - view.west;
  if (width < 0) width += 360;
  const height = view.north - view.south;
  if (
    !(width > 0) ||
    !(height > 0) ||
    width > POINT_VIEW_MAX_DEG ||
    height > POINT_VIEW_MAX_DEG
  )
    return null;
  const round = (v) => Math.round(v * 1000) / 1000;
  return [
    round(view.west - width * pad),
    round(Math.max(-90, view.south - height * pad)),
    round(view.west + width * (1 + pad)),
    round(Math.min(90, view.north + height * pad)),
  ];
}

/** USGS parameter codes shown by name, in this order. */
export const USGS_PARAMETERS = Object.freeze({
  '00010': msg('Water temperature'),
  '00300': msg('Dissolved oxygen'),
  '00400': msg('pH'),
  '00095': msg('Specific conductance'),
  63680: msg('Turbidity'),
  99133: msg('Nitrate plus nitrite'),
  '00060': msg('Discharge'),
  '00065': msg('Gage height'),
  62611: msg('Groundwater level'),
  72019: msg('Depth to water'),
  '00045': msg('Rainfall'),
});
const PARAMETER_ORDER = Object.keys(USGS_PARAMETERS);

/** The two USGS requests for a box: latest values, and station names. */
export function usgsUrls(box) {
  const bbox = `bbox=${box.join(',')}`;
  return {
    latest: `${USGS_OGC_API}/latest-continuous/items?${bbox}&f=json&limit=1000`,
    names: `${USGS_OGC_API}/monitoring-locations/items?${bbox}&f=json&limit=2000&properties=id,monitoring_location_name`,
  };
}

/** The public station page for a monitoring-location id such as `USGS-07369515`. */
export function usgsStationPage(id) {
  const number = String(id || '').replace(/^USGS-/, '');
  if (!/^[0-9A-Za-z-]{4,20}$/.test(number)) return null;
  return `https://waterdata.usgs.gov/monitoring-location/${encodeURIComponent(number)}/`;
}

/**
 * Stations with their latest reading per parameter.
 * @param {object} latest GeoJSON from latest-continuous
 * @param {object} [names] GeoJSON from monitoring-locations
 * @returns {Array<{id:string, name:string, lon:number, lat:number, readings:Array<{code:string, value:number, unit:string, time:string, status:string}>}>}
 */
export function parseUsgsStations(latest, names) {
  const nameOf = new Map();
  for (const f of names?.features || []) {
    const id = f?.id ?? f?.properties?.id;
    const name = f?.properties?.monitoring_location_name;
    if (id && name) nameOf.set(String(id), String(name));
  }
  const sites = new Map();
  for (const f of latest?.features || []) {
    const p = f?.properties || {};
    const c = f?.geometry?.coordinates;
    const id = p.monitoring_location_id;
    if (!id || !Array.isArray(c) || !Number.isFinite(c[0] + c[1])) continue;
    let site = sites.get(id);
    if (!site) {
      site = {
        id: String(id),
        name: nameOf.get(String(id)) || String(id),
        lon: c[0],
        lat: c[1],
        readings: [],
      };
      sites.set(id, site);
    }
    const value = Number(p.value);
    if (p.value === null || p.value === '' || !Number.isFinite(value)) continue;
    const code = String(p.parameter_code || '');
    if (site.readings.some((r) => r.code === code)) continue;
    site.readings.push({
      code,
      value,
      unit: String(p.unit_of_measure || ''),
      time: String(p.time || ''),
      status: String(p.approval_status || ''),
    });
  }
  const rank = (code) => {
    const index = PARAMETER_ORDER.indexOf(code);
    return index < 0 ? PARAMETER_ORDER.length : index;
  };
  for (const site of sites.values())
    site.readings.sort((a, b) => rank(a.code) - rank(b.code));
  return [...sites.values()];
}

/** EPA program layers in the EMEF point service. */
export const EPA_PROGRAMS = Object.freeze([
  Object.freeze({
    layer: 0,
    name: msg('Superfund'),
    color: '#ff5a4f',
    rank: 3,
  }),
  Object.freeze({
    layer: 4,
    name: msg('Hazardous waste (RCRA)'),
    color: '#ff9b3d',
    rank: 2,
  }),
  Object.freeze({
    layer: 5,
    name: msg('Brownfields'),
    color: '#ffd84d',
    rank: 1,
  }),
]);

/** The EMEF query URL for one program layer and a box. */
export function epaQueryUrl(layer, box) {
  const fields =
    'registry_id,primary_name,location_address,city_name,state_code,pgm_sys_acrnm,pgm_sys_id,facility_url';
  return (
    `${EPA_EMEF}/${Number(layer)}/query?geometry=${box.join(',')}` +
    '&geometryType=esriGeometryEnvelope&inSR=4326&spatialRel=esriSpatialRelIntersects' +
    `&outFields=${fields}&returnGeometry=true&outSR=4326&resultRecordCount=300&f=geojson`
  );
}

/** The public FRS facility record for a registry id. */
export function epaFacilityPage(registryId) {
  const id = String(registryId || '');
  if (!/^\d{6,15}$/.test(id)) return null;
  return `https://frs-public.epa.gov/ords/frs_public2/fii_query_dtl.disp_program_facility?p_registry_id=${id}`;
}

const httpsOnly = (href) => {
  try {
    const url = new URL(String(href));
    if (url.protocol === 'http:') url.protocol = 'https:';
    return url.protocol === 'https:' ? url.href : null;
  } catch {
    return null;
  }
};

/**
 * Sites merged across program layers (one site may be in several).
 * @param {Array<{program: (typeof EPA_PROGRAMS)[number], features: Array}>} answers
 */
export function parseEpaSites(answers) {
  const sites = new Map();
  for (const { program, features } of answers || []) {
    for (const f of features || []) {
      const p = f?.properties || {};
      const c = f?.geometry?.coordinates;
      if (!Array.isArray(c) || !Number.isFinite(c[0] + c[1])) continue;
      const key = p.registry_id
        ? String(p.registry_id)
        : `${c[0].toFixed(5)},${c[1].toFixed(5)}`;
      let site = sites.get(key);
      if (!site) {
        site = {
          id: p.registry_id ? String(p.registry_id) : null,
          name: String(p.primary_name || '').trim(),
          address: [p.location_address, p.city_name, p.state_code]
            .filter(Boolean)
            .join(', '),
          lon: c[0],
          lat: c[1],
          programs: [],
          rank: 0,
          color: program.color,
        };
        sites.set(key, site);
      }
      if (
        !site.programs.some(
          (g) => g.name === program.name && g.systemId === p.pgm_sys_id,
        )
      )
        site.programs.push({
          name: program.name,
          system: p.pgm_sys_acrnm ? String(p.pgm_sys_acrnm) : '',
          systemId: p.pgm_sys_id ? String(p.pgm_sys_id) : '',
          url: p.facility_url ? httpsOnly(p.facility_url) : null,
        });
      if (program.rank > site.rank) {
        site.rank = program.rank;
        site.color = program.color;
      }
    }
  }
  return [...sites.values()];
}

/**
 * A reading for display: the value in its unit, with °F beside °C and a
 * metric conversion of flow and stage when metric units are chosen.
 * @param {{value:number, unit:string}} reading
 * @param {'us'|'metric'} units
 */
export function formatReading(reading, units = 'us') {
  const unit = String(reading.unit || '')
    .replace('ft^3/s', 'ft³/s')
    .replace('uS/cm', 'µS/cm')
    .replace('deg C', '°C');
  const v = reading.value;
  const fixed = (n) =>
    Number(n).toLocaleString('en-US', {
      maximumFractionDigits: Math.abs(n) < 100 ? 2 : 0,
    });
  if (/°C/.test(unit) && units === 'us')
    return `${fixed(v)} °C (${fixed((v * 9) / 5 + 32)} °F)`;
  if (/ft³\/s/.test(unit) && units === 'metric')
    return `${fixed(v * 0.0283168)} m³/s`;
  if (/^ft$/.test(unit) && units === 'metric') return `${fixed(v * 0.3048)} m`;
  return unit ? `${fixed(v)} ${unit}` : fixed(v);
}
