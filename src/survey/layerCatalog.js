/**
 * Site Survey map layers beyond the public land overlays: the reference map
 * (place names, boundary lines, a map grid, roads), topography (hillshade,
 * contours, 3D relief), monitoring points (USGS water stations, EPA
 * regulated sites), worldwide layers that also cover places outside the US,
 * and past imagery from the Esri World Imagery Wayback archive.
 *
 * Every source is keyless and answers a browser directly with CORS headers
 * (checked on 2026-10-27 from an `*.onrender.com` origin), so Survey mode
 * works the same under `vite preview` on a public host as on a dev server:
 * nothing here needs the app's own server.
 *
 * Plain data and pure functions: no Cesium, no DOM. Labels and help are
 * marked with `msg()` and translated where shown.
 */
import { msg } from '../i18n/marker.js';

/**
 * ArcGIS REST `export` URL template for Cesium's UrlTemplateImageryProvider
 * on a Web Mercator tiling scheme. The `{westProjected}`… placeholders are
 * Cesium's; everything else is fixed here.
 * @param {string} service MapServer or ImageServer root
 * @param {object} [options]
 * @param {string} [options.layers] e.g. `show:28`
 * @param {number} [options.dpi] lower dpi draws a smaller-scale map in the
 *   same pixels, so scale-limited layers show from higher up
 * @param {number} [options.size] tile edge in pixels
 * @param {string} [options.extra] further fixed query text
 */
export function arcgisExportTemplate(service, options = {}) {
  const { layers = '', dpi = 96, size = 256, extra = '' } = options;
  const image = /\/ImageServer\/?$/.test(service);
  const parts = [
    'bbox={westProjected},{southProjected},{eastProjected},{northProjected}',
    'bboxSR=3857',
    'imageSR=3857',
    `size=${size},${size}`,
    image ? 'format=png32' : `dpi=${dpi}&format=png32`,
    'transparent=true',
    layers ? `layers=${layers}` : '',
    extra,
    'f=image',
  ].filter(Boolean);
  return `${service.replace(/\/+$/, '')}/${image ? 'exportImage' : 'export'}?${parts.join('&')}`;
}

/** WMS 1.1.1 GetMap URL template in Web Mercator for UrlTemplateImageryProvider. */
export function wmsTemplate(base, layer, size = 256) {
  const join = base.includes('?') ? '&' : '?';
  return (
    `${base}${join}SERVICE=WMS&VERSION=1.1.1&REQUEST=GetMap&LAYERS=${encodeURIComponent(layer)}` +
    `&STYLES=&SRS=EPSG:3857&BBOX={westProjected},{southProjected},{eastProjected},{northProjected}` +
    `&WIDTH=${size}&HEIGHT=${size}&FORMAT=image/png&TRANSPARENT=true`
  );
}

const ESRI = 'https://services.arcgisonline.com/ArcGIS/rest/services';

/**
 * Esri World Imagery Wayback releases offered for "then and now". These are
 * release dates of the archive, not capture dates of every pixel: an area
 * nobody re-imaged between two releases looks the same in both.
 * Ids from https://s3-us-west-2.amazonaws.com/config.maptiles.arcgis.com/waybackconfig.json
 */
export const WAYBACK_RELEASES = Object.freeze([
  Object.freeze({ id: 10, date: '2014-02-20', year: '2014' }),
  Object.freeze({ id: 3515, date: '2016-01-13', year: '2016' }),
  Object.freeze({ id: 6036, date: '2019-01-09', year: '2019' }),
  Object.freeze({ id: 5314, date: '2022-05-18', year: '2022' }),
  Object.freeze({ id: 41468, date: '2024-01-18', year: '2024' }),
]);

/** Tile URL template for one Wayback release. */
export function waybackTemplate(releaseId) {
  const id = Number(releaseId);
  if (!Number.isInteger(id) || id <= 0) return null;
  return `https://wayback.maptiles.arcgis.com/arcgis/rest/services/World_Imagery/WMTS/1.0.0/default028mm/MapServer/tile/${id}/{z}/{y}/{x}`;
}

/** Section headings, in panel order. */
export const SURVEY_LAYER_GROUPS = Object.freeze([
  Object.freeze({ id: 'reference', label: msg('Map reference') }),
  Object.freeze({ id: 'topography', label: msg('Topography') }),
  Object.freeze({
    id: 'monitoring',
    label: msg('Water quality and regulated sites'),
  }),
  Object.freeze({ id: 'world', label: msg('Worldwide layers') }),
  Object.freeze({ id: 'past', label: msg('Past imagery (then and now)') }),
]);

