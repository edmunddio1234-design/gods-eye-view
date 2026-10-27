/**
 * Site Survey units: US customary first, metric on request.
 *
 * Values are metres, square metres and metres per second everywhere inside
 * Site Survey; these helpers are the only place they become display text.
 * Numbers go through the app's locale formatter. Unit symbols (ac, ha, ft,
 * m, mph, km/h) read the same in every language, so they are not translated.
 *
 * No Cesium, no DOM.
 */
import { formatNumber } from '../i18n/index.js';

export const UNIT_SYSTEMS = Object.freeze(['us', 'metric']);
/** Where the choice is remembered, like the app's other per-browser settings. */
export const UNIT_STORAGE_KEY = 'gev:survey-units:v1';

export const M_PER_FT = 0.3048;
export const M2_PER_ACRE = 4046.8564224;
export const M2_PER_HECTARE = 10_000;
export const M_PER_MILE = 1609.344;
export const MPS_PER_MPH = 0.44704;
export const MPS_PER_KMH = 1 / 3.6;
export const CM_PER_INCH = 2.54;

/** @param {unknown} value @returns {'us'|'metric'} */
export function normalizeUnitSystem(value) {
  return value === 'metric' ? 'metric' : 'us';
}

/** The remembered unit system; US when nothing is stored or storage throws. */
export function readUnitSystem(storage = globalThis.localStorage) {
  try {
    return normalizeUnitSystem(storage?.getItem(UNIT_STORAGE_KEY));
  } catch {
    return 'us';
  }
}

/** Remember the unit system. Returns false when storage is unavailable. */
export function writeUnitSystem(system, storage = globalThis.localStorage) {
  try {
    storage?.setItem(UNIT_STORAGE_KEY, normalizeUnitSystem(system));
    return true;
  } catch {
    return false;
  }
}

const fixed = (value, digits) =>
  formatNumber(value, {
    minimumFractionDigits: digits,
    maximumFractionDigits: digits,
  });

/** "12.34 ac" or "4.99 ha". */
export function formatArea(m2, system) {
  if (!Number.isFinite(m2)) return '—';
  if (normalizeUnitSystem(system) === 'metric') {
    const ha = m2 / M2_PER_HECTARE;
    return `${fixed(ha, ha < 10 ? 2 : 1)} ha`;
  }
  const acres = m2 / M2_PER_ACRE;
  return `${fixed(acres, acres < 10 ? 2 : 1)} ac`;
}

/** A boundary-scale length: "2,640 ft" or "805 m". */
export function formatLength(m, system) {
  if (!Number.isFinite(m)) return '—';
  if (normalizeUnitSystem(system) === 'metric') return `${fixed(m, 0)} m`;
  return `${fixed(m / M_PER_FT, 0)} ft`;
}

/** A flight-scale distance: "3.4 mi" or "5.5 km" (feet/metres when short). */
export function formatDistance(m, system) {
  if (!Number.isFinite(m)) return '—';
  if (normalizeUnitSystem(system) === 'metric') {
    if (m < 1000) return `${fixed(m, 0)} m`;
    return `${fixed(m / 1000, m < 10_000 ? 2 : 1)} km`;
  }
  if (m < M_PER_MILE / 4) return `${fixed(m / M_PER_FT, 0)} ft`;
  const miles = m / M_PER_MILE;
  return `${fixed(miles, miles < 10 ? 2 : 1)} mi`;
}

/** An elevation or height: "87 ft" or "26.5 m". */
export function formatHeight(m, system) {
  if (!Number.isFinite(m)) return '—';
  if (normalizeUnitSystem(system) === 'metric')
    return `${fixed(m, Math.abs(m) < 100 ? 1 : 0)} m`;
  return `${fixed(m / M_PER_FT, 0)} ft`;
}

/** "22 mph" or "35 km/h". */
export function formatSpeed(mps, system) {
  if (!Number.isFinite(mps)) return '—';
  if (normalizeUnitSystem(system) === 'metric')
    return `${fixed(mps / MPS_PER_KMH, 0)} km/h`;
  return `${fixed(mps / MPS_PER_MPH, 0)} mph`;
}

/** Ground sampling distance in both units: "0.42 in/px · 1.07 cm/px". */
export function formatGsd(metresPerPixel) {
  if (!Number.isFinite(metresPerPixel)) return '—';
  const cm = metresPerPixel * 100;
  return `${fixed(cm / CM_PER_INCH, 2)} in/px · ${fixed(cm, 2)} cm/px`;
}

/** A plain percentage: "4.2 %". */
export function formatPercent(value, digits = 1) {
  if (!Number.isFinite(value)) return '—';
  return `${fixed(value, digits)} %`;
}

/** A duration in minutes and seconds: "18 min 05 s". */
export function formatDuration(seconds) {
  if (!Number.isFinite(seconds) || seconds < 0) return '—';
  const total = Math.round(seconds);
  const minutes = Math.floor(total / 60);
  const rest = String(total % 60).padStart(2, '0');
  return `${formatNumber(minutes)} min ${rest} s`;
}

/** Input value (ft or m) to metres. */
export function heightInputToMetres(value, system) {
  const number = Number(value);
  if (!Number.isFinite(number)) return NaN;
  return normalizeUnitSystem(system) === 'metric' ? number : number * M_PER_FT;
}

/** Metres to the input value shown for `system` (ft or m), rounded. */
export function metresToHeightInput(m, system) {
  if (!Number.isFinite(m)) return '';
  const value = normalizeUnitSystem(system) === 'metric' ? m : m / M_PER_FT;
  return String(Math.round(value));
}

/** Input value (mph or km/h) to metres per second. */
export function speedInputToMps(value, system) {
  const number = Number(value);
  if (!Number.isFinite(number)) return NaN;
  return normalizeUnitSystem(system) === 'metric'
    ? number * MPS_PER_KMH
    : number * MPS_PER_MPH;
}

/** Metres per second to the input value shown for `system`, rounded. */
export function mpsToSpeedInput(mps, system) {
  if (!Number.isFinite(mps)) return '';
  const value =
    normalizeUnitSystem(system) === 'metric'
      ? mps / MPS_PER_KMH
      : mps / MPS_PER_MPH;
  return String(Math.round(value));
}

/** Decimal degrees with a hemisphere letter: "32.40850° N, 91.18680° W". */
export function formatLatLon(point, digits = 5) {
  if (!point || !Number.isFinite(point.lat) || !Number.isFinite(point.lon))
    return '—';
  const lat = `${fixed(Math.abs(point.lat), digits)}° ${point.lat >= 0 ? 'N' : 'S'}`;
  const lon = `${fixed(Math.abs(point.lon), digits)}° ${point.lon >= 0 ? 'E' : 'W'}`;
  return `${lat}, ${lon}`;
}
