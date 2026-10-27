/**
 * Site Survey on the globe: the boundary, the profile line, the flight plan
 * and the public land overlays, each owned here and removed by `destroy()`.
 *
 * Shapes lie on the surface (ground polylines and a classified polygon), so
 * they follow terrain on the globe and the photoreal mesh alike. There are no
 * Cesium text labels — the app forbids them (src/noCesiumLabels.test.mjs);
 * the panel's legend names what each colour is.
 */
import * as Cesium from 'cesium';
import { t } from '../i18n/index.js';
import { SURVEY_OVERLAYS, overlayWmsSettings } from './overlays.js';

const DATA_SOURCE_NAME = 'gev-site-survey';
export const SURVEY_COLORS = Object.freeze({
  boundary: '#00d4ff',
  draft: '#8be9ff',
  profile: '#ff4fd8',
  flight: '#ffb547',
  start: '#5dff9f',
  end: '#ff6b6b',
});

const color = (css, alpha = 1) =>
  Cesium.Color.fromCssColorString(css).withAlpha(alpha);
const positions = (points) =>
  points.map((p) => Cesium.Cartesian3.fromDegrees(p.lon, p.lat, p.height || 0));

/**
 * @param {Cesium.Viewer} viewer
 */
export function createSurveyScene(viewer) {
  const dataSource = new Cesium.CustomDataSource(DATA_SOURCE_NAME);
  let attaching = Promise.resolve(viewer.dataSources.add(dataSource)).catch(
    () => null,
  );
  const entities = dataSource.entities;
  const groups = {
    boundary: [],
    handles: [],
    draft: [],
    profile: [],
    plan: [],
  };
  const handleIndex = new Map();
  const overlayLayers = new Map();
  let overlayAlpha = 0.6;
  let destroyed = false;

  const clearGroup = (name) => {
    for (const entity of groups[name]) entities.remove(entity);
    groups[name].length = 0;
    if (name === 'handles') handleIndex.clear();
  };
  const add = (group, options) => {
    const entity = entities.add(options);
    groups[group].push(entity);
    return entity;
  };
  const render = () => viewer.scene.requestRender();

  const groundLine = (points, css, width, dashed = false) => ({
    polyline: {
      positions: positions(points),
      width,
      clampToGround: true,
      classificationType: Cesium.ClassificationType.BOTH,
      material: dashed
        ? new Cesium.PolylineDashMaterialProperty({
            color: color(css, 0.95),
            dashLength: 14,
          })
        : color(css, 0.95),
    },
  });
  const point = (p, css, size) => ({
    position: Cesium.Cartesian3.fromDegrees(p.lon, p.lat),
    point: {
      pixelSize: size,
      color: color(css),
      outlineColor: Cesium.Color.BLACK.withAlpha(0.7),
      outlineWidth: 2,
      heightReference: Cesium.HeightReference.CLAMP_TO_GROUND,
      disableDepthTestDistance: Number.POSITIVE_INFINITY,
    },
  });

  return {
    /** Draw (or clear, with an empty list) the finished boundary. */
    setBoundary(vertices, { editing = false } = {}) {
      if (destroyed) return;
      clearGroup('boundary');
      clearGroup('handles');
      if (vertices?.length >= 3) {
        add('boundary', {
          polygon: {
            hierarchy: new Cesium.PolygonHierarchy(positions(vertices)),
            material: color(SURVEY_COLORS.boundary, 0.16),
            classificationType: Cesium.ClassificationType.BOTH,
          },
        });
        add(
          'boundary',
          groundLine([...vertices, vertices[0]], SURVEY_COLORS.boundary, 3),
        );
        vertices.forEach((v, index) => {
          const entity = add(
            'handles',
            point(
              v,
              editing ? '#ffffff' : SURVEY_COLORS.boundary,
              editing ? 13 : 7,
            ),
          );
          handleIndex.set(entity, index);
        });
      }
      render();
    },
    /** The boundary vertex a picked handle stands for, or null. */
    handleIndexOf(entity) {
      return handleIndex.has(entity) ? handleIndex.get(entity) : null;
    },
    /** The dashed rubber band of a shape being drawn. */
    setDraft({ mode, vertices, cursor }) {
      if (destroyed) return;
      clearGroup('draft');
      if (mode === 'boundary' || mode === 'profile') {
        const css =
          mode === 'boundary' ? SURVEY_COLORS.draft : SURVEY_COLORS.profile;
        const pts = [...vertices];
        if (cursor) pts.push(cursor);
        if (mode === 'boundary' && pts.length >= 3) pts.push(pts[0]);
        if (pts.length >= 2) add('draft', groundLine(pts, css, 3, true));
        for (const v of vertices) add('draft', point(v, css, 8));
      }
      render();
    },
    setProfile(vertices) {
      if (destroyed) return;
      clearGroup('profile');
      if (vertices?.length >= 2) {
        add('profile', groundLine(vertices, SURVEY_COLORS.profile, 3));
        add('profile', point(vertices[0], SURVEY_COLORS.profile, 8));
        add(
          'profile',
          point(vertices[vertices.length - 1], SURVEY_COLORS.profile, 8),
        );
      }
      render();
    },
    /** Draw the lawnmower path with its start and end, or clear it. */
    setPlan(plan) {
      if (destroyed) return;
      clearGroup('plan');
      if (plan?.path?.length >= 2) {
        add('plan', groundLine(plan.path, SURVEY_COLORS.flight, 2));
        add('plan', point(plan.start, SURVEY_COLORS.start, 12));
        add('plan', point(plan.end, SURVEY_COLORS.end, 12));
      }
      render();
    },
    /** Turn a public overlay on or off. */
    setOverlay(id, on) {
      if (destroyed) return;
      const existing = overlayLayers.get(id);
      if (!on) {
        if (existing) {
          viewer.imageryLayers.remove(existing, true);
          overlayLayers.delete(id);
          render();
        }
        return;
      }
      if (existing) return;
      const settings = overlayWmsSettings(id);
      const overlay = SURVEY_OVERLAYS.find((o) => o.id === id);
      if (!settings || !overlay) return;
      const provider = new Cesium.WebMapServiceImageryProvider({
        url: settings.url,
        layers: settings.layers,
        parameters: { transparent: true, format: 'image/png', styles: '' },
        enablePickFeatures: false,
        credit: new Cesium.Credit(t(overlay.attribution)),
      });
      const layer = viewer.imageryLayers.addImageryProvider(provider);
      layer.alpha = overlayAlpha;
      overlayLayers.set(id, layer);
      render();
    },
    isOverlayOn(id) {
      return overlayLayers.has(id);
    },
    setOverlayAlpha(alpha) {
      overlayAlpha = Math.min(1, Math.max(0.1, alpha));
      for (const layer of overlayLayers.values()) layer.alpha = overlayAlpha;
      render();
    },
    /** Fly to frame the boundary from above. */
    flyToBoundary(vertices) {
      if (!(vertices?.length >= 3)) return;
      const sphere = Cesium.BoundingSphere.fromPoints(positions(vertices));
      viewer.camera.flyToBoundingSphere(sphere, {
        duration: 1.2,
        offset: new Cesium.HeadingPitchRange(
          0,
          Cesium.Math.toRadians(-70),
          Math.max(400, sphere.radius * 3.2),
        ),
      });
    },
    /**
     * The current view as a JPEG data URL, or null when the canvas cannot be
     * read (a tile without CORS headers would have tainted it).
     */
    snapshot() {
      try {
        viewer.render();
        return viewer.scene.canvas.toDataURL('image/jpeg', 0.85);
      } catch {
        return null;
      }
    },
    whenSettled: () => attaching,
    destroy() {
      if (destroyed) return attaching;
      destroyed = true;
      for (const layer of overlayLayers.values()) {
        try {
          viewer.imageryLayers.remove(layer, true);
        } catch {
          /* viewer already disposed */
        }
      }
      overlayLayers.clear();
      entities.removeAll();
      attaching = attaching.then(() => {
        try {
          viewer.dataSources.remove(dataSource, true);
        } catch {
          /* viewer already disposed */
        }
      });
      return attaching;
    },
  };
}
