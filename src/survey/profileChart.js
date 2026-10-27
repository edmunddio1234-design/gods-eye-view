/**
 * Site Survey elevation profile chart: a small SVG built as a string.
 *
 * Distance runs along the bottom, elevation up the side, in the chosen
 * units. Stations with no height break the line rather than dropping to
 * zero. No Cesium, no DOM.
 */
import { formatNumber } from '../i18n/index.js';
import { escapeXml } from './exports.js';
import { M_PER_FT, M_PER_MILE, normalizeUnitSystem } from './units.js';

const WIDTH = 300;
const HEIGHT = 130;
const PAD = { left: 40, right: 8, top: 10, bottom: 22 };

/** A tidy axis step (1, 2 or 5 × 10^n) giving about `target` ticks. */
export function niceStep(span, target = 4) {
  if (!(span > 0)) return 1;
  const raw = span / target;
  const power = 10 ** Math.floor(Math.log10(raw));
  const fraction = raw / power;
  const nice =
    fraction < 1.5 ? 1 : fraction < 3.5 ? 2 : fraction < 7.5 ? 5 : 10;
  return nice * power;
}

/**
 * @param {Array<{distanceM:number, height:number}>} samples
 * @param {'us'|'metric'} system
 * @param {{ariaLabel?: string}} [options]
 * @returns {string} SVG markup, or '' when nothing can be drawn
 */
export function profileChartSvg(samples, system, { ariaLabel = '' } = {}) {
  const valid = (samples || []).filter(
    (s) => Number.isFinite(s?.height) && Number.isFinite(s?.distanceM),
  );
  if (valid.length < 2) return '';
  const metric = normalizeUnitSystem(system) === 'metric';
  const total = samples[samples.length - 1].distanceM;
  const longX = metric ? total >= 2000 : total >= M_PER_MILE / 2;
  const xScale = metric ? (longX ? 1000 : 1) : longX ? M_PER_MILE : M_PER_FT;
  const xUnit = metric ? (longX ? 'km' : 'm') : longX ? 'mi' : 'ft';
  const yScale = metric ? 1 : M_PER_FT;
  const yUnit = metric ? 'm' : 'ft';
  const xs = samples.map((s) => s.distanceM / xScale);
  const ys = valid.map((s) => s.height / yScale);
  let yMin = Math.min(...ys);
  let yMax = Math.max(...ys);
  if (yMax - yMin < 2) {
    const mid = (yMax + yMin) / 2;
    yMin = mid - 1;
    yMax = mid + 1;
  }
  const yStep = niceStep(yMax - yMin);
  yMin = Math.floor(yMin / yStep) * yStep;
  yMax = Math.ceil(yMax / yStep) * yStep;
  const yDigits = Math.max(0, Math.ceil(-Math.log10(yStep) - 1e-9));
  const xMax = xs[xs.length - 1] || 1;
  const plotW = WIDTH - PAD.left - PAD.right;
  const plotH = HEIGHT - PAD.top - PAD.bottom;
  const px = (x) => PAD.left + (x / xMax) * plotW;
  const py = (y) => PAD.top + (1 - (y - yMin) / (yMax - yMin)) * plotH;
  const segments = [];
  let current = [];
  samples.forEach((s, index) => {
    if (!Number.isFinite(s?.height)) {
      if (current.length > 1) segments.push(current);
      current = [];
      return;
    }
    current.push(
      `${px(xs[index]).toFixed(1)},${py(s.height / yScale).toFixed(1)}`,
    );
  });
  if (current.length > 1) segments.push(current);
  const parts = [];
  parts.push(
    `<svg class="survey-profile-chart" viewBox="0 0 ${WIDTH} ${HEIGHT}" role="img" aria-label="${escapeXml(ariaLabel)}" xmlns="http://www.w3.org/2000/svg">`,
  );
  for (let y = yMin; y <= yMax + yStep / 2; y += yStep) {
    const yy = py(y).toFixed(1);
    parts.push(
      `<line class="grid" x1="${PAD.left}" x2="${WIDTH - PAD.right}" y1="${yy}" y2="${yy}" />`,
    );
    parts.push(
      `<text class="tick" x="${PAD.left - 4}" y="${yy}" text-anchor="end" dominant-baseline="middle">${escapeXml(formatNumber(y, { maximumFractionDigits: yDigits, minimumFractionDigits: yDigits }))}</text>`,
    );
  }
  const xStep = niceStep(xMax);
  for (let x = 0; x <= xMax + xStep / 100; x += xStep) {
    const xx = px(x).toFixed(1);
    parts.push(
      `<text class="tick" x="${xx}" y="${HEIGHT - 6}" text-anchor="middle">${escapeXml(formatNumber(Number(x.toPrecision(3))))}</text>`,
    );
  }
  parts.push(
    `<text class="unit" x="2" y="${PAD.top + 2}" dominant-baseline="hanging">${yUnit}</text>`,
  );
  parts.push(
    `<text class="unit" x="${WIDTH - PAD.right}" y="${PAD.top + 2}" text-anchor="end" dominant-baseline="hanging">→ ${xUnit}</text>`,
  );
  for (const points of segments)
    parts.push(`<polyline class="line" points="${points.join(' ')}" />`);
  parts.push('</svg>');
  return parts.join('');
}
