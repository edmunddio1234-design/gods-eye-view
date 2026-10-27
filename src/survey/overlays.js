/**
 * Site Survey overlays: what each public land-data layer is called, who
 * publishes it, and how to read it.
 *
 * Legend colours follow each service's published symbology; they are a key
 * for reading the map, not a classification of the site. Overlay results are
 * for desktop screening only.
 *
 * Plain data: labels are marked with `msg()` and translated where shown.
 */
import { msg } from '../i18n/marker.js';
import { SURVEY_WMS_SERVICES, surveyWmsBrowserUrl } from './wmsServices.js';
import { arcgisExportTemplate } from './layerCatalog.js';

/**
 * ArcGIS REST export templates the browser requests directly. FEMA's and the
 * USFWS's REST map services answer a browser with CORS (the origin echoed)
 * and drew in a real browser on 2026-10-27, when FEMA's WMS endpoint answered
 * 400 to every GetMap. The WMS route through the app's server stays as the
 * fallback for those two if the REST service stops answering.
 */
const DIRECT_TILES = Object.freeze({
  'fema-nfhl': arcgisExportTemplate(
    'https://hazards.fema.gov/arcgis/rest/services/public/NFHL/MapServer',
    { layers: 'show:28', dpi: 48, size: 512 },
  ),
  'usfws-nwi': arcgisExportTemplate(
    'https://fwspublicservices.wim.usgs.gov/wetlandsmapservice/rest/services/Wetlands/MapServer',
    { layers: 'show:0', dpi: 48, size: 512 },
  ),
  // NHD flowlines and waterbodies (no WMS twin).
  'usgs-nhd': arcgisExportTemplate(
    'https://hydro.nationalmap.gov/arcgis/rest/services/nhd/MapServer',
    { layers: 'show:2,4,6,7,9,10,12', dpi: 96, size: 512 },
  ),
});

/** @typedef {{color:string, label:string, outline?:boolean}} LegendEntry */

export const SURVEY_OVERLAYS = Object.freeze([
  Object.freeze({
    id: 'fema-nfhl',
    coverage: 'us',
    help: msg(
      'FEMA flood zones: blue is high risk (a 1% chance of flooding each year), orange is moderate risk (US only).',
    ),
    label: msg('FEMA flood hazard zones'),
    short: msg('Flood zones'),
    attribution: msg(
      'FEMA National Flood Hazard Layer (NFHL), public domain. hazards.fema.gov',
    ),
    homepage: 'https://www.fema.gov/flood-maps/national-flood-hazard-layer',
    legend: Object.freeze([
      {
        color: '#3d8fd6',
        label: msg('1% annual chance (Zones A, AE, AH, AO, VE)'),
      },
      { color: '#ff7f00', label: msg('0.2% annual chance (shaded Zone X)') },
      { color: '#e8414d', label: msg('Regulatory floodway') },
    ]),
  }),
  Object.freeze({
    id: 'usfws-nwi',
    coverage: 'us',
    help: msg(
      'Wetlands mapped by the US Fish and Wildlife Service, coloured by type, such as forested, marsh or open water (US only).',
    ),
    label: msg('USFWS National Wetlands Inventory'),
    short: msg('Wetlands'),
    attribution: msg(
      'U.S. Fish and Wildlife Service, National Wetlands Inventory, public domain. fws.gov/program/national-wetlands-inventory',
    ),
    homepage: 'https://www.fws.gov/program/national-wetlands-inventory',
    legend: Object.freeze([
      { color: '#7fc31c', label: msg('Freshwater emergent wetland') },
      { color: '#008837', label: msg('Freshwater forested/shrub wetland') },
      { color: '#688cc0', label: msg('Freshwater pond') },
      { color: '#13007c', label: msg('Lake') },
      { color: '#0190bf', label: msg('Riverine') },
      { color: '#66c2a5', label: msg('Estuarine and marine wetland') },
      { color: '#b28653', label: msg('Other') },
    ]),
  }),
  Object.freeze({
    id: 'nrcs-ssurgo',
    coverage: 'us',
    help: msg(
      'USDA soil map units; click the ground to see the soil name, texture, drainage class and farmland class (US only).',
    ),
    label: msg('USDA NRCS soil map units (SSURGO)'),
    short: msg('Soils'),
    attribution: msg(
      'USDA Natural Resources Conservation Service, Soil Survey Geographic Database (SSURGO), public domain. sdmdataaccess.sc.egov.usda.gov',
    ),
    homepage: 'https://websoilsurvey.nrcs.usda.gov/',
    legend: Object.freeze([
      {
        color: '#ffd400',
        label: msg('Soil map unit boundary; labels give the map unit symbol'),
        outline: true,
      },
    ]),
  }),
  Object.freeze({
    id: 'mrlc-nlcd',
    coverage: 'us',
    help: msg(
      'What covered the ground in 2021, such as crops, forest, wetland or towns, from USGS satellite mapping (US only).',
    ),
    label: msg('USGS/MRLC land cover (NLCD 2021)'),
    short: msg('Land cover'),
    attribution: msg(
      'U.S. Geological Survey / Multi-Resolution Land Characteristics Consortium, National Land Cover Database 2021, public domain. mrlc.gov',
    ),
    homepage: 'https://www.mrlc.gov/data',
    legend: Object.freeze([
      { color: '#466b9f', label: msg('Open water') },
      { color: '#dec5c5', label: msg('Developed, open space') },
      { color: '#d99282', label: msg('Developed, low intensity') },
      { color: '#eb0000', label: msg('Developed, medium intensity') },
      { color: '#ab0000', label: msg('Developed, high intensity') },
      { color: '#b3ac9f', label: msg('Barren land') },
      { color: '#68ab5f', label: msg('Deciduous forest') },
      { color: '#1c5f2c', label: msg('Evergreen forest') },
      { color: '#b5c58f', label: msg('Mixed forest') },
      { color: '#ccb879', label: msg('Shrub/scrub') },
      { color: '#dfdfc2', label: msg('Grassland/herbaceous') },
      { color: '#dcd939', label: msg('Pasture/hay') },
      { color: '#ab6c28', label: msg('Cultivated crops') },
      { color: '#b8d9eb', label: msg('Woody wetlands') },
      { color: '#6c9fb8', label: msg('Emergent herbaceous wetlands') },
    ]),
  }),
  Object.freeze({
    id: 'usgs-nhd',
    coverage: 'us',
    help: msg(
      'Rivers, streams, bayous, lakes and ponds from the USGS National Hydrography Dataset (US only).',
    ),
    label: msg('USGS water features (NHD)'),
    short: msg('Water features'),
    attribution: msg(
      'U.S. Geological Survey, National Hydrography Dataset, public domain. hydro.nationalmap.gov',
    ),
    homepage: 'https://www.usgs.gov/national-hydrography',
    legend: Object.freeze([
      { color: '#3fa9f5', label: msg('Rivers, streams and canals') },
      { color: '#9fd3f7', label: msg('Lakes, ponds and reservoirs') },
    ]),
  }),
]);

