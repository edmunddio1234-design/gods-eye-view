/**
 * Site Survey map layers on the globe: the Cesium half of layerCatalog.js
 * and overlays.js. Draped imagery (kept in one stacking order), the map
 * grid, 3D relief, the monitoring points and past imagery, each added when
 * turned on and removed when turned off or when the survey closes.
 *
 * Everything is requested by the browser straight from keyless public
 * services with CORS, so it works under `vite preview` on a public host.
 * The one exception is the WMS fallback for FEMA and USFWS, which goes
 * through the app's own `/api/survey-wms/<id>` route only if their REST
 * services stop answering.
 */
import * as Cesium from 'cesium';
import { t } from '../i18n/index.js';
import {
  SURVEY_SLOW_HOSTS,
  WAYBACK_RELEASES,
  imageryRank,
  insertionIndex,
  surveyLayer,
  waybackTemplate,
} from './layerCatalog.js';
import { SURVEY_OVERLAYS, overlayTileSettings } from './overlays.js';
import { createGraticuleProvider } from './graticuleProvider.js';
import {
  EPA_PROGRAMS,
  epaQueryUrl,
  parseEpaSites,
  parseUsgsStations,
  pointQueryBox,
  usgsUrls,
} from './pointSources.js';

const FETCH_TIMEOUT_MS = 25_000;
/** Tile errors, with no tile loaded, before a layer swaps to its fallback. */
const FALLBACK_AFTER_ERRORS = 4;

let slowHostsSet = false;
function limitSlowHosts() {
  if (slowHostsSet) return;
  slowHostsSet = true;
  for (const [host, max] of Object.entries(SURVEY_SLOW_HOSTS))
    Cesium.RequestScheduler.requestsByServer[host] = max;
}

/** JSON from a keyless public service, with a timeout; POSTs `body` as JSON. */
export async function fetchJson(url, { signal, body } = {}) {
  const timeout = AbortSignal.timeout(FETCH_TIMEOUT_MS);
  const response = await fetch(url, {
    signal: signal ? AbortSignal.any([signal, timeout]) : timeout,
    ...(body
      ? {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(body),
        }
      : {}),
  });
  if (!response.ok) throw new Error(`http ${response.status}`);
  return response.json();
}

/**
 * @param {Cesium.Viewer} viewer
 * @param {object} [options]
 * @param {() => 'us'|'metric'} [options.getUnits]
 * @param {() => ({lon:number, lat:number}|null)} [options.getAnchor] site grid centre
 * @param {(id:string, status:{state:string, count?:number}) => void} [options.onStatus]
 */
