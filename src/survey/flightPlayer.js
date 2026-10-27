/**
 * Site Survey guided flights: the Cesium + DOM half of guidedFlights.js.
 *
 * Play moves the camera at once — the first camera move is started in the
 * click handler itself, and nothing waits for tiles or overlays to load —
 * then each shot flies for FLIGHT_SECONDS and holds for HOLD_MS before the
 * next. A caption bar over the globe shows the shot's one-line caption with
 * Previous / Play-Pause / Next and a close button.
 *
 * `metrics` records, for the last Play, the time from the click to the
 * camera flight being started (`flightCalledMs`, in the click handler
 * itself) and to the first rendered frame in which the camera had moved
 * (`firstMotionMs`, which is one frame time on the viewer's GPU).
 */
import * as Cesium from 'cesium';
import { t } from '../i18n/index.js';
import {
  FLIGHT_SECONDS,
  GUIDED_FLIGHTS,
  HOLD_MS,
  SAMPLE_SITE_OUTLINE,
  flightById,
  isLastShot,
  shotLayerPlan,
  stepShot,
} from './guidedFlights.js';

export const FLIGHT_BAR_ID = 'site-survey-flight-bar';

/**
 * @param {object} deps
 * @param {Cesium.Viewer} deps.viewer
 * @param {ReturnType<import('./surveyLayers.js').createSurveyLayers>} deps.layers
 * @param {(id:string, on:boolean) => void} deps.setLayer turns a layer on/off and keeps the panel in step
 * @param {Document} [deps.documentRef]
 */
