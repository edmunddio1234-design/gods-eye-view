/**
 * Site Survey panel: the DOM half that ties the survey together.
 *
 * One panel, five sections, in the order a desktop review runs: the site and
 * its boundary, elevation and slope, public land overlays, the drone flight
 * plan, and the screening report. All measuring is done by the pure modules
 * beside this one; this file reads inputs, asks them, and writes results.
 *
 * Every string on screen goes through `t()`. The panel is built in code and
 * removed by `destroy()`, so nothing about it lives in the shared templates.
 */
import { forward as toMgrs } from 'mgrs';
import { formatDate, msg, t, tn, registerUnsavedWork } from '../i18n/index.js';
import { polygonAreaM2, perimeterM, polygonCentroid } from './geodesy.js';
import {
  formatArea,
  formatDistance,
  formatDuration,
  formatGsd,
  formatHeight,
  formatLatLon,
  formatLength,
  formatPercent,
  heightInputToMetres,
  metresToHeightInput,
  mpsToSpeedInput,
  readUnitSystem,
  speedInputToMps,
  writeUnitSystem,
} from './units.js';
import {
  AIRSPACE_NOTE,
  CUSTOM_DRONE_ID,
  DEFAULT_DRONE_ID,
  DRONE_PRESETS,
  PLAN_DEFAULTS,
  PLAN_WARNINGS,
  dronePreset,
  planSurvey,
} from './flightPlan.js';
import {
  elevationStats,
  gridSamplePoints,
  profileStations,
  profileSummary,
  slopeStats,
} from './terrainStats.js';
import {
  SURVEY_BASE_ATTRIBUTIONS,
  SURVEY_FIRE_ATTRIBUTION,
  SURVEY_FIRE_LAYER_ID,
  SURVEY_IMAGERY_CREDITS,
  SURVEY_OVERLAYS,
} from './overlays.js';
import { surveyGeoJson, surveyKml, fileStem } from './exports.js';
import { buildSiteReportHtml } from './report.js';
import { profileChartSvg } from './profileChart.js';
import { SURVEY_GLOBE_STACKS, SURVEY_MAP_STACK } from './policy.js';
import { SURVEY_COLORS } from './surveyScene.js';
import {
  SURVEY_DEFAULT_ON,
  SURVEY_LAYERS,
  SURVEY_LAYER_GROUPS,
  WAYBACK_RELEASES,
  isInUnitedStates,
} from './layerCatalog.js';
import { createSurveyLayers, fetchJson } from './surveyLayers.js';
import { createFlightPlayer } from './flightPlayer.js';
import { GUIDED_FLIGHTS } from './guidedFlights.js';
import { createSurveyInfoCard } from './infoCard.js';
import { createSurveyClickHandler } from './surveyClicks.js';
import {
  SDA_URL,
  compositionText,
  parseSdaSoil,
  parseSoilGrids,
  sdaSoilRequest,
  soilGridsUrl,
} from './soilInfo.js';
import {
  USGS_PARAMETERS,
  epaFacilityPage,
  formatReading,
  usgsStationPage,
} from './pointSources.js';

/** Help for the NASA FIRMS row, which is an app layer, not a survey one. */
const FIRE_HELP = msg(
  'NASA satellite detections of active fires and hot spots in the last day or two, anywhere in the world.',
);

export const SURVEY_PANEL_ID = 'site-survey-panel';

/** Unit symbols beside the altitude and speed inputs; the same in every language. */
const INPUT_UNITS = Object.freeze({
  us: Object.freeze({ height: 'ft', speed: 'mph' }),
  metric: Object.freeze({ height: 'm', speed: 'km/h' }),
});

/** "15S XR 12345 67890" from "15SXR1234567890". */
export function formatMgrs(raw) {
  const match = /^(\d{1,2}[C-HJ-NP-X])([A-HJ-NP-Z]{2})(\d*)$/.exec(
    String(raw || ''),
  );
  if (!match) return String(raw || '');
  const digits = match[3];
  const half = digits.length / 2;
  return [match[1], match[2], digits.slice(0, half), digits.slice(half)]
    .filter(Boolean)
    .join(' ');
}

/** MGRS at 1 m precision for a {lon, lat}, or '' outside its latitude band. */
export function mgrsOf(point) {
  try {
    return formatMgrs(toMgrs([point.lon, point.lat], 5));
  } catch {
    return '';
  }
}

function download(name, text, type, documentRef = document) {
  const blob = new Blob([text], { type });
  const url = URL.createObjectURL(blob);
  const link = documentRef.createElement('a');
  link.href = url;
  link.download = name;
  link.rel = 'noopener';
  documentRef.body.appendChild(link);
  link.click();
  link.remove();
  setTimeout(() => URL.revokeObjectURL(url), 30_000);
}

/**
 * @param {object} deps
 * @param {object} deps.viewer
 * @param {object} deps.scene survey scene (surveyScene.js)
 * @param {object} deps.draw draw controller (drawController.js)
 * @param {object} deps.mode survey mode (surveyMode.js)
 * @param {object} deps.dataManager
 * @param {object} [deps.mapStackController]
 * @param {object} [deps.styleManager]
 * @param {(points:Array, options:object) => Promise<object>} deps.sampleHeights
 */
