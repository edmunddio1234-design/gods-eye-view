/**
 * Site Survey mode policy: the pure half.
 *
 * Survey mode is a land-survey workspace, so the layers and chrome that watch
 * people, vehicles and the military step aside while it is on and come back
 * when it is turned off. Which layers those are, how the mode is asked for
 * in an address, and the wording the mode uses are decided here.
 *
 * No Cesium, no DOM.
 */
import { msg } from '../i18n/marker.js';

/**
 * Layers hidden while survey mode is on: tracking, cameras, signals and
 * military layers. Environmental layers (fires, weather, earthquakes) and
 * infrastructure context stay available. NASA FIRMS (`local-firms`) is
 * deliberately NOT in this list.
 */
export const SURVEY_HIDDEN_LAYER_IDS = Object.freeze([
  'flights',
  'military',
  'military-awareness',
  'military-installations',
  'cctv',
  'alpr-cameras',
  'ais-live-vessels',
  'satellites',
  'gnss-integrity',
  's2-ghostmaps',
  'radio',
  'rocket-launches',
  'local-adsb',
  'bhote-koshi-2026',
  'bhote-koshi-locator',
]);
const HIDDEN = new Set(SURVEY_HIDDEN_LAYER_IDS);

/** Whether survey mode keeps `layerId` off. */
export function isSurveyHiddenLayer(layerId) {
  return HIDDEN.has(layerId);
}

/** Why a hidden layer cannot be turned on in survey mode. */
export const SURVEY_LAYER_BLOCK_REASON = msg(
  'Hidden in Site Survey mode. Leave Site Survey to use this layer.',
);

/**
 * The visibility-guard verdict for a lifecycle change while survey mode is
 * on: the block reason for turning a hidden layer ON, otherwise null.
 * @param {{layerId:string, enabled:boolean}} change
 * @returns {string|null}
 */
export function surveyVisibilityVerdict(change) {
  if (change?.enabled && isSurveyHiddenLayer(change.layerId))
    return SURVEY_LAYER_BLOCK_REASON;
  return null;
}

/** The address parameter that opens the app in survey mode. */
export const SURVEY_URL_PARAM = 'survey';

/**
 * Whether an address asks for survey mode: `?survey=1` (which share links
 * carry, because they keep the app's query), or `survey=1` in the hash.
 * @param {{search?:string, hash?:string}} location
 */
export function isSurveyRequested(location) {
  const search = new URLSearchParams(String(location?.search || ''));
  if (search.get(SURVEY_URL_PARAM) === '1') return true;
  const hash = new URLSearchParams(
    String(location?.hash || '').replace(/^#/, ''),
  );
  return hash.get(SURVEY_URL_PARAM) === '1';
}

/**
 * `href` with the survey flag set or removed in its query. The hash is kept
 * as it is, so the live view the share link manager writes there survives.
 * @param {string} href
 * @param {boolean} on
 * @returns {string}
 */
export function withSurveyFlag(href, on) {
  const url = new URL(href);
  if (on) url.searchParams.set(SURVEY_URL_PARAM, '1');
  else url.searchParams.delete(SURVEY_URL_PARAM);
  return url.href;
}

/** The map stack survey mode prefers: draped imagery the overlays can sit on. */
export const SURVEY_MAP_STACK = 'esri-imagery';

/**
 * Map stacks that show the globe surface, where WMS overlays and terrain
 * draping work. Google Photorealistic 3D hides the globe under its mesh.
 */
export const SURVEY_GLOBE_STACKS = Object.freeze([
  'esri-imagery',
  'bing-aerial',
  'bing-labels',
  'osm',
]);

/** Chrome wording in survey mode, by element id. */
export const SURVEY_CHROME_TEXT = Object.freeze({
  subtitle: msg('SITE SURVEY · DESKTOP REVIEW'),
});