export function createSurveyLayers(viewer, options = {}) {
  const {
    getUnits = () => 'us',
    getAnchor = () => null,
    onStatus = () => {},
  } = options;
  limitSlowHosts();
  /** id → {layer: Cesium.ImageryLayer, rank: number} */
  const imagery = new Map();
  const on = new Set();
  const status = new Map();
  const tileStats = new Map();
  let overlayAlpha = 0.6;
  let waybackIndex = 0;
  let compare = { on: false, position: 0.5 };
  const applyCompare = () => {
    const entry = imagery.get('past-wayback');
    const on = compare.on && Boolean(entry);
    if (entry)
      entry.layer.splitDirection = on
        ? Cesium.SplitDirection.LEFT
        : Cesium.SplitDirection.NONE;
    viewer.scene.splitPosition = on ? compare.position : 0.5;
  };
  let savedExaggeration = null;
  let destroyed = false;

  const points = new Cesium.CustomDataSource('gev-site-survey-points');
  const outline = new Cesium.CustomDataSource('gev-site-survey-outline');
  let attaching = Promise.all([
    viewer.dataSources.add(points),
    viewer.dataSources.add(outline),
  ]).catch(() => null);
  const pointEntities = new Map(); // layer id → entities
  const pointRequests = new Map(); // layer id → {key, controller}

  const render = () => {
    if (!viewer.isDestroyed?.()) viewer.scene.requestRender();
  };
  const setStatus = (id, next) => {
    const prev = status.get(id);
    if (prev && prev.state === next.state && prev.count === next.count) return;
    status.set(id, next);
    try {
      onStatus(id, next);
    } catch {
      /* a status listener must not break the layer */
    }
  };

  // ---- draped imagery ---------------------------------------------------
  function placeLayer(id, provider, settings = {}) {
    const rank = imageryRank(id);
    const mine = [...imagery.values()]
      .filter((entry) => viewer.imageryLayers.contains(entry.layer))
      .sort(
        (a, b) =>
          viewer.imageryLayers.indexOf(a.layer) -
          viewer.imageryLayers.indexOf(b.layer),
      );
    const at = insertionIndex(
      mine.map((entry) => entry.rank),
      rank,
    );
    const layer = new Cesium.ImageryLayer(provider, settings);
    if (at < mine.length)
      viewer.imageryLayers.add(
        layer,
        viewer.imageryLayers.indexOf(mine[at].layer),
      );
    else viewer.imageryLayers.add(layer);
    imagery.set(id, { layer, rank });
    return layer;
  }

  function removeImagery(id) {
    const entry = imagery.get(id);
    if (!entry) return;
    imagery.delete(id);
    try {
      viewer.imageryLayers.remove(entry.layer, true);
    } catch {
      /* viewer already gone */
    }
  }

  function tileState(id) {
    const s = tileStats.get(id);
    if (!s) return;
    if (s.inflight > 0 && s.ok === 0) setStatus(id, { state: 'loading' });
    else if (s.ok === 0 && s.err > 0 && s.inflight === 0)
      setStatus(id, { state: 'error' });
    else setStatus(id, { state: 'ready' });
  }

  /** A template provider that counts its tiles and can swap to a fallback. */
  function countedProvider(id, providerOptions, onFallback) {
    const provider = new Cesium.UrlTemplateImageryProvider({
      tilingScheme: new Cesium.WebMercatorTilingScheme(),
      hasAlphaChannel: true,
      enablePickFeatures: false,
      ...providerOptions,
    });
    const stats = { inflight: 0, ok: 0, err: 0 };
    tileStats.set(id, stats);
    provider.errorEvent.addEventListener((error) => {
      if (error) error.retry = error.timesRetried < 1;
    });
    const request = provider.requestImage.bind(provider);
    provider.requestImage = (x, y, level, req) => {
      const pending = request(x, y, level, req);
      if (pending?.then) {
        stats.inflight += 1;
        pending.then(
          () => {
            stats.inflight -= 1;
            stats.ok += 1;
            tileState(id);
          },
          () => {
            stats.inflight -= 1;
            if (req?.state !== Cesium.RequestState.CANCELLED) stats.err += 1;
            if (
              onFallback &&
              stats.ok === 0 &&
              stats.err >= FALLBACK_AFTER_ERRORS
            ) {
              const swap = onFallback;
              onFallback = null;
              swap();
            }
            tileState(id);
          },
        );
        tileState(id);
      }
      return pending;
    };
    return provider;
  }

  function overlayProvider(id, overlay, useWms) {
    const settings = overlayTileSettings(id);
    const credit = new Cesium.Credit(t(overlay.attribution));
    if (settings?.template && !useWms)
      return countedProvider(
        id,
        {
          url: settings.template,
          tileWidth: 512,
          tileHeight: 512,
          maximumLevel: 18,
          credit,
        },
        settings.wms ? () => swapOverlayToWms(id) : null,
      );
    if (!settings?.wms) return null;
    return new Cesium.WebMapServiceImageryProvider({
      url: settings.wms.url,
      layers: settings.wms.layers,
      parameters: { transparent: true, format: 'image/png', styles: '' },
      enablePickFeatures: false,
      credit,
    });
  }

  function swapOverlayToWms(id) {
    if (destroyed || !on.has(id)) return;
    const overlay = SURVEY_OVERLAYS.find((o) => o.id === id);
    const provider = overlay && overlayProvider(id, overlay, true);
    if (!provider) return;
    removeImagery(id);
    const layer = placeLayer(id, provider);
    layer.alpha = overlayAlpha;
    tileStats.delete(id);
    setStatus(id, { state: 'ready' });
    render();
  }

  function catalogProvider(id, entry, useFallback) {
    const source = useFallback ? entry.fallback : entry;
    return countedProvider(
      id,
      {
        url: source.url,
        tileWidth: entry.tileSize || 256,
        tileHeight: entry.tileSize || 256,
        maximumLevel: source.maximumLevel ?? entry.maximumLevel ?? 18,
        credit: new Cesium.Credit(t(source.attribution || entry.attribution)),
      },
      !useFallback && entry.fallback ? () => swapCatalogToFallback(id) : null,
    );
  }

  function swapCatalogToFallback(id) {
    const entry = surveyLayer(id);
    if (destroyed || !on.has(id) || !entry?.fallback) return;
    removeImagery(id);
    addCatalogImagery(id, entry, true);
    render();
  }

  function addCatalogImagery(id, entry, useFallback = false) {
    const layer = placeLayer(id, catalogProvider(id, entry, useFallback));
    layer.alpha = entry.alpha ?? 1;
    if (entry.brightness) layer.brightness = entry.brightness;
    return layer;
  }

  function addGrid() {
    const anchor = getAnchor();
    const metric = getUnits() === 'metric';
    removeImagery('ref-grid');
    placeLayer(
      'ref-grid',
      createGraticuleProvider({
        anchor,
        cellM: metric ? 1000 : 1609.344,
        cellUnit: metric ? 'km' : 'mi',
      }),
    );
    setStatus('ref-grid', { state: 'ready' });
  }

  function addWayback() {
    const release = WAYBACK_RELEASES[waybackIndex] || WAYBACK_RELEASES[0];
    const entry = surveyLayer('past-wayback');
    removeImagery('past-wayback');
    placeLayer(
      'past-wayback',
      countedProvider('past-wayback', {
        url: waybackTemplate(release.id),
        maximumLevel: 18,
        credit: new Cesium.Credit(`${t(entry.attribution)} ${release.date}`),
      }),
    );
    applyCompare();
  }

  // ---- relief -----------------------------------------------------------
  function setRelief(enable) {
    const scene = viewer.scene;
    if (!('verticalExaggeration' in scene)) return;
    if (enable) {
      if (savedExaggeration === null)
        savedExaggeration = scene.verticalExaggeration;
      scene.verticalExaggeration = surveyLayer('topo-relief').exaggeration;
      const real =
        viewer.terrainProvider &&
        !(viewer.terrainProvider instanceof Cesium.EllipsoidTerrainProvider);
      setStatus('topo-relief', { state: real ? 'ready' : 'no-terrain' });
    } else if (savedExaggeration !== null) {
      scene.verticalExaggeration = savedExaggeration;
      savedExaggeration = null;
    }
  }

  // ---- monitoring points -----------------------------------------------
  function viewBox() {
    const rect = viewer.camera.computeViewRectangle(
      viewer.scene.globe.ellipsoid,
    );
    if (!rect) return null;
    return {
      west: Cesium.Math.toDegrees(rect.west),
      south: Cesium.Math.toDegrees(rect.south),
      east: Cesium.Math.toDegrees(rect.east),
      north: Cesium.Math.toDegrees(rect.north),
    };
  }

  function clearPoints(id) {
    for (const entity of pointEntities.get(id) || [])
      points.entities.remove(entity);
    pointEntities.delete(id);
  }

  function drawPoints(id, sites, colorOf, kind) {
    clearPoints(id);
    const list = [];
    for (const site of sites) {
      const entity = points.entities.add({
        position: Cesium.Cartesian3.fromDegrees(site.lon, site.lat),
        point: {
          pixelSize: 12,
          color: Cesium.Color.fromCssColorString(colorOf(site)),
          outlineColor: Cesium.Color.fromCssColorString('#0b0f14'),
          outlineWidth: 2,
          heightReference: Cesium.HeightReference.CLAMP_TO_GROUND,
          disableDepthTestDistance: Number.POSITIVE_INFINITY,
        },
      });
      entity.gevSurveyInfo = { kind, site };
      list.push(entity);
    }
    pointEntities.set(id, list);
    render();
  }

  async function loadPoints(id) {
    if (!on.has(id)) return;
    const box = pointQueryBox(viewBox());
    if (!box) {
      setStatus(id, { state: 'zoom-in' });
      return;
    }
    const key = box.join(',');
    const previous = pointRequests.get(id);
    if (previous?.key === key) return;
    previous?.controller.abort();
    const controller = new AbortController();
    pointRequests.set(id, { key, controller });
    setStatus(id, { state: 'loading' });
    const { signal } = controller;
    try {
      if (id === 'mon-usgs-water') {
        const urls = usgsUrls(box);
        const [latest, names] = await Promise.all([
          fetchJson(urls.latest, { signal }),
          fetchJson(urls.names, { signal }).catch(() => ({ features: [] })),
        ]);
        if (signal.aborted || !on.has(id)) return;
        const sites = parseUsgsStations(latest, names);
        drawPoints(id, sites, () => surveyLayer(id).color, 'station');
        setStatus(id, { state: 'ready', count: sites.length });
      } else {
        const answers = await Promise.all(
          EPA_PROGRAMS.map((program) =>
            fetchJson(epaQueryUrl(program.layer, box), { signal }).then(
              (gj) => ({ program, features: gj?.features || [] }),
              () => ({ program, features: [], failed: true }),
            ),
          ),
        );
        if (signal.aborted || !on.has(id)) return;
        if (answers.every((a) => a.failed)) throw new Error('epa unavailable');
        const sites = parseEpaSites(answers);
        drawPoints(id, sites, (site) => site.color, 'epa');
        setStatus(id, { state: 'ready', count: sites.length });
      }
    } catch (error) {
      if (signal.aborted) return;
      pointRequests.delete(id);
      setStatus(id, { state: 'error' });
      console.warn(`[SiteSurvey] ${id} points failed:`, error);
    }
  }

  const onMoveEnd = () => {
    for (const id of ['mon-usgs-water', 'mon-epa-sites'])
      if (on.has(id)) void loadPoints(id);
  };
  viewer.camera.moveEnd.addEventListener(onMoveEnd);

  // ---- public ------------------------------------------------------------
  function set(id, enable) {
    if (destroyed) return;
    const want = Boolean(enable);
    if (want === on.has(id)) return;
    const overlay = SURVEY_OVERLAYS.find((o) => o.id === id);
    const entry = surveyLayer(id);
    if (!overlay && !entry) return;
    if (want) on.add(id);
    else on.delete(id);
    if (!want) {
      status.delete(id);
      tileStats.delete(id);
      if (entry?.kind === 'relief') setRelief(false);
      else if (entry?.kind === 'points') {
        pointRequests.get(id)?.controller.abort();
        pointRequests.delete(id);
        clearPoints(id);
      } else removeImagery(id);
      if (id === 'past-wayback') applyCompare();
      setStatus(id, { state: 'off' });
      render();
      return;
    }
    if (overlay) {
      const provider = overlayProvider(id, overlay, false);
      if (provider) placeLayer(id, provider).alpha = overlayAlpha;
    } else if (entry.kind === 'tiles') addCatalogImagery(id, entry);
    else if (entry.kind === 'grid') addGrid();
    else if (entry.kind === 'wayback') addWayback();
    else if (entry.kind === 'relief') setRelief(true);
    else if (entry.kind === 'points') void loadPoints(id);
    render();
  }

  return {
    set,
    isOn: (id) => on.has(id),
    activeIds: () => [...on],
    status: (id) => status.get(id) || { state: on.has(id) ? 'ready' : 'off' },
    /** Opacity of the public land overlays. */
    setOverlayAlpha(alpha) {
      overlayAlpha = Math.min(1, Math.max(0.1, alpha));
      for (const overlay of SURVEY_OVERLAYS) {
        const entry = imagery.get(overlay.id);
        if (entry) entry.layer.alpha = overlayAlpha;
      }
      render();
    },
    get waybackIndex() {
      return waybackIndex;
    },
    setWaybackRelease(index) {
      const next = Math.min(
        WAYBACK_RELEASES.length - 1,
        Math.max(0, Number(index) || 0),
      );
      if (next === waybackIndex && imagery.has('past-wayback')) return;
      waybackIndex = next;
      if (on.has('past-wayback')) addWayback();
      render();
    },
    /**
     * Past imagery on the left of `position` (0–1 across the view) and
     * today's imagery on the right, or the past release over everything.
     */
    setWaybackCompare(enable, position = 0.5) {
      compare = { on: Boolean(enable), position };
      applyCompare();
      render();
    },
    /** Redraw the grid after the site or the units change. */
    refreshGrid() {
      if (on.has('ref-grid')) addGrid();
      render();
    },
    /** Draw (or clear) the illustrative sample outline. */
    setOutline(vertices) {
      outline.entities.removeAll();
      if (vertices?.length >= 3) {
        const ring = [...vertices, vertices[0]].map((p) =>
          Cesium.Cartesian3.fromDegrees(p.lon, p.lat),
        );
        outline.entities.add({
          polygon: {
            hierarchy: new Cesium.PolygonHierarchy(ring.slice(0, -1)),
            material:
              Cesium.Color.fromCssColorString('#ffd166').withAlpha(0.12),
            classificationType: Cesium.ClassificationType.BOTH,
          },
        });
        outline.entities.add({
          polyline: {
            positions: ring,
            width: 3,
            clampToGround: true,
            material: Cesium.Color.fromCssColorString('#ffd166'),
          },
        });
      }
      render();
    },
    /** The click info an entity carries, or null. */
    infoOf(entity) {
      return entity?.gevSurveyInfo || null;
    },
    /** Turn every survey layer off (leaving survey mode). */
    clear() {
      for (const id of [...on]) set(id, false);
      outline.entities.removeAll();
    },
    whenSettled: () => attaching,
    destroy() {
      if (destroyed) return attaching;
      for (const id of [...on]) set(id, false);
      destroyed = true;
      viewer.camera.moveEnd.removeEventListener(onMoveEnd);
      for (const id of [...imagery.keys()]) removeImagery(id);
      attaching = attaching.then(() => {
        try {
          viewer.dataSources.remove(points, true);
          viewer.dataSources.remove(outline, true);
        } catch {
          /* viewer already disposed */
        }
      });
      return attaching;
    },
  };
}
