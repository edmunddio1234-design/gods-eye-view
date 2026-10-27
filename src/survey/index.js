/**
 * Site Survey: a land-survey workspace on the globe for desktop site
 * screening — boundary, area and perimeter, elevation and slope, public
 * flood/wetland/soil/land-cover overlays, a drone mapping plan, and a
 * printable screening report.
 *
 * Turned on by the SITE SURVEY button in the top-centre actions, or by
 * opening the app with `?survey=1` (share links keep it). The application
 * lifetime owns everything this creates; `destroy()` gives it all back.
 */
import { t } from '../i18n/index.js';
import { createSurveyDrawController } from './drawController.js';
import { createSurveyMode } from './surveyMode.js';
import { createSurveyPanel } from './panel.js';
import { createSurveyScene } from './surveyScene.js';
import { sampleTerrainHeights } from './terrainSampler.js';
import { isSurveyRequested } from './policy.js';

export const SURVEY_TOGGLE_ID = 'site-survey-toggle';

/**
 * @param {object} deps
 * @param {object} deps.viewer
 * @param {object} deps.styleManager
 * @param {object} deps.dataManager
 * @param {object} [deps.mapStackController]
 * @param {Promise<unknown>} [deps.ready] resolves once the opening link is restored
 * @returns {{destroy: Function}|null}
 */
export function initSiteSurvey({
  viewer,
  styleManager,
  dataManager,
  mapStackController,
  ready = Promise.resolve(),
  location = globalThis.location,
}) {
  if (!viewer || typeof document === 'undefined') return null;
  const scene = createSurveyScene(viewer);
  const mode = createSurveyMode({
    viewer,
    styleManager,
    dataManager,
    mapStackController,
  });
  let panel = null;
  const draw = createSurveyDrawController({
    viewer,
    onFinish: (kind, vertices) => panel?.onFinish(kind, vertices),
    onPreview: (preview) => scene.setDraft(preview),
    onVertexMoved: (index, vertex) => panel?.onVertexMoved(index, vertex),
    onVertexRemoved: (index) => panel?.onVertexRemoved(index),
    onHint: (text) => panel?.setHint(text),
    handleIndexOf: (entity) => scene.handleIndexOf(entity),
  });
  panel = createSurveyPanel({
    viewer,
    scene,
    draw,
    mode,
    dataManager,
    mapStackController,
    styleManager,
    sampleHeights: (points, options) =>
      sampleTerrainHeights(viewer, points, options),
  });

  // The toggle sits with the globe actions at the top centre.
  const toggle = document.createElement('button');
  toggle.id = SURVEY_TOGGLE_ID;
  toggle.type = 'button';
  toggle.setAttribute('aria-pressed', 'false');
  toggle.setAttribute('aria-label', t('Site Survey mode'));
  toggle.title = t(
    'Site Survey: boundary, terrain, land overlays, drone plan and report',
  );
  const icon = document.createElement('span');
  icon.className = 'material-symbols-outlined';
  icon.setAttribute('aria-hidden', 'true');
  icon.textContent = 'landscape';
  const label = document.createElement('span');
  label.className = 'site-survey-toggle-label';
  label.textContent = t('SURVEY');
  toggle.append(icon, label);
  const actions = document.getElementById('top-center-actions');
  if (actions) actions.prepend(toggle);
  else document.body.appendChild(toggle);
  const onToggle = () => void mode.toggle();
  toggle.addEventListener('click', onToggle);

  const unsubscribe = mode.subscribe((active) => {
    toggle.classList.toggle('active', active);
    toggle.setAttribute('aria-pressed', String(active));
    panel.show(active);
  });

  let destroyed = false;
  // Open in survey mode when the address asks, after the shared view (which
  // may turn layers on) has been restored.
  if (isSurveyRequested(location))
    void Promise.resolve(ready)
      .catch(() => {})
      .then(() => {
        if (!destroyed) return mode.setActive(true);
        return null;
      });

  const api = {
    mode,
    panel,
    draw,
    scene,
    async destroy() {
      if (destroyed) return;
      destroyed = true;
      toggle.removeEventListener('click', onToggle);
      unsubscribe();
      draw.destroy();
      await mode.destroy();
      panel.destroy();
      toggle.remove();
      await scene.destroy();
      if (window.__gevSiteSurvey === api) delete window.__gevSiteSurvey;
    },
  };
  // Console and QA seam, like window.__gevDrawTool.
  window.__gevSiteSurvey = api;
  return api;
}
