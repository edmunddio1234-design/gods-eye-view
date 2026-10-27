/**
 * Site Survey map grid: the Cesium half. An imagery provider that draws the
 * graticule (and, zoomed in, the site grid) into canvas tiles, so the lines
 * and their labels lie on the ground and follow the terrain like any map —
 * no Cesium labels (the app forbids them, src/noCesiumLabels.test.mjs).
 */
import * as Cesium from 'cesium';
import {
  SITE_GRID_MIN_LEVEL,
  degreeCellGrids,
  formatGraticuleLabel,
  graticuleStep,
  linesInRange,
  siteGridLines,
  siteGridSpacing,
} from './graticule.js';

const TILE = 512;
const FONT = '600 15px ui-monospace, "SF Mono", Menlo, Consolas, monospace';

/**
 * @param {object} [options]
 * @param {{lon:number, lat:number}|null} [options.anchor] site grid centre
 * @param {number} [options.cellM] site grid cell size in metres
 * @param {string} [options.cellUnit] 'mi' or 'km', for the labels
 */
export function createGraticuleProvider({
  anchor = null,
  cellM = 1609.344,
  cellUnit = 'mi',
} = {}) {
  const tilingScheme = new Cesium.GeographicTilingScheme();
  const errorEvent = new Cesium.Event();
  const spacing = anchor ? siteGridSpacing(anchor, cellM) : null;

  function label(context, text, x, y, align = 'left') {
    context.textAlign = align;
    context.lineWidth = 4;
    context.strokeStyle = 'rgba(0,0,0,0.75)';
    context.strokeText(text, x, y);
    context.fillText(text, x, y);
  }

  function requestImage(x, y, level) {
    if (typeof document === 'undefined') return undefined;
    const rect = tilingScheme.tileXYToRectangle(x, y, level);
    const west = Cesium.Math.toDegrees(rect.west);
    const east = Cesium.Math.toDegrees(rect.east);
    const south = Cesium.Math.toDegrees(rect.south);
    const north = Cesium.Math.toDegrees(rect.north);
    const px = (lon) => ((lon - west) / (east - west)) * TILE;
    const py = (lat) => ((north - lat) / (north - south)) * TILE;
    const canvas = document.createElement('canvas');
    canvas.width = TILE;
    canvas.height = TILE;
    const context = canvas.getContext('2d');
    context.font = FONT;
    context.textBaseline = 'middle';

    // Graticule.
    const step = graticuleStep(east - west, 1);
    context.strokeStyle = 'rgba(255,255,255,0.5)';
    context.lineWidth = 1.5;
    const lats = linesInRange(south, north, step).filter(
      (lat) => lat > -90 && lat < 90,
    );
    const lons = linesInRange(west, east, step);
    context.beginPath();
    for (const lat of lats) {
      context.moveTo(0, py(lat));
      context.lineTo(TILE, py(lat));
    }
    for (const lon of lons) {
      context.moveTo(px(lon), 0);
      context.lineTo(px(lon), TILE);
    }
    context.stroke();
    context.fillStyle = '#ffffff';
    // Labels stay inside their tile: a label cut by the tile edge would
    // lose its other half (the neighbour tile does not draw it).
    for (const lat of lats) {
      const y = py(lat) < 18 ? py(lat) + 11 : py(lat) - 11;
      label(context, formatGraticuleLabel(lat, true), 8, y);
    }
    for (const lon of lons) {
      const text = formatGraticuleLabel(lon, false);
      const x = px(lon);
      const fits = x + 6 + context.measureText(text).width < TILE - 2;
      label(
        context,
        text,
        fits ? x + 6 : x - 6,
        TILE - 14,
        fits ? 'left' : 'right',
      );
    }

    // Site grid, zoomed in: centred on the site when there is one,
    // otherwise restarting at each whole degree.
    if (level >= SITE_GRID_MIN_LEVEL) {
      const box = { west, south, east, north };
      const grids = spacing
        ? [{ spacing, clip: null, labelled: true }]
        : degreeCellGrids(box, cellM).map((g) => ({ ...g, labelled: false }));
      for (const grid of grids) {
        const lines = siteGridLines(box, grid.spacing, grid.clip ? 80 : 12);
        const ext = grid.clip || lines.extent;
        const inside = (v, lo, hi) => v >= lo - 1e-12 && v <= hi + 1e-12;
        const lons = lines.lons.filter(({ value }) =>
          inside(value, ext.west, ext.east),
        );
        const lats = lines.lats.filter(({ value }) =>
          inside(value, ext.south, ext.north),
        );
        const top = py(Math.min(north, ext.north));
        const bottom = py(Math.max(south, ext.south));
        const left = px(Math.max(west, ext.west));
        const right = px(Math.min(east, ext.east));
        context.strokeStyle = 'rgba(255,207,90,0.8)';
        context.lineWidth = 1.25;
        context.beginPath();
        for (const { value } of lons) {
          context.moveTo(px(value), top);
          context.lineTo(px(value), bottom);
        }
        for (const { value } of lats) {
          context.moveTo(left, py(value));
          context.lineTo(right, py(value));
        }
        context.stroke();
        if (!grid.labelled) continue;
        context.fillStyle = '#ffcf5a';
        for (const { k, value } of lons) {
          if (k === 0) continue;
          label(
            context,
            `${Math.abs(k)} ${cellUnit} ${k > 0 ? 'E' : 'W'}`,
            px(value) + 5,
            Math.max(top, 0) + 16,
          );
        }
        for (const { k, value } of lats) {
          if (k === 0) continue;
          label(
            context,
            `${Math.abs(k)} ${cellUnit} ${k > 0 ? 'N' : 'S'}`,
            Math.min(right, TILE) - 6,
            py(value) - 11,
            'right',
          );
        }
      }
    }
    return Promise.resolve(canvas);
  }

  const provider = {
    tileWidth: TILE,
    tileHeight: TILE,
    maximumLevel: 20,
    minimumLevel: 0,
    tilingScheme,
    rectangle: tilingScheme.rectangle,
    tileDiscardPolicy: undefined,
    errorEvent,
    credit: undefined,
    proxy: undefined,
    hasAlphaChannel: true,
    getTileCredits: () => undefined,
    requestImage,
    pickFeatures: () => undefined,
  };
  return provider;
}
