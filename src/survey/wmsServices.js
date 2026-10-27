/**
 * The public land-data map services Site Survey can overlay, and the policy
 * the local proxy applies to them.
 *
 * Each service is a keyless, public OGC WMS run by a US federal agency. The
 * browser requests two of them directly: the NRCS and MRLC GetMap answers
 * carry `Access-Control-Allow-Origin: *` and loaded in a real browser on
 * 2026-10-27. The other two go through the app's own server at
 * `/api/survey-wms/<id>`: FEMA's NFHL map server could not be checked (it
 * answered 504 that day), and the USFWS wetlands service, although it echoes
 * the origin to a single request, refused CORS to a browser loading a
 * screenful of tiles at once. The route forwards only GetMap requests for the
 * one configured layer to the one configured host. It is not a general
 * proxy: the upstream is chosen from this table by id, never from the
 * request.
 *
 * Plain data and pure functions: imported by the browser and by
 * `server/providers/surveyWms.js`.
 */

/** The proxy route prefix; `/<id>` selects a service from the table below. */
export const SURVEY_WMS_ROUTE = '/api/survey-wms';

export const SURVEY_WMS_SERVICES = Object.freeze({
  'fema-nfhl': Object.freeze({
    url: 'https://hazards.fema.gov/arcgis/services/public/NFHL/MapServer/WMSServer',
    // NFHL map-service layer 28 is "Flood Hazard Zones" (REST catalog,
    // https://hazards.fema.gov/arcgis/rest/services/public/NFHL/MapServer).
    // ArcGIS WMS names layers by that id.
    layers: '28',
    proxied: true,
  }),
  'usfws-nwi': Object.freeze({
    url: 'https://fwspublicservices.wim.usgs.gov/wetlandsmapservice/services/Wetlands/MapServer/WMSServer',
    // GetCapabilities lists one layer, "0" (title "Wetlands").
    layers: '0',
    proxied: true,
  }),
  'nrcs-ssurgo': Object.freeze({
    url: 'https://SDMDataAccess.sc.egov.usda.gov/Spatial/SDM.wms',
    // "Soil Mapunit Polygon" in GetCapabilities.
    layers: 'mapunitpoly',
    proxied: false,
  }),
  'mrlc-nlcd': Object.freeze({
    url: 'https://www.mrlc.gov/geoserver/mrlc_display/wms',
    // The newest CONUS land-cover layer the service lists (NLCD 2021).
    layers: 'NLCD_2021_Land_Cover_L48',
    proxied: false,
  }),
});

const MAX_TILE_PX = 1024;
const ALLOWED_FORMATS = new Set(['image/png', 'image/png8', 'image/jpeg']);
const ALLOWED_SRS = new Set(['EPSG:4326', 'EPSG:3857', 'CRS:84']);

/**
 * The upstream GetMap URL for a proxied request, or an `{error}` describing
 * why it is refused. Only GetMap for the service's own layer is forwarded;
 * every forwarded parameter is re-written from a validated value, never
 * copied, so nothing the browser adds reaches the upstream.
 * @param {string} id service id
 * @param {URLSearchParams} params the browser's query
 * @returns {{url: string} | {error: string, status: number}}
 */
export function surveyWmsUpstreamUrl(id, params) {
  const service = Object.hasOwn(SURVEY_WMS_SERVICES, id)
    ? SURVEY_WMS_SERVICES[id]
    : null;
  if (!service) return { error: 'unknown_service', status: 404 };
  const get = (name) => {
    for (const [key, value] of params) {
      if (key.toLowerCase() === name) return value;
    }
    return null;
  };
  if (String(get('request') || '').toLowerCase() !== 'getmap')
    return { error: 'only_getmap', status: 400 };
  if (get('layers') !== service.layers)
    return { error: 'layer_not_allowed', status: 400 };
  const version = get('version') || '1.1.1';
  if (version !== '1.1.1' && version !== '1.3.0')
    return { error: 'bad_version', status: 400 };
  const srs = get(version === '1.3.0' ? 'crs' : 'srs') || '';
  if (!ALLOWED_SRS.has(srs)) return { error: 'bad_srs', status: 400 };
  const bbox = String(get('bbox') || '')
    .split(',')
    .map(Number);
  if (bbox.length !== 4 || !bbox.every(Number.isFinite))
    return { error: 'bad_bbox', status: 400 };
  const width = Number(get('width'));
  const height = Number(get('height'));
  if (
    !Number.isInteger(width) ||
    !Number.isInteger(height) ||
    width < 1 ||
    height < 1 ||
    width > MAX_TILE_PX ||
    height > MAX_TILE_PX
  )
    return { error: 'bad_size', status: 400 };
  const format = String(get('format') || 'image/png').toLowerCase();
  if (!ALLOWED_FORMATS.has(format)) return { error: 'bad_format', status: 400 };
  const out = new URL(service.url);
  out.searchParams.set('service', 'WMS');
  out.searchParams.set('version', version);
  out.searchParams.set('request', 'GetMap');
  out.searchParams.set('layers', service.layers);
  out.searchParams.set('styles', '');
  out.searchParams.set(version === '1.3.0' ? 'crs' : 'srs', srs);
  out.searchParams.set('bbox', bbox.join(','));
  out.searchParams.set('width', String(width));
  out.searchParams.set('height', String(height));
  out.searchParams.set('format', format);
  out.searchParams.set(
    'transparent',
    String(get('transparent') || '').toLowerCase() === 'false'
      ? 'false'
      : 'true',
  );
  return { url: out.href };
}

/** The address the browser requests a service at: direct or through the proxy. */
export function surveyWmsBrowserUrl(id) {
  const service = SURVEY_WMS_SERVICES[id];
  if (!service) return null;
  return service.proxied ? `${SURVEY_WMS_ROUTE}/${id}` : service.url;
}