/**
 * kind:
 * - `tiles`: XYZ/export imagery draped on the ground (`url`, optional `fallback`)
 * - `grid`: the graticule and 1-mile grid, drawn in the browser
 * - `relief`: 3D terrain heights exaggerated so low relief can be seen
 * - `points`: clickable monitoring points fetched for the view
 * - `wayback`: one past-imagery release at a time
 *
 * coverage: `world` or `us` (the help sentence says so).
 */
export const SURVEY_LAYERS = Object.freeze([
  // ---- reference -------------------------------------------------------
  Object.freeze({
    id: 'ref-places',
    group: 'reference',
    kind: 'tiles',
    defaultOn: true,
    coverage: 'world',
    label: msg('Town and place names'),
    help: msg(
      'Names of towns, cities and places, with country and state lines, drawn over the imagery anywhere in the world.',
    ),
    url: `${ESRI}/Reference/World_Boundaries_and_Places/MapServer/tile/{z}/{y}/{x}`,
    maximumLevel: 19,
    fallback: Object.freeze({
      url: 'https://basemaps.cartocdn.com/rastertiles/dark_only_labels/{z}/{x}/{y}.png',
      maximumLevel: 18,
      attribution: msg('Labels: © OpenStreetMap contributors © CARTO'),
    }),
    attribution: msg(
      'Place names and boundaries: Esri World Boundaries and Places (Esri, HERE, Garmin and the GIS user community).',
    ),
  }),
  Object.freeze({
    id: 'ref-boundaries',
    group: 'reference',
    kind: 'tiles',
    defaultOn: true,
    coverage: 'us',
    label: msg('Parish, county and state lines'),
    help: msg(
      'US parish, county and state boundary lines from the Census Bureau, so you can see which jurisdiction a site is in.',
    ),
    url: arcgisExportTemplate(
      'https://tigerweb.geo.census.gov/arcgis/rest/services/TIGERweb/State_County/MapServer',
      // Every scale band of States and Counties; the service draws the one
      // that fits the tile's scale.
      {
        layers: 'show:0,1,2,3,4,5,6,7,8,9,10,11,12,13,14,15,16',
        dpi: 48,
        size: 512,
      },
    ),
    tileSize: 512,
    maximumLevel: 16,
    brightness: 1.8,
    alpha: 0.9,
    attribution: msg(
      'Boundaries: US Census Bureau TIGERweb (State and County), public domain.',
    ),
  }),
  Object.freeze({
    id: 'ref-grid',
    group: 'reference',
    kind: 'grid',
    defaultOn: true,
    coverage: 'world',
    label: msg('Map grid'),
    help: msg(
      'Latitude and longitude lines with labels, plus a 1-mile grid (1 km in metric) around the site when you zoom in.',
    ),
    attribution: msg('Map grid drawn by the app on the WGS-84 ellipsoid.'),
  }),
  Object.freeze({
    id: 'ref-roads',
    group: 'reference',
    kind: 'tiles',
    defaultOn: false,
    coverage: 'world',
    label: msg('Roads and highways'),
    help: msg(
      'Interstates, highways, main roads and streets from Esri’s transportation map, anywhere in the world.',
    ),
    url: `${ESRI}/Reference/World_Transportation/MapServer/tile/{z}/{y}/{x}`,
    maximumLevel: 19,
    attribution: msg(
      'Roads: Esri World Transportation (Esri, HERE, Garmin and the GIS user community).',
    ),
  }),
  // ---- topography ------------------------------------------------------
  Object.freeze({
    id: 'topo-hillshade',
    group: 'topography',
    kind: 'tiles',
    defaultOn: false,
    coverage: 'world',
    label: msg('Hillshade'),
    help: msg(
      'Shaded relief that makes ridges, valleys and river banks stand out, for the whole world.',
    ),
    url: `${ESRI}/Elevation/World_Hillshade/MapServer/tile/{z}/{y}/{x}`,
    maximumLevel: 16,
    alpha: 0.4,
    fallback: Object.freeze({
      url: 'https://basemap.nationalmap.gov/arcgis/rest/services/USGSShadedReliefOnly/MapServer/tile/{z}/{y}/{x}',
      maximumLevel: 15,
      attribution: msg('Shaded relief: USGS The National Map, public domain.'),
    }),
    attribution: msg(
      'Hillshade: Esri World Hillshade (Esri, USGS, NGA, NASA, CGIAR and others).',
    ),
  }),
  Object.freeze({
    id: 'topo-contours',
    group: 'topography',
    kind: 'tiles',
    defaultOn: false,
    coverage: 'us',
    label: msg('Contour lines (feet)'),
    help: msg(
      'USGS elevation contour lines labelled in feet above sea level; zoom in to read them (US only).',
    ),
    // 1:24,000 contours draw only at large scales; dpi 48 asks for a map
    // twice the scale in the same pixels, so they show from about 15 km up.
    url: arcgisExportTemplate(
      'https://carto.nationalmap.gov/arcgis/rest/services/contours/MapServer',
      { dpi: 48, size: 512 },
    ),
    tileSize: 512,
    maximumLevel: 18,
    attribution: msg('Contours: USGS The National Map, public domain.'),
  }),
  Object.freeze({
    id: 'topo-relief',
    group: 'topography',
    kind: 'relief',
    defaultOn: false,
    coverage: 'world',
    label: msg('3D terrain relief (heights ×3)'),
    help: msg(
      'Raises the real 3D terrain three times higher so gentle slopes are easy to see; tilt the view to look across it.',
    ),
    exaggeration: 3,
    attribution: msg(
      'Terrain: Re:Earth / Mapterhorn terrain, CC BY 4.0, or Cesium World Terrain when a Cesium ion token is set.',
    ),
  }),
  // ---- monitoring points -----------------------------------------------
  Object.freeze({
    id: 'mon-usgs-water',
    group: 'monitoring',
    kind: 'points',
    defaultOn: false,
    coverage: 'us',
    color: '#4fb3ff',
    label: msg('Water-quality stations (USGS)'),
    help: msg(
      'USGS river and water monitoring stations; click a blue dot for its latest readings, their dates and a link to the station page.',
    ),
    attribution: msg(
      'Water data: USGS Water Data APIs (api.waterdata.usgs.gov), provisional data subject to revision.',
    ),
  }),
  Object.freeze({
    id: 'mon-epa-sites',
    group: 'monitoring',
    kind: 'points',
    defaultOn: false,
    coverage: 'us',
    color: '#ff8a4c',
    label: msg('Regulated sites (EPA)'),
    help: msg(
      'Places in EPA Superfund, hazardous waste (RCRA) and brownfields programs; click a dot for the name, program and EPA record.',
    ),
    attribution: msg(
      'Regulated sites: US EPA Facility Registry Service (EMEF), public domain.',
    ),
  }),
  // ---- worldwide -------------------------------------------------------
  Object.freeze({
    id: 'world-landcover',
    group: 'world',
    kind: 'tiles',
    defaultOn: false,
    coverage: 'world',
    label: msg('Global land cover (10 m, 2024)'),
    help: msg(
      'What covers the ground anywhere in the world in 2024, from Sentinel-2 satellite pictures: trees, crops, built-up land, water and more.',
    ),
    url: arcgisExportTemplate(
      'https://ic.imagery1.arcgis.com/arcgis/rest/services/Sentinel2_10m_LandCover/ImageServer',
      // The 2024 map of the yearly time series (UTC, milliseconds).
      { extra: 'time=1704067200000,1735689599000' },
    ),
    maximumLevel: 16,
    alpha: 0.65,
    attribution: msg(
      'Land cover: Sentinel-2 10 m Land Use/Land Cover 2024, Impact Observatory, Microsoft and Esri, CC BY 4.0.',
    ),
  }),
  Object.freeze({
    id: 'world-soilgrids',
    group: 'world',
    kind: 'tiles',
    defaultOn: false,
    coverage: 'world',
    label: msg('Soil clay content (SoilGrids)'),
    help: msg(
      'Modelled clay content of the topsoil anywhere in the world; click the ground to read its sand, silt and clay.',
    ),
    url: wmsTemplate(
      'https://maps.isric.org/mapserv?map=/map/clay.map',
      'clay_0-5cm_mean',
    ),
    maximumLevel: 15,
    alpha: 0.6,
    attribution: msg(
      'Soils: ISRIC SoilGrids 2.0 (0–5 cm mean), CC BY 4.0. maps.isric.org',
    ),
  }),
  Object.freeze({
    id: 'world-surface-water',
    group: 'world',
    kind: 'tiles',
    defaultOn: false,
    coverage: 'world',
    label: msg('Surface water (1984–2021)'),
    help: msg(
      'How often each place was covered by water in 37 years of Landsat pictures, anywhere in the world.',
    ),
    url: 'https://storage.googleapis.com/global-surface-water/tiles2021/occurrence/{z}/{x}/{y}.png',
    maximumLevel: 13,
    alpha: 0.85,
    attribution: msg(
      'Surface water: EC JRC / Google Global Surface Water 1984–2021 (occurrence), Pekel et al. 2016.',
    ),
  }),
  // ---- past imagery ----------------------------------------------------
  Object.freeze({
    id: 'past-wayback',
    group: 'past',
    kind: 'wayback',
    defaultOn: false,
    coverage: 'world',
    label: msg('Show past imagery'),
    help: msg(
      'Swap in the satellite picture from an earlier Esri archive release to compare then and now.',
    ),
    attribution: msg(
      'Past imagery: Esri World Imagery Wayback (Esri, Maxar, Earthstar Geographics).',
    ),
  }),
]);