export function createFlightPlayer({
  viewer,
  layers,
  setLayer,
  documentRef = document,
}) {
  const state = {
    flight: GUIDED_FLIGHTS[0],
    index: -1,
    playing: false,
  };
  const metrics = {
    playAt: null,
    flightCalledMs: null,
    firstMotionMs: null,
    shotsStarted: 0,
  };
  let holdTimer = null;
  let motionFrame = null;
  let destroyed = false;
  const listeners = new Set();

  // ---- caption bar ------------------------------------------------------
  const el = (tag, props = {}, children = []) => {
    const node = documentRef.createElement(tag);
    for (const [key, value] of Object.entries(props)) {
      if (value === undefined || value === null) continue;
      if (key === 'class') node.className = value;
      else if (key === 'text') node.textContent = value;
      else if (key.startsWith('aria-') || key.startsWith('data-'))
        node.setAttribute(key, value);
      else node[key] = value;
    }
    for (const child of [].concat(children)) if (child) node.append(child);
    return node;
  };
  const iconButton = (glyph, label) =>
    el('button', {
      type: 'button',
      class: 'survey-flight-button',
      'aria-label': label,
      title: label,
      text: glyph,
    });
  const prevButton = iconButton('◀', t('Previous shot'));
  const playButton = iconButton('▶', t('Play'));
  const nextButton = iconButton('▶▶', t('Next shot'));
  const closeButton = iconButton('×', t('Close guided flight'));
  closeButton.classList.add('survey-flight-close');
  const title = el('p', { class: 'survey-flight-title' });
  const caption = el('p', {
    class: 'survey-flight-caption',
    'aria-live': 'polite',
  });
  const bar = el(
    'section',
    {
      id: FLIGHT_BAR_ID,
      class: 'survey-flight-bar',
      'aria-label': t('Guided flight'),
      hidden: true,
    },
    [
      el('div', { class: 'survey-flight-text' }, [title, caption]),
      el('div', { class: 'survey-flight-controls' }, [
        prevButton,
        playButton,
        nextButton,
        closeButton,
      ]),
    ],
  );
  documentRef.body.appendChild(bar);

  function renderBar() {
    const { flight, index } = state;
    bar.hidden = index < 0;
    if (index < 0) return;
    const shot = flight.shots[index];
    title.textContent = `${t(flight.label)} · ${t('Shot {n} of {total}', {
      n: index + 1,
      total: flight.shots.length,
    })}`;
    caption.replaceChildren(t(shot.caption));
    if (shot.link) {
      const link = el('a', {
        href: shot.link.href,
        target: '_blank',
        rel: 'noopener noreferrer',
        class: 'survey-flight-link',
        text: t(shot.link.label),
      });
      caption.append(' ', link);
    }
    playButton.textContent = state.playing ? '❚❚' : '▶';
    playButton.setAttribute(
      'aria-label',
      state.playing ? t('Pause') : t('Play'),
    );
    playButton.title = playButton.getAttribute('aria-label');
    prevButton.disabled = index <= 0;
    nextButton.disabled = isLastShot(flight, index);
    for (const listener of listeners) listener(snapshot());
  }

  // ---- camera ----------------------------------------------------------
  function watchFirstMotion() {
    if (motionFrame) cancelAnimationFrame(motionFrame);
    const start = Cesium.Cartesian3.clone(viewer.camera.positionWC);
    const startHeading = viewer.camera.heading;
    const tick = () => {
      motionFrame = null;
      if (destroyed || metrics.playAt === null) return;
      const moved =
        Cesium.Cartesian3.distance(start, viewer.camera.positionWC) > 0.5 ||
        Math.abs(viewer.camera.heading - startHeading) > 1e-4;
      if (moved) {
        metrics.firstMotionMs = Math.round(performance.now() - metrics.playAt);
        return;
      }
      if (performance.now() - metrics.playAt < 10_000)
        motionFrame = requestAnimationFrame(tick);
    };
    motionFrame = requestAnimationFrame(tick);
  }

  function applyLayers(shot) {
    const plan = shotLayerPlan(shot, (id) => layers.isOn(id));
    for (const id of plan.off) setLayer(id, false);
    for (const id of plan.on) setLayer(id, true);
    layers.setOutline(shot.outline ? SAMPLE_SITE_OUTLINE : null);
  }

  function flyTo(index) {
    clearTimeout(holdTimer);
    holdTimer = null;
    state.index = index;
    const shot = state.flight.shots[index];
    const { lon, lat, range, heading, pitch } = shot.camera;
    viewer.camera.cancelFlight();
    // Camera first, layers right after: the move must never wait on them.
    viewer.camera.flyToBoundingSphere(
      new Cesium.BoundingSphere(Cesium.Cartesian3.fromDegrees(lon, lat), 0),
      {
        duration: FLIGHT_SECONDS,
        offset: new Cesium.HeadingPitchRange(
          Cesium.Math.toRadians(heading),
          Cesium.Math.toRadians(pitch),
          range,
        ),
        complete: () => {
          if (destroyed || state.index !== index) return;
          if (state.playing) scheduleNext();
        },
        cancel: () => {
          // Someone grabbed the globe: stop advancing, keep the caption.
          if (state.index === index && state.playing) {
            state.playing = false;
            renderBar();
          }
        },
      },
    );
    metrics.shotsStarted += 1;
    if (metrics.flightCalledMs === null && metrics.playAt !== null)
      metrics.flightCalledMs = Math.round(performance.now() - metrics.playAt);
    viewer.scene.requestRender();
    applyLayers(shot);
    renderBar();
  }

  function scheduleNext() {
    clearTimeout(holdTimer);
    holdTimer = setTimeout(() => {
      holdTimer = null;
      if (destroyed || !state.playing) return;
      if (isLastShot(state.flight, state.index)) {
        state.playing = false;
        renderBar();
        return;
      }
      flyTo(state.index + 1);
    }, HOLD_MS);
  }

  // ---- controls --------------------------------------------------------
  function play(flightId) {
    if (destroyed) return;
    metrics.playAt = performance.now();
    metrics.firstMotionMs = null;
    metrics.flightCalledMs = null;
    watchFirstMotion();
    if (flightId && flightId !== state.flight.id) {
      state.flight = flightById(flightId);
      state.index = -1;
    }
    state.playing = true;
    const start =
      state.index < 0 || isLastShot(state.flight, state.index)
        ? 0
        : state.index + 1;
    flyTo(start);
  }
  function pause() {
    state.playing = false;
    clearTimeout(holdTimer);
    holdTimer = null;
    renderBar();
  }
  function step(delta) {
    if (state.index < 0) return;
    flyTo(stepShot(state.flight, state.index, delta));
  }
  function stop() {
    pause();
    viewer.camera.cancelFlight();
    state.index = -1;
    layers.setOutline(null);
    renderBar();
  }

  const onPlay = () => (state.playing ? pause() : play());
  const onPrev = () => step(-1);
  const onNext = () => step(1);
  playButton.addEventListener('click', onPlay);
  prevButton.addEventListener('click', onPrev);
  nextButton.addEventListener('click', onNext);
  closeButton.addEventListener('click', stop);

  function snapshot() {
    return {
      flightId: state.flight.id,
      index: state.index,
      playing: state.playing,
    };
  }

  return {
    element: bar,
    play,
    pause,
    next: onNext,
    prev: onPrev,
    stop,
    get state() {
      return snapshot();
    },
    get metrics() {
      return { ...metrics };
    },
    subscribe(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    destroy() {
      if (destroyed) return;
      stop();
      destroyed = true;
      if (motionFrame) cancelAnimationFrame(motionFrame);
      playButton.removeEventListener('click', onPlay);
      prevButton.removeEventListener('click', onPrev);
      nextButton.removeEventListener('click', onNext);
      closeButton.removeEventListener('click', stop);
      listeners.clear();
      bar.remove();
    },
  };
}
