/**
 * Site Survey report: one self-contained, printable HTML page titled
 * "Preliminary Desktop Site Screening".
 *
 * Everything the page shows is passed in already measured; this module only
 * lays it out. Every value is escaped, the snapshot must be a PNG or JPEG
 * data URL, and the page loads nothing from the network, so it opens offline
 * and prints to PDF from any browser.
 *
 * No Cesium, no DOM.
 */
import { formatDate, t } from '../i18n/index.js';
import { escapeXml } from './exports.js';
import { PLAN_WARNINGS, AIRSPACE_NOTE } from './flightPlan.js';
import {
  formatArea,
  formatDistance,
  formatDuration,
  formatGsd,
  formatHeight,
  formatLatLon,
  formatLength,
  formatPercent,
  formatSpeed,
} from './units.js';

const html = escapeXml;

/** A data URL safe to put in `src`: PNG or JPEG base64 only. */
export function safeImageDataUrl(value) {
  return typeof value === 'string' &&
    /^data:image\/(png|jpeg);base64,[A-Za-z0-9+/=]+$/.test(value)
    ? value
    : null;
}

const row = (label, value) =>
  `<tr><th scope="row">${html(label)}</th><td>${html(value)}</td></tr>`;

/**
 * The report page.
 * @param {object} input
 * @param {string} input.siteName
 * @param {Date|number} input.generatedAt
 * @param {'us'|'metric'} input.units
 * @param {{areaM2:number, perimeterM:number, centroid:{lon:number, lat:number}, mgrs:string, vertexCount:number}} input.boundary
 * @param {{status:string, stats?:object, slope?:object, spacingM?:number}} [input.terrain]
 * @param {object|null} [input.profile]
 * @param {Array<{label:string, checked:boolean, attribution:string}>} input.overlays
 * @param {object|null} [input.plan]
 * @param {string} [input.droneName]
 * @param {string|null} [input.snapshot]
 * @param {string[]} input.attributions
 * @returns {string}
 */