const BY_ID = new Map(SURVEY_LAYERS.map((layer) => [layer.id, layer]));

/** The catalog entry for an id, or null. */
export function surveyLayer(id) {
  return BY_ID.get(id) || null;
}

/** The layers on by default when Survey mode opens. */
export const SURVEY_DEFAULT_ON = Object.freeze(
  SURVEY_LAYERS.filter((layer) => layer.defaultOn).map((layer) => layer.id),
);

/**
 * Stacking order of draped imagery, bottom to top. Ids missing from this
 * list are not imagery. Public land overlays (overlays.js) slot in between.
 */
export const SURVEY_IMAGERY_ORDER = Object.freeze([
  'past-wayback',
  'topo-hillshade',
  'world-landcover',
  'mrlc-nlcd',
  'world-soilgrids',
  'world-surface-water',
  'usfws-nwi',
  'fema-nfhl',
  'usgs-nhd',
  'nrcs-ssurgo',
  'topo-contours',
  'ref-roads',
  'ref-boundaries',
  'ref-places',
  'ref-grid',
]);

/** Rank of an imagery id in SURVEY_IMAGERY_ORDER, or Infinity. */
export function imageryRank(id) {
  const index = SURVEY_IMAGERY_ORDER.indexOf(id);
  return index < 0 ? Number.POSITIVE_INFINITY : index;
}

