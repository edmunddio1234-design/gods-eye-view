/**
 * Site Survey guided flights ("Scenes"): short camera tours that turn the
 * survey layers on and off as they go, each shot with a one-line caption.
 *
 * Captions describe only what that shot actually puts on screen. The
 * Louisiana outline is an illustrative sample, not a real parcel.
 *
 * Plain data and pure functions: no Cesium, no DOM. Captions are marked with
 * `msg()` and translated where shown.
 */
import { msg } from '../i18n/marker.js';
import { metresPerDegree } from './graticule.js';

/** Seconds each camera move takes, and how long a shot holds after it. */
export const FLIGHT_SECONDS = 2.2;
export const HOLD_MS = 2600;

/** The sample site the Louisiana flight outlines. */
export const SAMPLE_SITE = Object.freeze({
  name: msg('Sample site near Tallulah, Louisiana (illustrative)'),
  lon: -91.23,
  lat: 32.43,
  acres: 300,
});

const ACRE_M2 = 4046.8564224;

/** A square of `acres` centred on a point, as four {lon, lat} corners. */
export function squareOutline(center, acres) {
  const half = Math.sqrt(acres * ACRE_M2) / 2;
  const per = metresPerDegree(center.lat);
  const dLat = half / per.lat;
  const dLon = half / per.lon;
  return [
    { lon: center.lon - dLon, lat: center.lat - dLat },
    { lon: center.lon + dLon, lat: center.lat - dLat },
    { lon: center.lon + dLon, lat: center.lat + dLat },
    { lon: center.lon - dLon, lat: center.lat + dLat },
  ];
}

export const SAMPLE_SITE_OUTLINE = Object.freeze(
  squareOutline(SAMPLE_SITE, SAMPLE_SITE.acres).map(Object.freeze),
);

/**
 * Layers a flight may turn on or off. Place names, boundary lines and the
 * map grid are reference layers: a shot can ask for them (`ensureOn`) but a
 * flight never turns them off.
 */
export const FLIGHT_MANAGED_LAYERS = Object.freeze([
  'ref-roads',
  'topo-hillshade',
  'topo-contours',
  'topo-relief',
  'fema-nfhl',
  'usfws-nwi',
  'nrcs-ssurgo',
  'mrlc-nlcd',
  'usgs-nhd',
  'mon-usgs-water',
  'mon-epa-sites',
  'world-landcover',
  'world-soilgrids',
  'world-surface-water',
  'past-wayback',
]);

/**
 * A shot's `camera.lon/lat` is the place it shows: the player aims the
 * camera at that point from `range` metres away at `heading` and `pitch`,
 * so an oblique shot still ends centred on the place.
 */
const shot = (s) =>
  Object.freeze({ layers: [], ensureOn: [], outline: false, ...s });

