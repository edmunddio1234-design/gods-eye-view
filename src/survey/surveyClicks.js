/**
 * Site Survey map clicks: the Cesium half. A left click while nothing else
 * holds the pointer (src/data/inputOwnership.js) either hits a survey point
 * (a USGS station or an EPA site) or a spot on the ground; the panel decides
 * what to show for each. Drawing and editing hold the pointer, so their
 * clicks never reach here.
 */
import * as Cesium from 'cesium';
import { isPointerFree } from '../data/inputOwnership.js';

/**
 * @param {object} deps
 * @param {Cesium.Viewer} deps.viewer
 * @param {(entity:object) => object|null} deps.infoOf survey info on a picked entity
 * @param {(info:object) => void} deps.onPoint
 * @param {(point:{lon:number, lat:number}) => void} deps.onGround
 * @param {() => boolean} deps.isActive survey mode on
 */
export function createSurveyClickHandler({
  viewer,
  infoOf,
  onPoint,
  onGround,
  isActive,
}) {
  const handler = new Cesium.ScreenSpaceEventHandler(viewer.scene.canvas);
  handler.setInputAction((event) => {
    if (!isActive() || !isPointerFree()) return;
    const position = event.position;
    let picked;
    try {
      picked = viewer.scene.pick(position);
    } catch {
      picked = null;
    }
    const info = infoOf(picked?.id);
    if (info) {
      onPoint(info);
      return;
    }
    const ray = viewer.camera.getPickRay(position);
    const cartesian =
      (ray && viewer.scene.globe.pick(ray, viewer.scene)) ||
      viewer.camera.pickEllipsoid(position, viewer.scene.globe.ellipsoid);
    if (!cartesian) return;
    const carto = Cesium.Cartographic.fromCartesian(cartesian);
    onGround({
      lon: Cesium.Math.toDegrees(carto.longitude),
      lat: Cesium.Math.toDegrees(carto.latitude),
    });
  }, Cesium.ScreenSpaceEventType.LEFT_CLICK);
  return {
    destroy() {
      if (!handler.isDestroyed()) handler.destroy();
    },
  };
}
