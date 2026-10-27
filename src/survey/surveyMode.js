/**
 * Site Survey mode: what changes in the rest of the app while it is on, and
 * putting all of it back when it is turned off.
 *
 * Entering:
 * - turns off the tracking, camera, signal and military layers
 *   (SURVEY_HIDDEN_LAYER_IDS) and guards them off while the mode lasts;
 * - leaves the cockpit, stops following anything, hides the HUD, turns
 *   detection boxes and the circular scope mask off and returns the visual
 *   style to Normal;
 * - moves a Google 3D view to draped Esri imagery, where public overlays and
 *   terrain sampling work;
 * - swaps the tactical wording in the title for survey wording, and marks
 *   the page `body.gev-site-survey` so CSS can hide the rest of that chrome;
 * - writes `?survey=1` into the address, which share links carry.
 *
 * Leaving undoes each of those it did, and only those: a layer the person
 * turned off themselves is not turned back on.
 */
import { t } from '../i18n/index.js';
import {
  SURVEY_CHROME_TEXT,
  SURVEY_GLOBE_STACKS,
  SURVEY_HIDDEN_LAYER_IDS,
  SURVEY_MAP_STACK,
  surveyVisibilityVerdict,
  withSurveyFlag,
} from './policy.js';

export const SURVEY_BODY_CLASS = 'gev-site-survey';

/**
 * @param {object} deps
 * @param {object} deps.viewer
 * @param {object} deps.styleManager
 * @param {object} deps.dataManager
 * @param {object} [deps.mapStackController]
 * @param {Window} [deps.windowRef]
 */
export function createSurveyMode({
  viewer,
  styleManager,
  dataManager,
  mapStackController,
  windowRef = globalThis.window,
}) {
  let active = false;
  let removeGuard = null;
  let restore = null;
  let transition = Promise.resolve();
  const listeners = new Set();

  const subtitle = windowRef.document.querySelector('#title-bar .subtitle');
  // The circular scope mask is the tactical look; its own checkbox turns it
  // off and on, so the share state and the control stay in step.
  const scopeToggle = windowRef.document.getElementById('scope-toggle');

  const notify = () => {
    for (const listener of [...listeners]) {
      try {
        listener(active);
      } catch (error) {
        console.warn('[SiteSurvey] mode listener failed:', error);
      }
    }
  };

  const writeAddress = (on) => {
    try {
      const href = withSurveyFlag(windowRef.location.href, on);
      if (href !== windowRef.location.href)
        windowRef.history.replaceState(windowRef.history.state, '', href);
    } catch {
      /* an address the History API refuses stays as it was */
    }
  };

  async function enter() {
    const saved = {
      layers: [],
      hudMode: null,
      detection: false,
      style: null,
      mapStack: null,
      subtitle: subtitle?.textContent ?? null,
      scope: false,
    };
    restore = saved;
    // Guard first, so nothing hidden can come back on mid-transition.
    removeGuard = dataManager?.addVisibilityGuard?.((change) =>
      surveyVisibilityVerdict(change)
        ? t(surveyVisibilityVerdict(change))
        : null,
    );
    try {
      if (styleManager?.getCockpitState?.()?.active)
        styleManager.controlCockpit?.('exit');
    } catch {
      /* not in the cockpit */
    }
    if (viewer?.trackedEntity) viewer.trackedEntity = undefined;
    for (const layerId of SURVEY_HIDDEN_LAYER_IDS) {
      if (!dataManager?.isEnabled?.(layerId)) continue;
      saved.layers.push(layerId);
      try {
        await dataManager.setEnabled(layerId, false, {
          origin: 'programmatic',
        });
      } catch {
        /* a layer that refuses to stop is still guarded */
      }
    }
    const controls = styleManager?.getControlState?.();
    const hud = styleManager?.hud;
    if (hud && styleManager.setHudVisible) {
      // `_autoMode` is the HUD's own record of whether the style drives it.
      saved.hudMode =
        hud._autoMode === false ? (hud.visible ? 'on' : 'off') : 'auto';
      styleManager.setHudVisible('off');
    }
    const detection = styleManager?.getDetectionState?.();
    if (
      detection &&
      detection.detectionMode &&
      detection.detectionMode !== 'OFF'
    ) {
      saved.detection = true;
      styleManager.setDetection?.({ enabled: false });
    }
    if (controls?.style && controls.style !== 'normal') {
      saved.style = controls.style;
      styleManager.setStyle?.('normal', { userInitiated: true });
    }
    const stack = mapStackController?.getActiveId?.();
    if (
      stack &&
      !SURVEY_GLOBE_STACKS.includes(stack) &&
      mapStackController?.isStackAvailable?.(SURVEY_MAP_STACK)
    ) {
      saved.mapStack = stack;
      await styleManager?.setMapStack?.(SURVEY_MAP_STACK);
    }
    if (scopeToggle?.checked) {
      saved.scope = true;
      scopeToggle.click();
    }
    if (subtitle) subtitle.textContent = t(SURVEY_CHROME_TEXT.subtitle);
    windowRef.document.body.classList.add(SURVEY_BODY_CLASS);
    writeAddress(true);
  }

  async function leave() {
    const saved = restore;
    restore = null;
    removeGuard?.();
    removeGuard = null;
    windowRef.document.body.classList.remove(SURVEY_BODY_CLASS);
    writeAddress(false);
    if (!saved) return;
    if (subtitle && saved.subtitle !== null)
      subtitle.textContent = saved.subtitle;
    if (
      saved.mapStack &&
      mapStackController?.getActiveId?.() === SURVEY_MAP_STACK
    )
      await styleManager?.setMapStack?.(saved.mapStack);
    if (saved.style && styleManager?.activeStyle === 'normal')
      styleManager.setStyle?.(saved.style, { userInitiated: true });
    if (saved.detection) styleManager?.setDetection?.({ enabled: true });
    if (saved.hudMode) styleManager?.setHudVisible?.(saved.hudMode);
    if (saved.scope && scopeToggle && !scopeToggle.checked) scopeToggle.click();
    for (const layerId of saved.layers) {
      try {
        await dataManager.setEnabled(layerId, true, { origin: 'programmatic' });
      } catch {
        /* a layer that cannot restart is left off */
      }
    }
  }

  /** Turn the mode on or off. Resolves once every step has run. */
  function setActive(next) {
    const wanted = Boolean(next);
    transition = transition.then(async () => {
      if (wanted === active) return active;
      active = wanted;
      notify();
      try {
        if (wanted) await enter();
        else await leave();
      } catch (error) {
        console.warn('[SiteSurvey] mode change incomplete:', error);
      }
      return active;
    });
    return transition;
  }

  return {
    get active() {
      return active;
    },
    setActive,
    toggle: () => setActive(!active),
    subscribe(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    async destroy() {
      listeners.clear();
      if (active) await setActive(false);
      await transition;
    },
  };
}