export const GUIDED_FLIGHTS = Object.freeze([
  Object.freeze({
    id: 'louisiana',
    label: msg('Louisiana – sample site screening'),
    shots: Object.freeze([
      shot({
        id: 'delta',
        camera: {
          lon: -91.1,
          lat: 31.9,
          range: 900_000,
          heading: 0,
          pitch: -88,
        },
        caption: msg(
          'The Lower Mississippi Delta: the river’s wide floodplain between Arkansas and the Gulf of Mexico.',
        ),
        ensureOn: ['ref-places'],
      }),
      shot({
        id: 'northeast',
        camera: {
          lon: -91.35,
          lat: 32.4,
          range: 160_000,
          heading: 0,
          pitch: -85,
        },
        caption: msg(
          'Northeast Louisiana: parish lines and town names show where a site sits.',
        ),
        ensureOn: ['ref-places', 'ref-boundaries'],
      }),
      shot({
        id: 'site',
        camera: {
          lon: -91.23,
          lat: 32.43,
          range: 5_200,
          heading: 0,
          pitch: -70,
        },
        caption: msg(
          'Sample site near Tallulah, Louisiana (illustrative): a 300-acre outline used only to demonstrate screening.',
        ),
        outline: true,
      }),
      shot({
        id: 'flood-wetlands',
        camera: {
          lon: -91.23,
          lat: 32.43,
          range: 16_000,
          heading: 0,
          pitch: -60,
        },
        caption: msg(
          'FEMA flood zones (blue is a 1% chance each year; orange hatching is moderate risk or land behind a levee) and USFWS wetlands in green.',
        ),
        layers: ['fema-nfhl', 'usfws-nwi'],
        outline: true,
      }),
      shot({
        id: 'soils',
        camera: {
          lon: -91.23,
          lat: 32.43,
          range: 5_000,
          heading: 0,
          pitch: -75,
        },
        caption: msg(
          'USDA soil map units across the sample site; click the ground to read the soil.',
        ),
        layers: ['nrcs-ssurgo'],
        outline: true,
      }),
      shot({
        id: 'topography',
        camera: {
          lon: -91.23,
          lat: 32.43,
          range: 7_000,
          heading: 25,
          pitch: -32,
        },
        caption: msg(
          'Topography: hillshade, USGS contours in feet and 3D terrain raised ×3 show how flat this land is.',
        ),
        layers: ['topo-hillshade', 'topo-contours', 'topo-relief'],
        outline: true,
      }),
    ]),
  }),
  Object.freeze({
    id: 'ghana',
    label: msg('Africa – Ghana'),
    shots: Object.freeze([
      shot({
        id: 'ghana',
        camera: {
          lon: -1.1,
          lat: 7.6,
          range: 1_700_000,
          heading: 0,
          pitch: -88,
        },
        caption: msg(
          'Ghana in West Africa, with country borders and place names from Esri’s world reference map.',
        ),
        ensureOn: ['ref-places'],
      }),
      shot({
        id: 'accra',
        camera: {
          lon: -0.197,
          lat: 5.556,
          range: 20_000,
          heading: 10,
          pitch: -45,
        },
        caption: msg(
          'Accra, Ghana’s capital, on the Gulf of Guinea coast, at city scale on Esri imagery.',
        ),
        ensureOn: ['ref-places'],
      }),
      shot({
        id: 'kumasi',
        camera: {
          lon: -1.624,
          lat: 6.688,
          range: 20_000,
          heading: 0,
          pitch: -45,
        },
        caption: msg('Kumasi, Ghana’s second city, in the Ashanti Region.'),
        ensureOn: ['ref-places'],
      }),
      shot({
        id: 'berekum',
        camera: {
          lon: -2.586,
          lat: 7.454,
          range: 11_000,
          heading: 0,
          pitch: -70,
        },
        caption: msg(
          'Berekum, Bono Region, with roads and 2024 land cover (red is built-up land). 2S Global research looked at how roads and land cover shape urban heat here.',
        ),
        link: Object.freeze({
          href: 'https://2s-global-demo.vercel.app/news-insights/what-roads-reveal-about-rising-urban-heat-in-ghana/',
          label: msg('Read the research'),
        }),
        layers: ['ref-roads', 'world-landcover'],
        ensureOn: ['ref-places'],
      }),
      shot({
        id: 'berekum-topography',
        camera: {
          lon: -2.586,
          lat: 7.454,
          range: 14_000,
          heading: 20,
          pitch: -30,
        },
        caption: msg(
          'Berekum topography: Esri hillshade and global 3D terrain raised ×3 (US contour lines do not cover Ghana).',
        ),
        layers: ['topo-hillshade', 'topo-relief'],
      }),
    ]),
  }),
]);

/** The address parameter that starts a guided flight: `?tour=ghana`. */
export const TOUR_URL_PARAM = 'tour';

/**
 * The flight an address asks to play (`?tour=louisiana` or `?tour=ghana`,
 * in the query or the hash), or null.
 * @param {{search?:string, hash?:string}} location
 */
export function requestedTour(location) {
  const read = (text) =>
    new URLSearchParams(String(text || '').replace(/^[?#]/, '')).get(
      TOUR_URL_PARAM,
    );
  const id = String(read(location?.search) || read(location?.hash) || '')
    .trim()
    .toLowerCase();
  return GUIDED_FLIGHTS.some((f) => f.id === id) ? id : null;
}

/** A flight by id, or the first flight. */
export function flightById(id) {
  return GUIDED_FLIGHTS.find((f) => f.id === id) || GUIDED_FLIGHTS[0];
}

/**
 * The layer changes a shot needs from the current state: managed layers it
 * lists go on, other managed layers go off, `ensureOn` layers go on.
 * @param {{layers:string[], ensureOn:string[]}} target
 * @param {(id:string) => boolean} isOn
 * @returns {{on:string[], off:string[]}}
 */
export function shotLayerPlan(target, isOn) {
  const want = new Set([...(target.layers || []), ...(target.ensureOn || [])]);
  const on = [...want].filter((id) => !isOn(id));
  const off = FLIGHT_MANAGED_LAYERS.filter((id) => !want.has(id) && isOn(id));
  return { on, off };
}

/** The shot index after `index` moved by `delta`, clamped to the flight. */
export function stepShot(flight, index, delta) {
  const last = flight.shots.length - 1;
  return Math.min(last, Math.max(0, index + delta));
}

/** Whether `index` is the last shot. */
export function isLastShot(flight, index) {
  return index >= flight.shots.length - 1;
}