export function buildSiteReportHtml(input) {
  const units = input.units;
  const title = t('Preliminary Desktop Site Screening');
  const siteName = String(input.siteName || '').trim() || t('Untitled site');
  const generated = formatDate(input.generatedAt, {
    dateStyle: 'long',
    timeStyle: 'short',
  });
  const b = input.boundary;
  const parts = [];
  parts.push('<!DOCTYPE html>');
  parts.push('<html lang="en"><head><meta charset="utf-8" />');
  parts.push(
    '<meta name="viewport" content="width=device-width, initial-scale=1" />',
  );
  parts.push(`<title>${html(title)} · ${html(siteName)}</title>`);
  parts.push(`<style>${REPORT_CSS}</style></head><body><main>`);
  parts.push('<header>');
  parts.push(`<p class="kicker">${html(t('Desktop review'))}</p>`);
  parts.push(`<h1>${html(title)}</h1>`);
  parts.push(`<p class="site">${html(siteName)}</p>`);
  parts.push(
    `<p class="meta">${html(t('Prepared {date}', { date: generated }))}</p>`,
  );
  parts.push('</header>');

  parts.push(
    `<p class="notice"><strong>${html(t('Screening only.'))}</strong> ${html(
      t(
        'This desktop review uses public map layers and modelled terrain. Overlay results are for screening only and need field verification by a qualified professional before any decision about the land.',
      ),
    )}</p>`,
  );

  const snapshot = safeImageDataUrl(input.snapshot);
  if (snapshot)
    parts.push(
      `<figure><img src="${snapshot}" alt="${html(t('Map view of the site at the time of the report'))}" /><figcaption>${html(t('Map view at the time of the report.'))}</figcaption></figure>`,
    );

  parts.push(`<section><h2>${html(t('Site'))}</h2><table>`);
  parts.push(row(t('Area of interest'), formatArea(b.areaM2, units)));
  if (units === 'us')
    parts.push(row(t('Area (metric)'), formatArea(b.areaM2, 'metric')));
  else parts.push(row(t('Area (US)'), formatArea(b.areaM2, 'us')));
  parts.push(row(t('Boundary perimeter'), formatLength(b.perimeterM, units)));
  parts.push(row(t('Centroid'), formatLatLon(b.centroid)));
  parts.push(row(t('Centroid (MGRS)'), b.mgrs || '—'));
  parts.push(row(t('Boundary vertices'), String(b.vertexCount)));
  parts.push('</table></section>');

  parts.push(`<section><h2>${html(t('Elevation and slope'))}</h2>`);
  const terrain = input.terrain || { status: 'not-run' };
  if (terrain.status === 'ok' && terrain.stats?.count) {
    parts.push('<table>');
    parts.push(row(t('Lowest point'), formatHeight(terrain.stats.min, units)));
    parts.push(row(t('Highest point'), formatHeight(terrain.stats.max, units)));
    parts.push(
      row(t('Mean elevation'), formatHeight(terrain.stats.mean, units)),
    );
    parts.push(row(t('Relief'), formatHeight(terrain.stats.reliefM, units)));
    parts.push(row(t('Mean slope'), formatPercent(terrain.slope?.meanPct)));
    parts.push(row(t('Steepest slope'), formatPercent(terrain.slope?.maxPct)));
    parts.push(
      row(
        t('Sample grid'),
        t('{count} points, {spacing} apart', {
          count: terrain.stats.count,
          spacing: formatLength(terrain.spacingM, units),
        }),
      ),
    );
    parts.push('</table>');
    parts.push(
      `<p class="note">${html(
        terrain.datum === 'egm96'
          ? t(
              'Elevations are heights above mean sea level (EGM96 geoid) sampled from a terrain model, not surveyed ground.',
            )
          : t(
              'Elevations are ellipsoidal (WGS-84) heights sampled from a terrain model, not surveyed ground.',
            ),
      )}</p>`,
    );
  } else if (terrain.status === 'unavailable') {
    parts.push(
      `<p>${html(t('Terrain not loaded — add a Cesium ion token for elevation'))}</p>`,
    );
  } else {
    parts.push(
      `<p>${html(t('Elevation was not sampled for this report.'))}</p>`,
    );
  }
  const profile = input.profile;
  if (profile?.count) {
    parts.push(`<h3>${html(t('Elevation profile'))}</h3><table>`);
    parts.push(row(t('Profile length'), formatLength(profile.lengthM, units)));
    parts.push(row(t('Lowest point'), formatHeight(profile.min, units)));
    parts.push(row(t('Highest point'), formatHeight(profile.max, units)));
    parts.push(row(t('Total climb'), formatHeight(profile.gainM, units)));
    parts.push(row(t('Steepest grade'), formatPercent(profile.maxGradePct)));
    parts.push('</table>');
  }
  parts.push('</section>');

  parts.push(`<section><h2>${html(t('Public land overlays'))}</h2>`);
  parts.push(
    `<table><thead><tr><th scope="col">${html(t('Layer'))}</th><th scope="col">${html(t('Checked in this review'))}</th></tr></thead><tbody>`,
  );
  for (const overlay of input.overlays || []) {
    parts.push(
      `<tr><td>${html(overlay.label)}</td><td>${html(overlay.checked ? t('Yes — viewed over the site') : t('Not checked'))}</td></tr>`,
    );
  }
  parts.push('</tbody></table>');
  parts.push(
    `<p class="note">${html(t('A layer marked as viewed was displayed over the boundary during this desktop review. This report does not interpret what the layer showed. Flood zone, wetland, soil and land-cover determinations need field verification by a qualified professional.'))}</p>`,
  );
  parts.push('</section>');

  parts.push(`<section><h2>${html(t('Flight plan'))}</h2>`);
  const plan = input.plan;
  if (plan) {
    parts.push('<table>');
    if (input.droneName) parts.push(row(t('Drone'), input.droneName));
    parts.push(
      row(t('Altitude above ground'), formatHeight(plan.altitudeM, units)),
    );
    parts.push(row(t('Ground sampling distance'), formatGsd(plan.gsdM)));
    parts.push(
      row(
        t('Image footprint'),
        `${formatLength(plan.footprint.acrossM, units)} × ${formatLength(plan.footprint.alongM, units)}`,
      ),
    );
    parts.push(
      row(
        t('Front / side overlap'),
        `${Math.round(plan.frontOverlap * 100)} % / ${Math.round(plan.sideOverlap * 100)} %`,
      ),
    );
    parts.push(row(t('Speed'), formatSpeed(plan.speedMps, units)));
    parts.push(row(t('Line spacing'), formatLength(plan.lineSpacingM, units)));
    parts.push(row(t('Flight lines'), String(plan.lineCount)));
    parts.push(row(t('Photos'), String(plan.photoCount)));
    parts.push(
      row(
        t('Total flight distance'),
        formatDistance(plan.totalDistanceM, units),
      ),
    );
    parts.push(
      row(t('Estimated flight time'), formatDuration(plan.flightTimeS)),
    );
    parts.push(row(t('Batteries needed'), String(plan.batteries)));
    parts.push('</table>');
    const warnings = (plan.warnings || []).map((id) => t(PLAN_WARNINGS[id]));
    for (const warning of warnings)
      parts.push(`<p class="warn">${html(warning)}</p>`);
  } else {
    parts.push(`<p>${html(t('No flight plan was made for this report.'))}</p>`);
  }
  parts.push(`<p class="note">${html(t(AIRSPACE_NOTE))}</p>`);
  parts.push('</section>');

  parts.push(`<section><h2>${html(t('Field verification'))}</h2><ul>`);
  for (const item of [
    t(
      'Confirm the boundary against the recorded legal description or a licensed land survey.',
    ),
    t(
      'Confirm flood zone status with the effective FIRM panel and the local floodplain administrator.',
    ),
    t(
      'Have wetland presence delineated on the ground where the inventory shows wetlands nearby.',
    ),
    t(
      'Verify soils with field sampling and laboratory testing before design or purchase decisions.',
    ),
  ])
    parts.push(`<li>${html(item)}</li>`);
  parts.push('</ul></section>');

  parts.push(
    `<section class="sources"><h2>${html(t('Data sources'))}</h2><ul>`,
  );
  for (const credit of input.attributions || [])
    parts.push(`<li>${html(credit)}</li>`);
  parts.push('</ul></section>');
  parts.push('</main></body></html>');
  return parts.join('\n');
}