/** The FIRMS fire layer the app already has, kept on in survey mode. */
export const SURVEY_FIRE_LAYER_ID = 'local-firms';
export const SURVEY_FIRE_ATTRIBUTION = msg(
  'NASA FIRMS active fire detections (MODIS/VIIRS). firms.modaps.eosdis.nasa.gov',
);

/** Credit for the base imagery, by map stack id. */
export const SURVEY_IMAGERY_CREDITS = Object.freeze({
  'esri-imagery': msg(
    'Imagery: Esri World Imagery (Esri, Maxar, Earthstar Geographics and the GIS user community).',
  ),
  photoreal: msg('Imagery: Google Photorealistic 3D Tiles.'),
  'bing-aerial': msg('Imagery: Microsoft Bing Maps via Cesium ion.'),
  'bing-labels': msg('Imagery: Microsoft Bing Maps via Cesium ion.'),
  osm: msg('Imagery: OpenStreetMap contributors, ODbL.'),
});

/** Data sources every report credits, whether or not their overlay was on. */
export const SURVEY_BASE_ATTRIBUTIONS = Object.freeze([
  msg(
    'Terrain: Re:Earth / Mapterhorn terrain, CC BY 4.0, or Cesium World Terrain when a Cesium ion token is set.',
  ),
  msg(
    'Coordinates: MGRS from the mgrs library; areas and distances on the WGS-84 ellipsoid.',
  ),
  msg('Globe: CesiumJS.'),
]);

/** The WMS request settings for an overlay id. */
export function overlayWmsSettings(id) {
  const service = SURVEY_WMS_SERVICES[id];
  if (!service) return null;
  return { url: surveyWmsBrowserUrl(id), layers: service.layers };
}

/**
 * How the browser draws an overlay: a direct REST export template (with the
 * WMS settings as a fallback when there is one), or WMS alone.
 * @returns {{template?: string, wms?: {url:string, layers:string}}|null}
 */
export function overlayTileSettings(id) {
  const template = Object.hasOwn(DIRECT_TILES, id) ? DIRECT_TILES[id] : null;
  const wms = overlayWmsSettings(id);
  if (!template && !wms) return null;
  return { ...(template ? { template } : {}), ...(wms ? { wms } : {}) };
}