export function createSurveyPanel({
  viewer,
  scene,
  draw,
  mode,
  dataManager,
  mapStackController,
  styleManager,
  sampleHeights,
  documentRef = document,
}) {
  const state = {
    units: readUnitSystem(),
    siteName: '',
    boundary: [],
    profile: [],
    terrain: { status: 'not-run' },
    profileSamples: [],
    profileResult: null,
    layersViewed: new Set(),
    droneId: DEFAULT_DRONE_ID,
    custom: { ...DRONE_PRESETS[0] },
    altitudeM: PLAN_DEFAULTS.altitudeM,
    frontOverlap: PLAN_DEFAULTS.frontOverlap,
    sideOverlap: PLAN_DEFAULTS.sideOverlap,
    speedMps: PLAN_DEFAULTS.speedMps,
    heading: 'auto',
    showPlan: true,
    plan: null,
    fireViewed: false,
  };
  const disposers = [];
  const listen = (target, type, handler, options) => {
    target.addEventListener(type, handler, options);
    disposers.push(() => target.removeEventListener(type, handler, options));
  };
  let terrainController = null;
  let profileController = null;
  let active = false;

  // The survey's map layers: draped imagery, grid, relief and points.
  const layers = createSurveyLayers(viewer, {
    getUnits: () => state.units,
    getAnchor: () =>
      state.boundary.length >= 3 ? polygonCentroid(state.boundary) : null,
    onStatus: (id, status) => renderLayerStatus(id, status),
  });
  disposers.push(() => layers.destroy());

  // ---- DOM helpers -----------------------------------------------------
  const el = (tag, props = {}, children = []) => {
    const node = documentRef.createElement(tag);
    for (const [key, value] of Object.entries(props)) {
      if (value === undefined || value === null) continue;
      if (key === 'class') node.className = value;
      else if (key === 'text') node.textContent = value;
      else if (
        key.startsWith('aria-') ||
        key.startsWith('data-') ||
        key === 'role' ||
        key === 'for'
      )
        node.setAttribute(key, value);
      else node[key] = value;
    }
    for (const child of [].concat(children)) if (child) node.append(child);
    return node;
  };
  const button = (label, className = '', title) =>
    el('button', {
      type: 'button',
      class: `gev-action-button survey-button ${className}`.trim(),
      text: label,
      title,
    });
  const field = (labelText, input, unit) => {
    const id = `survey-field-${Math.random().toString(36).slice(2, 9)}`;
    input.id = id;
    return el('div', { class: 'survey-field' }, [
      el('label', { for: id, text: labelText }),
      el('div', { class: 'survey-field-input' }, [
        input,
        unit ? el('span', { class: 'survey-unit', text: unit }) : null,
      ]),
    ]);
  };
  const numberInput = (value, { min, max, step = 'any' } = {}) =>
    el('input', {
      type: 'number',
      class: 'gev-field gev-field--compact survey-number',
      value: String(value),
      min,
      max,
      step,
      inputMode: 'decimal',
    });
  const readout = () => el('dl', { class: 'survey-readout' });
  const setReadout = (dl, rows) => {
    dl.replaceChildren(
      ...rows.flatMap(([label, value, extraClass]) => [
        el('dt', { text: label }),
        el('dd', { text: value, class: extraClass || '' }),
      ]),
    );
  };
  const section = (title, open = true) => {
    const body = el('div', { class: 'survey-section-body' });
    const details = el('details', { class: 'survey-section', open }, [
      el('summary', { text: title }),
      body,
    ]);
    return { details, body };
  };

  // ---- panel frame -----------------------------------------------------
  const unitsUs = el('button', {
    type: 'button',
    class: 'gev-segment',
    role: 'radio',
    text: t('US'),
    'data-units': 'us',
  });
  const unitsMetric = el('button', {
    type: 'button',
    class: 'gev-segment',
    role: 'radio',
    text: t('Metric'),
    'data-units': 'metric',
  });
  const closeButton = el('button', {
    type: 'button',
    class: 'survey-close',
    'aria-label': t('Leave Site Survey'),
    title: t('Leave Site Survey'),
    text: '×',
  });
  const panel = el(
    'section',
    {
      id: SURVEY_PANEL_ID,
      class: 'survey-panel',
      'aria-label': t('Site Survey'),
      hidden: true,
    },
    [
      el('header', { class: 'survey-header' }, [
        el('h2', { text: t('SITE SURVEY') }),
        el(
          'div',
          {
            class: 'gev-segmented survey-units',
            role: 'radiogroup',
            'aria-label': t('Units'),
          },
          [unitsUs, unitsMetric],
        ),
        closeButton,
      ]),
    ],
  );
  const stackNotice = el('p', { class: 'survey-notice', hidden: true });
  const stackButton = button(t('Switch to Esri imagery'));
  stackNotice.append(
    el('span', {
      text: t(
        'Overlays and terrain drape on the globe. The current map hides it.',
      ),
    }),
    ' ',
    stackButton,
  );
  panel.append(stackNotice);

  // ---- 1. site and boundary -------------------------------------------
  const siteSection = section(t('Site'));
  const nameInput = el('input', {
    type: 'text',
    class: 'gev-field survey-text',
    maxLength: 120,
    placeholder: t('Site name, e.g. parcel or tract'),
    autocomplete: 'off',
  });
  const drawButton = button(t('Draw boundary'), 'survey-primary');
  const editButton = button(t('Edit'));
  const clearButton = button(t('Clear'), 'gev-action-button--danger');
  const flyButton = button(t('Zoom to site'));
  const hint = el('p', { class: 'survey-hint', 'aria-live': 'polite' });
  const siteReadout = readout();
  siteSection.body.append(
    field(t('Site name'), nameInput),
    el('div', { class: 'survey-actions' }, [
      drawButton,
      editButton,
      clearButton,
      flyButton,
    ]),
    hint,
    siteReadout,
  );

  // ---- 2. elevation and slope -----------------------------------------
  const terrainSection = section(t('Elevation and slope'));
  const sampleButton = button(t('Sample elevation'));
  const terrainStatus = el('p', {
    class: 'survey-status',
    'aria-live': 'polite',
  });
  const terrainReadout = readout();
  const profileButton = button(t('Draw profile line'));
  const clearProfileButton = button(t('Clear profile'));
  const profileReadout = readout();
  const profileChart = el('div', { class: 'survey-chart' });
  terrainSection.body.append(
    el('div', { class: 'survey-actions' }, [sampleButton]),
    terrainStatus,
    terrainReadout,
    el('h3', { text: t('Elevation profile') }),
    el('div', { class: 'survey-actions' }, [profileButton, clearProfileButton]),
    profileChart,
    profileReadout,
  );

  // ---- 3. map layers ---------------------------------------------------
  // Every layer row: a checkbox, its name, a "?" that opens one sentence of
  // help, a status word while it loads, and (for overlays) a legend and the
  // credit line.
  const layerRows = new Map();
  const statusText = (status) => {
    switch (status?.state) {
      case 'loading':
        return t('loading…');
      case 'error':
        return t('no answer');
      case 'zoom-in':
        return t('zoom in to load');
      case 'no-terrain':
        return t('no 3D terrain');
      case 'ready':
        return Number.isFinite(status.count)
          ? tn(status.count, '{count} point', '{count} points')
          : '';
      default:
        return '';
    }
  };
  /** Where the map is looking: inside the US or not (US-only layers say so). */
  let viewInUs = true;
  function renderLayerStatus(id, status = layers.status(id)) {
    const row = layerRows.get(id);
    if (!row) return;
    const on = row.checkbox.checked;
    row.status.textContent =
      on && row.usOnly && !viewInUs
        ? t('no data outside the US')
        : on
          ? statusText(status)
          : '';
  }
  const layerRow = (id, labelText, helpText, extras = [], usOnly = false) => {
    const checkbox = el('input', { type: 'checkbox', 'data-survey-layer': id });
    const helpId = `survey-help-${id}`;
    const helpButton = el('button', {
      type: 'button',
      class: 'survey-help-button',
      text: '?',
      'aria-label': t('What is {layer}?', { layer: labelText }),
      title: t('What is this?'),
      'aria-expanded': 'false',
      'aria-controls': helpId,
    });
    const help = el('p', {
      id: helpId,
      class: 'survey-help',
      text: helpText,
      hidden: true,
    });
    const status = el('span', { class: 'survey-layer-status' });
    const row = el('div', { class: 'survey-overlay', 'data-layer-row': id }, [
      el('div', { class: 'survey-layer-line' }, [
        el('label', { class: 'survey-check' }, [
          checkbox,
          el('span', { text: labelText }),
          usOnly
            ? el('span', { class: 'survey-usonly', text: t('US only') })
            : null,
        ]),
        status,
        helpButton,
      ]),
      help,
      ...extras,
    ]);
    listen(helpButton, 'click', () => {
      help.hidden = !help.hidden;
      helpButton.setAttribute('aria-expanded', String(!help.hidden));
    });
    const entry = { checkbox, status, help, helpButton, extras, row, usOnly };
    layerRows.set(id, entry);
    return entry;
  };
  const legendList = (legend) =>
    el(
      'ul',
      { class: 'survey-legend', hidden: true },
      legend.map((entry) =>
        el('li', {}, [
          el('span', {
            class: `survey-swatch${entry.outline ? ' survey-swatch--outline' : ''}`,
            'aria-hidden': 'true',
            style: entry.outline
              ? `border-color:${entry.color}`
              : `background:${entry.color}`,
          }),
          el('span', { text: t(entry.label) }),
        ]),
      ),
    );
  const creditLine = (text) =>
    el('p', { class: 'survey-credit', text, hidden: true });

  /** Turn a survey layer on or off and keep its row in step. */
  function setLayer(id, on) {
    layers.set(id, on);
    const row = layerRows.get(id);
    if (row) {
      row.checkbox.checked = layers.isOn(id);
      for (const extra of row.extras) extra.hidden = !row.checkbox.checked;
      if (!row.checkbox.checked) row.status.textContent = '';
    }
    if (layers.isOn(id)) state.layersViewed.add(id);
    if (id === 'past-wayback') {
      waybackControls.hidden = !layers.isOn(id);
      renderCompare();
    }
    renderLayerStatus(id);
  }

  const catalogSection = (groupId, open) => {
    const group = SURVEY_LAYER_GROUPS.find((g) => g.id === groupId);
    const sec = section(t(group.label), open);
    for (const layer of SURVEY_LAYERS.filter((l) => l.group === groupId)) {
      const row = layerRow(
        layer.id,
        t(layer.label),
        t(layer.help),
        [creditLine(t(layer.attribution))],
        layer.coverage === 'us',
      );
      sec.body.append(row.row);
    }
    return sec;
  };

  const referenceSection = catalogSection('reference', true);
  const topoSection = catalogSection('topography', true);

  const overlaySection = section(t('Public land overlays'));
  const opacity = el('input', {
    type: 'range',
    class: 'gev-quantitative-slider survey-opacity',
    min: '10',
    max: '100',
    value: '60',
    'aria-label': t('Overlay opacity'),
  });
  overlaySection.body.append(
    el('p', {
      class: 'survey-note',
      text: t(
        'For screening only. Overlay results need field verification by a qualified professional.',
      ),
    }),
  );
  for (const overlay of SURVEY_OVERLAYS) {
    const row = layerRow(
      overlay.id,
      t(overlay.label),
      t(overlay.help),
      [legendList(overlay.legend), creditLine(t(overlay.attribution))],
      overlay.coverage === 'us',
    );
    overlaySection.body.append(row.row);
  }
  const fireRow = layerRow(
    SURVEY_FIRE_LAYER_ID,
    t('NASA FIRMS active fires'),
    t(FIRE_HELP),
    [creditLine(t(SURVEY_FIRE_ATTRIBUTION))],
  );
  const fireCheckbox = fireRow.checkbox;
  const fireCredit = fireRow.extras[0];
  overlaySection.body.append(fireRow.row, field(t('Overlay opacity'), opacity));

  const monitoringSection = catalogSection('monitoring', false);
  const worldSection = catalogSection('world', false);
  worldSection.body.prepend(
    el('p', {
      class: 'survey-note',
      text: t(
        'These layers cover the whole world, so Survey mode also works outside the US.',
      ),
    }),
  );
  const pastSection = catalogSection('past', false);
  const waybackButtons = WAYBACK_RELEASES.map((release, index) =>
    el('button', {
      type: 'button',
      class: 'gev-segment',
      role: 'radio',
      text: release.year,
      title: release.date,
      'data-wayback': String(index),
    }),
  );
  const compareInput = el('input', { type: 'checkbox' });
  const splitInput = el('input', {
    type: 'range',
    class: 'gev-quantitative-slider survey-opacity',
    min: '5',
    max: '95',
    value: '50',
    'aria-label': t('Where the comparison divides the view'),
    disabled: true,
  });
  const swipeLine = el('div', {
    class: 'survey-swipe-line',
    hidden: true,
    'aria-hidden': 'true',
  });
  documentRef.body.appendChild(swipeLine);
  disposers.push(() => swipeLine.remove());
  const waybackControls = el('div', { class: 'survey-wayback', hidden: true }, [
    el(
      'div',
      {
        class: 'gev-segmented survey-wayback-years',
        role: 'radiogroup',
        'aria-label': t('Archive release'),
      },
      waybackButtons,
    ),
    el('label', { class: 'survey-check' }, [
      compareInput,
      el('span', { text: t('Compare with today (past on the left)') }),
    ]),
    field(t('Divide at'), splitInput),
    el('p', {
      class: 'survey-note',
      text: t(
        'Dates are archive releases. A place nobody re-imaged between two releases looks the same in both.',
      ),
    }),
  ]);
  pastSection.body.append(waybackControls);

  // ---- guided flights --------------------------------------------------
  const flightsSection = section(t('Guided flights'), true);
  const flightSelect = el(
    'select',
    {
      class: 'gev-field gev-field--compact survey-select',
      'aria-label': t('Guided flight'),
    },
    GUIDED_FLIGHTS.map((flight) =>
      el('option', { value: flight.id, text: t(flight.label) }),
    ),
  );
  const flightPlayButton = button(t('Play flight'), 'survey-primary');
  flightsSection.body.append(
    el('p', {
      class: 'survey-note',
      text: t(
        'A short tour with captions that turns the matching layers on as it goes.',
      ),
    }),
    field(t('Flight'), flightSelect),
    el('div', { class: 'survey-actions' }, [flightPlayButton]),
  );

  // ---- 4. flight plan --------------------------------------------------
  const planSection = section(t('Flight plan'), false);
  const droneSelect = el(
    'select',
    { class: 'gev-field gev-field--compact survey-select' },
    [
      ...DRONE_PRESETS.map((preset) =>
        el('option', { value: preset.id, text: preset.name }),
      ),
      el('option', { value: CUSTOM_DRONE_ID, text: t('Custom camera') }),
    ],
  );
  droneSelect.value = state.droneId;
  const customInputs = {
    sensorWidthMm: numberInput(state.custom.sensorWidthMm, { min: '1' }),
    sensorHeightMm: numberInput(state.custom.sensorHeightMm, { min: '1' }),
    focalLengthMm: numberInput(state.custom.focalLengthMm, { min: '1' }),
    imageWidthPx: numberInput(state.custom.imageWidthPx, {
      min: '100',
      step: '1',
    }),
    imageHeightPx: numberInput(state.custom.imageHeightPx, {
      min: '100',
      step: '1',
    }),
    batteryMinutes: numberInput(state.custom.batteryMinutes, { min: '1' }),
  };
  const customBlock = el('div', { class: 'survey-custom', hidden: true }, [
    field(t('Sensor width'), customInputs.sensorWidthMm, 'mm'),
    field(t('Sensor height'), customInputs.sensorHeightMm, 'mm'),
    field(t('Focal length'), customInputs.focalLengthMm, 'mm'),
    field(t('Image width'), customInputs.imageWidthPx, 'px'),
    field(t('Image height'), customInputs.imageHeightPx, 'px'),
    field(t('Rated battery'), customInputs.batteryMinutes, 'min'),
  ]);
  const altitudeInput = numberInput('', { min: '10', step: '1' });
  const frontInput = numberInput(Math.round(state.frontOverlap * 100), {
    min: '0',
    max: '95',
    step: '1',
  });
  const sideInput = numberInput(Math.round(state.sideOverlap * 100), {
    min: '0',
    max: '95',
    step: '1',
  });
  const speedInput = numberInput('', { min: '1', step: '1' });
  const headingSelect = el(
    'select',
    { class: 'gev-field gev-field--compact survey-select' },
    [
      el('option', { value: 'auto', text: t('Auto: along the longest edge') }),
      el('option', { value: 'manual', text: t('Set a heading') }),
    ],
  );
  const headingInput = numberInput(0, { min: '0', max: '359', step: '1' });
  const headingField = field(t('Heading'), headingInput, '°');
  headingField.hidden = true;
  const showPlanInput = el('input', { type: 'checkbox', checked: true });
  const altitudeUnit = el('span', { class: 'survey-unit' });
  const speedUnit = el('span', { class: 'survey-unit' });
  const altitudeField = field(t('Altitude above ground'), altitudeInput);
  altitudeField.querySelector('.survey-field-input').append(altitudeUnit);
  const speedField = field(t('Speed'), speedInput);
  speedField.querySelector('.survey-field-input').append(speedUnit);
  const planReadout = readout();
  const planWarnings = el('div', {
    class: 'survey-warnings',
    'aria-live': 'polite',
  });
  const kmlButton = button(t('Export KML'));
  const geojsonButton = button(t('Export GeoJSON'));
  planSection.body.append(
    field(t('Drone'), droneSelect),
    customBlock,
    altitudeField,
    field(t('Front overlap'), frontInput, '%'),
    field(t('Side overlap'), sideInput, '%'),
    speedField,
    field(t('Flight lines'), headingSelect),
    headingField,
    el('label', { class: 'survey-check' }, [
      showPlanInput,
      el('span', { text: t('Show flight lines on the map') }),
    ]),
    el('p', { class: 'survey-key' }, [
      el('span', {
        class: 'survey-dot',
        style: `background:${SURVEY_COLORS.start}`,
        'aria-hidden': 'true',
      }),
      el('span', { text: t('Start') }),
      el('span', {
        class: 'survey-dot',
        style: `background:${SURVEY_COLORS.end}`,
        'aria-hidden': 'true',
      }),
      el('span', { text: t('End') }),
      el('span', {
        class: 'survey-dash',
        style: `background:${SURVEY_COLORS.flight}`,
        'aria-hidden': 'true',
      }),
      el('span', { text: t('Flight path') }),
    ]),
    planReadout,
    planWarnings,
    el('p', { class: 'survey-note', text: t(AIRSPACE_NOTE) }),
    el('div', { class: 'survey-actions' }, [kmlButton, geojsonButton]),
  );

  // ---- 5. report -------------------------------------------------------
  const reportSection = section(t('Site screening report'), false);
  const reportButton = button(t('Build report'), 'survey-primary');
  const printButton = button(t('Open printable view'));
  printButton.disabled = true;
  const reportStatus = el('p', {
    class: 'survey-status',
    'aria-live': 'polite',
  });
  reportSection.body.append(
    el('p', {
      class: 'survey-note',
      text: t(
        'A "Preliminary Desktop Site Screening" page with the boundary, terrain, overlays checked, the flight plan, a map snapshot and every data source. Print it to PDF from the browser.',
      ),
    }),
    el('div', { class: 'survey-actions' }, [reportButton, printButton]),
    reportStatus,
  );

  panel.append(
    flightsSection.details,
    siteSection.details,
    referenceSection.details,
    topoSection.details,
    overlaySection.details,
    monitoringSection.details,
    worldSection.details,
    pastSection.details,
    terrainSection.details,
    planSection.details,
    reportSection.details,
  );
  documentRef.body.appendChild(panel);
  disposers.push(() => panel.remove());

  // ---- rendering -------------------------------------------------------
  const units = () => state.units;

  function renderUnits() {
    for (const b of [unitsUs, unitsMetric]) {
      const on = b.dataset.units === state.units;
      b.setAttribute('aria-checked', String(on));
      b.classList.toggle('active', on);
    }
    altitudeInput.value = metresToHeightInput(state.altitudeM, units());
    speedInput.value = mpsToSpeedInput(state.speedMps, units());
    altitudeUnit.textContent = INPUT_UNITS[units()].height;
    speedUnit.textContent = INPUT_UNITS[units()].speed;
  }

  function boundaryFacts() {
    if (state.boundary.length < 3) return null;
    const centroid = polygonCentroid(state.boundary);
    return {
      areaM2: polygonAreaM2(state.boundary),
      perimeterM: perimeterM(state.boundary),
      centroid,
      mgrs: mgrsOf(centroid),
      vertexCount: state.boundary.length,
    };
  }

  function renderSite() {
    const facts = boundaryFacts();
    editButton.disabled = !facts;
    clearButton.disabled = !facts && !state.profile.length;
    flyButton.disabled = !facts;
    drawButton.textContent = facts ? t('Redraw boundary') : t('Draw boundary');
    if (!facts) {
      setReadout(siteReadout, [
        [t('Area of interest'), t('Draw a boundary to begin')],
      ]);
      return;
    }
    setReadout(siteReadout, [
      [t('Area'), formatArea(facts.areaM2, units())],
      [
        units() === 'us' ? t('Area (metric)') : t('Area (US)'),
        formatArea(facts.areaM2, units() === 'us' ? 'metric' : 'us'),
      ],
      [t('Perimeter'), formatLength(facts.perimeterM, units())],
      [t('Centroid'), formatLatLon(facts.centroid)],
      [t('MGRS'), facts.mgrs || '—'],
      [t('Corners'), String(facts.vertexCount)],
    ]);
  }

  function renderTerrain() {
    const terrain = state.terrain;
    sampleButton.disabled =
      state.boundary.length < 3 || terrain.status === 'loading';
    if (terrain.status === 'loading') {
      terrainStatus.textContent = t('Sampling terrain…');
      terrainReadout.replaceChildren();
      return;
    }
    if (terrain.status === 'unavailable') {
      terrainStatus.textContent = t(
        'Terrain not loaded — add a Cesium ion token for elevation',
      );
      terrainReadout.replaceChildren();
      return;
    }
    if (terrain.status !== 'ok') {
      terrainStatus.textContent =
        state.boundary.length < 3
          ? t('Draw a boundary to sample elevation.')
          : '';
      terrainReadout.replaceChildren();
      return;
    }
    terrainStatus.textContent =
      terrain.datum === 'egm96'
        ? t('Heights above mean sea level (EGM96), from the terrain model.')
        : t('Ellipsoidal (WGS-84) heights, from the terrain model.');
    setReadout(terrainReadout, [
      [t('Lowest'), formatHeight(terrain.stats.min, units())],
      [t('Highest'), formatHeight(terrain.stats.max, units())],
      [t('Mean'), formatHeight(terrain.stats.mean, units())],
      [t('Mean slope'), formatPercent(terrain.slope.meanPct)],
      [t('Steepest slope'), formatPercent(terrain.slope.maxPct)],
      [
        t('Samples'),
        tn(terrain.stats.count, '{count} point', '{count} points'),
      ],
    ]);
  }

  function renderProfile() {
    clearProfileButton.disabled = !state.profile.length;
    const summary = state.profileResult;
    if (summary === 'loading') {
      profileChart.replaceChildren(
        el('p', { class: 'survey-status', text: t('Sampling terrain…') }),
      );
      profileReadout.replaceChildren();
      return;
    }
    if (summary === 'unavailable') {
      profileChart.replaceChildren(
        el('p', {
          class: 'survey-status',
          text: t('Terrain not loaded — add a Cesium ion token for elevation'),
        }),
      );
      profileReadout.replaceChildren();
      return;
    }
    if (!summary?.count) {
      profileChart.replaceChildren();
      profileReadout.replaceChildren();
      return;
    }
    // The SVG is built from numbers only (profileChart.js escapes all text).
    profileChart.innerHTML = profileChartSvg(state.profileSamples, units(), {
      ariaLabel: t('Elevation profile along the drawn line'),
    });
    setReadout(profileReadout, [
      [t('Length'), formatLength(summary.lengthM, units())],
      [t('Lowest'), formatHeight(summary.min, units())],
      [t('Highest'), formatHeight(summary.max, units())],
      [t('Total climb'), formatHeight(summary.gainM, units())],
      [t('Steepest grade'), formatPercent(summary.maxGradePct)],
    ]);
  }

  function currentCamera() {
    if (state.droneId === CUSTOM_DRONE_ID) return state.custom;
    return dronePreset(state.droneId);
  }
  function droneName() {
    return state.droneId === CUSTOM_DRONE_ID
      ? t('Custom camera')
      : dronePreset(state.droneId)?.name || '';
  }

  function computePlan() {
    state.plan =
      state.boundary.length >= 3
        ? planSurvey(state.boundary, {
            camera: currentCamera(),
            altitudeM: state.altitudeM,
            frontOverlap: state.frontOverlap,
            sideOverlap: state.sideOverlap,
            speedMps: state.speedMps,
            heading: state.heading,
          })
        : null;
    scene.setPlan(state.showPlan ? state.plan : null);
    renderPlan();
  }

  function renderPlan() {
    const plan = state.plan;
    kmlButton.disabled = state.boundary.length < 3;
    geojsonButton.disabled = state.boundary.length < 3;
    customBlock.hidden = state.droneId !== CUSTOM_DRONE_ID;
    headingField.hidden = state.heading === 'auto';
    if (!plan) {
      setReadout(planReadout, [
        [
          t('Flight plan'),
          state.boundary.length < 3
            ? t('Draw a boundary to plan a flight')
            : t('Check the camera and flight settings'),
        ],
      ]);
      planWarnings.replaceChildren();
      return;
    }
    setReadout(planReadout, [
      [t('Ground sampling distance'), formatGsd(plan.gsdM)],
      [
        t('Image footprint'),
        `${formatLength(plan.footprint.acrossM, units())} × ${formatLength(plan.footprint.alongM, units())}`,
      ],
      [t('Line spacing'), formatLength(plan.lineSpacingM, units())],
      [t('Photo spacing'), formatLength(plan.photoSpacingM, units())],
      [
        t('Flight line heading'),
        `${Math.round(plan.bearingDeg)}°${plan.headingMode === 'auto' ? ` (${t('auto')})` : ''}`,
      ],
      [t('Flight lines'), String(plan.lineCount)],
      [t('Photos'), String(plan.photoCount)],
      [
        t('Total flight distance'),
        formatDistance(plan.totalDistanceM, units()),
      ],
      [t('Estimated flight time'), formatDuration(plan.flightTimeS)],
      [
        t('Batteries needed'),
        tn(
          plan.batteries,
          '{count} battery (75% of rated time each)',
          '{count} batteries (75% of rated time each)',
        ),
      ],
    ]);
    planWarnings.replaceChildren(
      ...plan.warnings.map((id) =>
        el('p', { class: 'survey-warning', text: t(PLAN_WARNINGS[id]) }),
      ),
    );
  }

  function renderStackNotice() {
    const stack = mapStackController?.getActiveId?.();
    stackNotice.hidden = !stack || SURVEY_GLOBE_STACKS.includes(stack);
    stackButton.disabled =
      !mapStackController?.isStackAvailable?.(SURVEY_MAP_STACK);
  }

  function renderFire() {
    const on = Boolean(dataManager?.isEnabled?.(SURVEY_FIRE_LAYER_ID));
    fireCheckbox.checked = on;
    fireCredit.hidden = !on;
    fireCheckbox.disabled = !dataManager?.layers?.has?.(SURVEY_FIRE_LAYER_ID);
    if (on) state.fireViewed = true;
  }

  function renderAll() {
    renderUnits();
    renderSite();
    renderTerrain();
    renderProfile();
    renderPlan();
    renderStackNotice();
    renderFire();
  }

  // ---- work ------------------------------------------------------------
  async function runTerrain() {
    terrainController?.abort();
    if (state.boundary.length < 3) {
      state.terrain = { status: 'not-run' };
      renderTerrain();
      return;
    }
    const controller = new AbortController();
    terrainController = controller;
    state.terrain = { status: 'loading' };
    renderTerrain();
    const grid = gridSamplePoints(state.boundary);
    try {
      const result = await sampleHeights(grid.points, {
        signal: controller.signal,
      });
      if (controller.signal.aborted) return;
      if (result.status !== 'ok') {
        state.terrain = { status: 'unavailable' };
      } else {
        const samples = grid.points.map((p, index) => ({
          ...p,
          height: result.heights[index],
        }));
        state.terrain = {
          status: 'ok',
          stats: elevationStats(samples),
          slope: slopeStats(samples, grid.spacingM),
          spacingM: grid.spacingM,
          datum: result.datum,
        };
      }
    } catch (error) {
      if (controller.signal.aborted) return;
      console.warn('[SiteSurvey] terrain sampling failed:', error);
      state.terrain = { status: 'unavailable' };
    }
    renderTerrain();
  }

  async function runProfile() {
    profileController?.abort();
    if (state.profile.length < 2) {
      state.profileSamples = [];
      state.profileResult = null;
      renderProfile();
      return;
    }
    const controller = new AbortController();
    profileController = controller;
    state.profileResult = 'loading';
    renderProfile();
    const stations = profileStations(state.profile);
    try {
      const result = await sampleHeights(stations, {
        signal: controller.signal,
      });
      if (controller.signal.aborted) return;
      if (result.status !== 'ok') {
        state.profileSamples = [];
        state.profileResult = 'unavailable';
      } else {
        state.profileSamples = stations.map((s, index) => ({
          ...s,
          height: result.heights[index],
        }));
        state.profileResult = profileSummary(state.profileSamples);
      }
    } catch (error) {
      if (controller.signal.aborted) return;
      console.warn('[SiteSurvey] profile sampling failed:', error);
      state.profileResult = 'unavailable';
    }
    renderProfile();
  }

  function setBoundary(vertices, { fly = false } = {}) {
    state.boundary = vertices.map((v) => ({ lon: v.lon, lat: v.lat }));
    scene.setBoundary(state.boundary, { editing: draw.mode === 'edit' });
    renderSite();
    computePlan();
    void runTerrain();
    layers.refreshGrid();
    if (fly) scene.flyToBoundary(state.boundary);
  }

  // Moving a corner redraws at once; the heavier terrain pass waits for the
  // drag to settle.
  let terrainTimer = null;
  function moveVertex(index, vertex) {
    if (!state.boundary[index]) return;
    state.boundary[index] = vertex;
    scene.setBoundary(state.boundary, { editing: true });
    renderSite();
    computePlan();
    clearTimeout(terrainTimer);
    terrainTimer = setTimeout(() => void runTerrain(), 600);
  }
  function removeVertex(index) {
    if (state.boundary.length <= 3) {
      hint.textContent = t('A boundary needs at least three corners.');
      return;
    }
    state.boundary.splice(index, 1);
    setBoundary(state.boundary);
  }

  function reportInput() {
    const facts = boundaryFacts();
    const stack = mapStackController?.getActiveId?.();
    const attributions = [];
    if (stack && SURVEY_IMAGERY_CREDITS[stack])
      attributions.push(t(SURVEY_IMAGERY_CREDITS[stack]));
    for (const overlay of SURVEY_OVERLAYS)
      attributions.push(t(overlay.attribution));
    attributions.push(t(SURVEY_FIRE_ATTRIBUTION));
    for (const layer of SURVEY_LAYERS)
      if (state.layersViewed.has(layer.id))
        attributions.push(t(layer.attribution));
    for (const credit of SURVEY_BASE_ATTRIBUTIONS) attributions.push(t(credit));
    const overlays = SURVEY_OVERLAYS.map((overlay) => ({
      label: t(overlay.label),
      checked: state.layersViewed.has(overlay.id),
    }));
    for (const layer of SURVEY_LAYERS)
      if (state.layersViewed.has(layer.id))
        overlays.push({ label: t(layer.label), checked: true });
    overlays.push({
      label: t('NASA FIRMS active fires'),
      checked: state.fireViewed,
    });
    return {
      siteName: state.siteName,
      generatedAt: new Date(),
      units: units(),
      boundary: facts,
      terrain: state.terrain,
      profile:
        state.profileResult && typeof state.profileResult === 'object'
          ? state.profileResult
          : null,
      overlays,
      plan: state.plan,
      droneName: droneName(),
      snapshot: scene.snapshot(),
      attributions,
    };
  }

  let lastReport = null;
  function buildReport() {
    const input = reportInput();
    if (!input.boundary) {
      reportStatus.textContent = t('Draw a boundary first.');
      return;
    }
    const page = buildSiteReportHtml(input);
    lastReport = page;
    download(
      `${fileStem(state.siteName)}-site-screening.html`,
      page,
      'text/html;charset=utf-8',
      documentRef,
    );
    printButton.disabled = false;
    reportStatus.textContent = input.snapshot
      ? t('Report downloaded. Open the printable view to save it as a PDF.')
      : t(
          'Report downloaded without a map snapshot (the view could not be captured).',
        );
  }
  function openPrintable() {
    if (!lastReport) return;
    const url = URL.createObjectURL(
      new Blob([lastReport], { type: 'text/html;charset=utf-8' }),
    );
    const opened = window.open(url, '_blank');
    if (!opened)
      reportStatus.textContent = t(
        'The browser blocked the new tab. Open the downloaded file instead.',
      );
    setTimeout(() => URL.revokeObjectURL(url), 60_000);
  }

  // ---- events ----------------------------------------------------------
  const setUnits = (system) => {
    state.units = system === 'metric' ? 'metric' : 'us';
    writeUnitSystem(state.units);
    layers.refreshGrid();
    renderAll();
  };
  listen(unitsUs, 'click', () => setUnits('us'));
  listen(unitsMetric, 'click', () => setUnits('metric'));
  listen(closeButton, 'click', () => void mode.setActive(false));
  listen(stackButton, 'click', () => {
    void styleManager?.setMapStack?.(SURVEY_MAP_STACK);
  });
  listen(nameInput, 'input', () => {
    state.siteName = nameInput.value;
  });
  listen(drawButton, 'click', () => {
    if (draw.mode === 'boundary') {
      draw.stop();
      return;
    }
    draw.startBoundary();
    renderDrawButtons();
  });
  listen(editButton, 'click', () => {
    if (draw.mode === 'edit') draw.stop();
    else draw.startEdit();
    scene.setBoundary(state.boundary, { editing: draw.mode === 'edit' });
    renderDrawButtons();
  });
  listen(clearButton, 'click', () => {
    draw.stop();
    terrainController?.abort();
    profileController?.abort();
    state.profile = [];
    state.profileSamples = [];
    state.profileResult = null;
    scene.setProfile([]);
    setBoundary([]);
    state.terrain = { status: 'not-run' };
    renderAll();
  });
  listen(flyButton, 'click', () => scene.flyToBoundary(state.boundary));
  listen(sampleButton, 'click', () => void runTerrain());
  listen(profileButton, 'click', () => {
    if (draw.mode === 'profile') draw.stop();
    else draw.startProfile();
    renderDrawButtons();
  });
  listen(clearProfileButton, 'click', () => {
    profileController?.abort();
    state.profile = [];
    state.profileSamples = [];
    state.profileResult = null;
    scene.setProfile([]);
    renderProfile();
  });
  listen(opacity, 'input', () =>
    layers.setOverlayAlpha(Number(opacity.value) / 100),
  );
  listen(fireCheckbox, 'change', () => {
    void dataManager
      ?.setEnabled?.(SURVEY_FIRE_LAYER_ID, fireCheckbox.checked, {
        origin: 'user',
      })
      ?.finally?.(renderFire);
  });
  for (const [id, row] of layerRows) {
    if (id === SURVEY_FIRE_LAYER_ID) continue;
    listen(row.checkbox, 'change', () => setLayer(id, row.checkbox.checked));
  }
  function renderWayback() {
    waybackButtons.forEach((b, index) => {
      const on = index === layers.waybackIndex;
      b.setAttribute('aria-checked', String(on));
      b.classList.toggle('active', on);
    });
  }
  waybackButtons.forEach((b, index) =>
    listen(b, 'click', () => {
      layers.setWaybackRelease(index);
      if (!layers.isOn('past-wayback')) setLayer('past-wayback', true);
      renderWayback();
    }),
  );
  renderWayback();
  function renderCompare() {
    const on = compareInput.checked && layers.isOn('past-wayback');
    const at = Number(splitInput.value) / 100;
    layers.setWaybackCompare(on, at);
    splitInput.disabled = !on;
    swipeLine.hidden = !on;
    if (on) {
      const rect = viewer.scene.canvas.getBoundingClientRect();
      swipeLine.style.left = `${rect.left + rect.width * at}px`;
      swipeLine.style.top = `${rect.top}px`;
      swipeLine.style.height = `${rect.height}px`;
    }
  }
  listen(compareInput, 'change', renderCompare);
  listen(splitInput, 'input', renderCompare);

  // ---- guided flights --------------------------------------------------
  const player = createFlightPlayer({
    viewer,
    layers,
    setLayer,
    documentRef,
    // Flights drape layers on the globe: leave Google 3D for Esri imagery.
    onPlay: () => {
      const stack = mapStackController?.getActiveId?.();
      if (
        stack !== SURVEY_MAP_STACK &&
        !SURVEY_GLOBE_STACKS.includes(stack) &&
        mapStackController?.isStackAvailable?.(SURVEY_MAP_STACK)
      )
        void styleManager?.setMapStack?.(SURVEY_MAP_STACK);
    },
  });
  disposers.push(() => player.destroy());
  disposers.push(
    player.subscribe(({ flightId }) => {
      if (flightSelect.value !== flightId) flightSelect.value = flightId;
    }),
  );
  // Play starts the first camera move inside this click handler.
  listen(flightPlayButton, 'click', () => player.play(flightSelect.value));

  // ---- map clicks: soils, stations, EPA sites --------------------------
  const info = createSurveyInfoCard({ documentRef });
  disposers.push(() => info.destroy());
  const when = (iso) => {
    const date = new Date(iso);
    if (Number.isNaN(date.getTime())) return '';
    const days = (Date.now() - date.getTime()) / 864e5;
    const text = formatDate(date, {
      year: 'numeric',
      month: 'short',
      day: 'numeric',
      ...(days < 2 ? { hour: 'numeric', minute: '2-digit' } : {}),
    });
    return days > 30 ? t('{date} (older reading)', { date: text }) : text;
  };
  function showStation(site) {
    info.show({
      kicker: t('USGS station {id}', { id: site.id.replace(/^USGS-/, '') }),
      title: site.name,
      rows: site.readings.map((r) => [
        USGS_PARAMETERS[r.code]
          ? t(USGS_PARAMETERS[r.code])
          : t('Parameter {code}', { code: r.code }),
        formatReading(r, state.units),
        when(r.time),
      ]),
      note: site.readings.length
        ? t('Latest values reported to USGS; recent data are provisional.')
        : t('No recent readings from this station.'),
      links: [
        {
          href: usgsStationPage(site.id),
          label: t('Open the USGS station page'),
        },
      ],
    });
  }
  function showEpa(site) {
    info.show({
      kicker: t('EPA regulated site'),
      title: site.name || t('Unnamed site'),
      subtitle: site.address,
      rows: site.programs.map((p) => [
        t('Program'),
        t(p.name),
        [p.system, p.systemId].filter(Boolean).join(' '),
      ]),
      note: t(
        'Being listed does not mean a site is contaminated; check the EPA record.',
      ),
      links: [
        {
          href: epaFacilityPage(site.id),
          label: t('Open the EPA facility record'),
        },
        ...site.programs
          .filter((p) => p.url)
          .slice(0, 2)
          .map((p) => ({
            href: p.url,
            label: t('{program} record', { program: t(p.name) }),
          })),
      ],
    });
  }
  async function showSoil(point) {
    const token = info.loading(t('USDA soil survey'), formatLatLon(point));
    try {
      const soil = parseSdaSoil(
        await fetchJson(SDA_URL, { body: sdaSoilRequest(point) }),
      );
      if (!info.isCurrent(token)) return;
      if (!soil) {
        info.show({
          kicker: t('USDA soil survey'),
          title: t('No soil record here'),
          note: t('Water, built-up land, or outside the soil survey.'),
        });
        return;
      }
      info.show({
        kicker: t('USDA soil survey'),
        title: soil.name,
        rows: [
          ...(soil.component
            ? [
                [
                  t('Main soil'),
                  soil.componentPct === null
                    ? soil.component
                    : t('{name} ({pct}% of the unit)', {
                        name: soil.component,
                        pct: soil.componentPct,
                      }),
                ],
              ]
            : []),
          [
            t('Texture'),
            [soil.texture, compositionText(soil)].filter(Boolean).join(' · ') ||
              t('Not recorded'),
          ],
          [t('Drainage class'), soil.drainage || t('Not recorded')],
          [t('Farmland class'), soil.farmland || t('Not recorded')],
        ],
        note: t('USDA NRCS Soil Data Access (SSURGO), at {point}.', {
          point: formatLatLon(point),
        }),
        links: [
          {
            href: 'https://websoilsurvey.nrcs.usda.gov/',
            label: t('Open Web Soil Survey'),
          },
        ],
      });
    } catch {
      if (!info.isCurrent(token)) return;
      info.show({
        kicker: t('USDA soil survey'),
        title: t('The soil service did not answer'),
        note: t('Try the click again in a moment.'),
      });
    }
  }
  async function showSoilGrids(point) {
    const token = info.loading(t('SoilGrids (worldwide)'), formatLatLon(point));
    try {
      const soil = parseSoilGrids(await fetchJson(soilGridsUrl(point)));
      if (!info.isCurrent(token)) return;
      if (!soil) {
        info.show({
          kicker: t('SoilGrids (worldwide)'),
          title: t('No SoilGrids estimate here'),
          note: t('Towns and water are not mapped by SoilGrids.'),
        });
        return;
      }
      info.show({
        kicker: t('SoilGrids (worldwide)'),
        title: soil.texture ? t(soil.texture) : t('Topsoil (0–5 cm)'),
        rows: [
          [t('Sand'), `${soil.sand}%`],
          [t('Silt'), `${soil.silt}%`],
          [t('Clay'), `${soil.clay}%`],
        ],
        note: t(
          'Modelled topsoil (0–5 cm) from ISRIC SoilGrids 2.0, at {point}; check on site.',
          { point: formatLatLon(point) },
        ),
        links: [
          {
            href: 'https://soilgrids.org/',
            label: t('Open SoilGrids'),
          },
        ],
      });
    } catch {
      if (!info.isCurrent(token)) return;
      info.show({
        kicker: t('SoilGrids (worldwide)'),
        title: t('The soil service did not answer'),
        note: t('Try the click again in a moment.'),
      });
    }
  }
  const clicks = createSurveyClickHandler({
    viewer,
    isActive: () => active,
    infoOf: (entity) => layers.infoOf(entity),
    onPoint: (picked) =>
      picked.kind === 'station'
        ? showStation(picked.site)
        : showEpa(picked.site),
    onGround: (point) => {
      if (layers.isOn('nrcs-ssurgo') && isInUnitedStates(point.lon, point.lat))
        void showSoil(point);
      else if (layers.isOn('world-soilgrids')) void showSoilGrids(point);
      else if (
        ['topo-hillshade', 'topo-contours', 'topo-relief'].some((id) =>
          layers.isOn(id),
        )
      )
        void showHeight(point);
    },
  });
  disposers.push(() => clicks.destroy());
  async function showHeight(point) {
    const token = info.loading(t('Ground height'), formatLatLon(point));
    try {
      const result = await sampleHeights([point], {});
      if (!info.isCurrent(token)) return;
      const h = result?.status === 'ok' ? result.heights[0] : NaN;
      if (!Number.isFinite(h)) throw new Error('no height');
      info.show({
        kicker: t('Ground height'),
        title: formatHeight(h, state.units),
        rows: [
          [
            state.units === 'us' ? t('Metric') : t('US'),
            formatHeight(h, state.units === 'us' ? 'metric' : 'us'),
          ],
        ],
        note:
          result.datum === 'egm96'
            ? t(
                'Above mean sea level (EGM96), from the 3D terrain model, at {point}.',
                {
                  point: formatLatLon(point),
                },
              )
            : t(
                'Ellipsoidal (WGS-84) height from the 3D terrain model, at {point}.',
                {
                  point: formatLatLon(point),
                },
              ),
      });
    } catch {
      if (!info.isCurrent(token)) return;
      info.show({
        kicker: t('Ground height'),
        title: t('Terrain not loaded — add a Cesium ion token for elevation'),
      });
    }
  }
  // US-only layers say when the map looks outside the US.
  const onCameraSettled = () => {
    const c = viewer.camera.positionCartographic;
    const lon = (c.longitude * 180) / Math.PI;
    const lat = (c.latitude * 180) / Math.PI;
    const inUs = isInUnitedStates(lon, lat);
    if (inUs === viewInUs) return;
    viewInUs = inUs;
    for (const id of layerRows.keys()) renderLayerStatus(id);
  };
  viewer.camera.moveEnd.addEventListener(onCameraSettled);
  disposers.push(() =>
    viewer.camera.moveEnd.removeEventListener(onCameraSettled),
  );
  listen(droneSelect, 'change', () => {
    state.droneId = droneSelect.value;
    computePlan();
  });
  for (const [key, input] of Object.entries(customInputs)) {
    listen(input, 'input', () => {
      state.custom = { ...state.custom, [key]: Number(input.value) };
      computePlan();
    });
  }
  listen(altitudeInput, 'input', () => {
    state.altitudeM = heightInputToMetres(altitudeInput.value, units());
    computePlan();
  });
  listen(speedInput, 'input', () => {
    state.speedMps = speedInputToMps(speedInput.value, units());
    computePlan();
  });
  listen(frontInput, 'input', () => {
    state.frontOverlap = Number(frontInput.value) / 100;
    computePlan();
  });
  listen(sideInput, 'input', () => {
    state.sideOverlap = Number(sideInput.value) / 100;
    computePlan();
  });
  listen(headingSelect, 'change', () => {
    state.heading =
      headingSelect.value === 'auto' ? 'auto' : Number(headingInput.value) || 0;
    computePlan();
  });
  listen(headingInput, 'input', () => {
    if (state.heading === 'auto') return;
    state.heading = Number(headingInput.value) || 0;
    computePlan();
  });
  listen(showPlanInput, 'change', () => {
    state.showPlan = showPlanInput.checked;
    scene.setPlan(state.showPlan ? state.plan : null);
  });
  const exportFile = (kind) => {
    const input = {
      siteName: state.siteName,
      boundary: state.boundary,
      plan: state.plan,
      droneName: droneName(),
    };
    const stem = fileStem(state.siteName);
    if (kind === 'kml')
      download(
        `${stem}-flight-plan.kml`,
        surveyKml(input),
        'application/vnd.google-earth.kml+xml',
        documentRef,
      );
    else
      download(
        `${stem}-flight-plan.geojson`,
        JSON.stringify(surveyGeoJson(input), null, 2),
        'application/geo+json',
        documentRef,
      );
  };
  listen(kmlButton, 'click', () => exportFile('kml'));
  listen(geojsonButton, 'click', () => exportFile('geojson'));
  listen(reportButton, 'click', buildReport);
  listen(printButton, 'click', openPrintable);

  function renderDrawButtons() {
    drawButton.classList.toggle('active', draw.mode === 'boundary');
    drawButton.setAttribute('aria-pressed', String(draw.mode === 'boundary'));
    editButton.classList.toggle('active', draw.mode === 'edit');
    editButton.setAttribute('aria-pressed', String(draw.mode === 'edit'));
    profileButton.classList.toggle('active', draw.mode === 'profile');
    profileButton.setAttribute('aria-pressed', String(draw.mode === 'profile'));
  }

  const unsubscribeStack = mapStackController?.subscribe?.(() =>
    renderStackNotice(),
  );
  if (unsubscribeStack) disposers.push(unsubscribeStack);
  const unsubscribeData = dataManager?.subscribe?.(() => renderFire());
  if (typeof unsubscribeData === 'function') disposers.push(unsubscribeData);
  disposers.push(
    registerUnsavedWork(() =>
      state.boundary.length >= 3 ? t('a Site Survey boundary') : null,
    ),
  );

  renderAll();
  renderDrawButtons();

  return {
    element: panel,
    show(on) {
      panel.hidden = !on;
      active = Boolean(on);
      if (on) {
        // Reference layers (names, boundary lines, grid) open with the survey.
        for (const id of SURVEY_DEFAULT_ON) setLayer(id, true);
      } else {
        draw.stop();
        player.stop();
        info.hide();
        // Survey layers belong to the survey; leaving it takes them off.
        for (const id of layers.activeIds()) setLayer(id, false);
        layers.clear();
      }
      renderAll();
    },
    /** Guided flights (console and QA seam). */
    player,
    /** Survey map layers (console and QA seam). */
    layers,
    setLayer,
    /** Called by the draw controller when a shape is finished. */
    onFinish(kind, vertices) {
      if (kind === 'boundary') setBoundary(vertices);
      else {
        state.profile = vertices;
        scene.setProfile(vertices);
        void runProfile();
      }
      renderDrawButtons();
    },
    onVertexMoved: moveVertex,
    onVertexRemoved: removeVertex,
    setHint(text) {
      hint.textContent = text;
      renderDrawButtons();
      if (!text && draw.mode === 'idle')
        scene.setBoundary(state.boundary, { editing: false });
    },
    /** Test and console seam: the panel's current state. */
    get state() {
      return state;
    },
    setBoundary,
    setProfile(vertices) {
      state.profile = vertices;
      scene.setProfile(vertices);
      return runProfile();
    },
    runTerrain,
    buildReportHtml: () => {
      const input = reportInput();
      return input.boundary ? buildSiteReportHtml(input) : null;
    },
    destroy() {
      terrainController?.abort();
      profileController?.abort();
      clearTimeout(terrainTimer);
      for (const dispose of disposers.splice(0)) {
        try {
          dispose();
        } catch {
          /* already gone */
        }
      }
    },
  };
}
