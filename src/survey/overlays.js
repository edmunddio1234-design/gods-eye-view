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

/** @typedef {{color:string, label:string, outline?:boolean}} LegendEntry */

export const SURVEY_OVERLAYS = Object.freeze([
  Object.freeze({
    id: 'fema-nfhl',
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