/**
 * Where to insert a layer of rank `rank` among layers already on the globe,
 * given their ranks in globe order (bottom first). Returns the position in
 * that list before which it goes, or the list length to go on top.
 * @param {number[]} existingRanks
 * @param {number} rank
 */
export function insertionIndex(existingRanks, rank) {
  for (let index = 0; index < existingRanks.length; index += 1)
    if (existingRanks[index] > rank) return index;
  return existingRanks.length;
}

/**
 * Whether a point is in the United States or its territories (rough boxes:
 * the lower 48, Alaska, Hawaii, Puerto Rico and the US Virgin Islands, Guam
 * and the Northern Marianas). Used only to say that a US-only layer has no
 * data where the map is looking.
 */
export function isInUnitedStates(lon, lat) {
  const boxes = [
    [-125, 24.4, -66.8, 49.5],
    [-170, 51, -129.9, 71.5],
    [-179.2, 51, -170, 53.5],
    [-161, 18.8, -154.7, 22.4],
    [-67.4, 17.6, -64.5, 18.6],
    [144.5, 13.2, 146.2, 20.6],
  ];
  return boxes.some(
    ([w, s, e, n]) => lon >= w && lon <= e && lat >= s && lat <= n,
  );
}

/** Hosts that answer slowly; the globe keeps fewer requests open to each. */
export const SURVEY_SLOW_HOSTS = Object.freeze({
  'hazards.fema.gov:443': 6,
  'fwspublicservices.wim.usgs.gov:443': 6,
  'sdmdataaccess.sc.egov.usda.gov:443': 6,
  'www.mrlc.gov:443': 6,
  'tigerweb.geo.census.gov:443': 6,
  'maps.isric.org:443': 6,
  'ic.imagery1.arcgis.com:443': 6,
  'hydro.nationalmap.gov:443': 3,
  'carto.nationalmap.gov:443': 3,
  'basemap.nationalmap.gov:443': 3,
});
