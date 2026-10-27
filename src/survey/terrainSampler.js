/**
 * Site Survey terrain heights: the Cesium half.
 *
 * Heights come from Cesium's `sampleTerrainMostDetailed` against a real
 * terrain provider: the globe's own when it has one (Cesium World Terrain with
 * an ion token, otherwise the keyless Re:Earth terrain the app already
 * uses), or — when the scene is on Google 3D and its globe carries only the
 * flat ellipsoid — a keyless Re:Earth provider created for sampling alone.
 * When no real terrain can be had the answer is `unavailable`, never a
 * height of zero.
 */
import * as Cesium from 'cesium';
import { createKeylessTerrain } from '../maps/terrain.js';
import { ensureGeoidReady, geoidHeight } from '../data/geoid.js';

const CHUNK = 256;
let keylessTerrain = null;

function isRealTerrain(provider) {
  return (
    Boolean(provider) && !(provider instanceof Cesium.EllipsoidTerrainProvider)
  );
}

async function samplingProvider(viewer) {
  const own = viewer?.terrainProvider;
  if (isRealTerrain(own)) return { provider: own, source: 'globe' };
  keylessTerrain ||= createKeylessTerrain().catch(() => ({ fallback: true }));
  const keyless = await keylessTerrain;
  if (keyless?.fallback || !isRealTerrain(keyless?.provider)) {
    keylessTerrain = null; // try again next time
    return null;
  }
  return { provider: keyless.provider, source: 'keyless' };
}

/**
 * Heights (metres) for `points`, in order: above mean sea level (EGM96) when
 * the geoid grid loads (`datum: 'egm96'`), ellipsoidal otherwise. A point
 * whose tile could not be read is NaN.
 * @param {Cesium.Viewer} viewer
 * @param {Array<{lon:number, lat:number}>} points
 * @param {{signal?: AbortSignal}} [options]
 * @returns {Promise<{status:'ok', heights:number[], source:string} | {status:'unavailable'}>}
 */
export async function sampleTerrainHeights(viewer, points, { signal } = {}) {
  const chosen = await samplingProvider(viewer);
  signal?.throwIfAborted();
  if (!chosen) return { status: 'unavailable' };
  const heights = [];
  for (let start = 0; start < points.length; start += CHUNK) {
    const batch = points
      .slice(start, start + CHUNK)
      .map((p) => Cesium.Cartographic.fromDegrees(p.lon, p.lat));
    let sampled = batch;
    try {
      sampled = await Cesium.sampleTerrainMostDetailed(chosen.provider, batch);
    } catch {
      sampled = batch.map(() => ({ height: NaN }));
    }
    signal?.throwIfAborted();
    for (const c of sampled)
      heights.push(Number.isFinite(c?.height) ? c.height : NaN);
  }
  if (!heights.some(Number.isFinite)) return { status: 'unavailable' };
  // Terrain tiles give ellipsoidal heights; land is described above sea
  // level, so subtract the EGM96 geoid (about 27 m in Louisiana).
  let datum = 'ellipsoid';
  try {
    await ensureGeoidReady();
    signal?.throwIfAborted();
    for (let index = 0; index < heights.length; index += 1) {
      if (!Number.isFinite(heights[index])) continue;
      heights[index] -= geoidHeight(points[index].lat, points[index].lon);
    }
    datum = 'egm96';
  } catch (error) {
    if (signal?.aborted) throw error;
  }
  return { status: 'ok', heights, source: chosen.source, datum };
}