const REPORT_CSS = `
:root{color-scheme:light}
*{box-sizing:border-box}
body{margin:0;background:#f4f5f7;color:#1d2330;font:15px/1.5 system-ui,-apple-system,"Segoe UI",sans-serif}
main{max-width:860px;margin:0 auto;padding:32px 24px 48px;background:#fff}
header{border-bottom:3px solid #1d4e89;padding-bottom:12px;margin-bottom:16px}
.kicker{margin:0;text-transform:uppercase;letter-spacing:.12em;font-size:12px;color:#1d4e89;font-weight:600}
h1{margin:4px 0;font-size:26px;line-height:1.2}
.site{margin:0;font-size:19px;font-weight:600}
.meta{margin:4px 0 0;color:#5a6272;font-size:13px}
h2{font-size:17px;margin:24px 0 8px;color:#1d4e89}
h3{font-size:15px;margin:16px 0 6px}
table{width:100%;border-collapse:collapse;font-size:14px}
th,td{text-align:left;padding:6px 8px;border-bottom:1px solid #e3e6eb;vertical-align:top}
th[scope=row]{width:40%;font-weight:500;color:#3a4252}
thead th{background:#eef2f7}
figure{margin:0 0 8px}
figure img{width:100%;height:auto;border:1px solid #d5dae2;display:block}
figcaption{font-size:12px;color:#5a6272;margin-top:4px}
.notice{background:#fff6e0;border-left:4px solid #e0a100;padding:10px 12px;margin:12px 0}
.warn{background:#fdecec;border-left:4px solid #c62828;padding:8px 12px;margin:8px 0}
.note{font-size:13px;color:#4a5262}
.sources li{font-size:13px;color:#3a4252}
@media print{body{background:#fff}main{padding:0;max-width:none}section{break-inside:avoid}}
`;
