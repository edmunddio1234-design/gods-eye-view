/**
 * Site Survey exports: the boundary and a flight plan as KML and GeoJSON.
 *
 * KML is what DJI Pilot 2 (Mapping / Area route import) and Google Earth
 * read: the boundary as a Polygon, the flight path as a LineString at the
 * plan's height above ground, and each pass end as a numbered waypoint.
 * GeoJSON carries the same features plus the plan numbers as properties, for
 * a GIS. Coordinates are WGS-84 longitude, latitude (and height in metres
 * where KML wants one), six decimals: about 0.1 m.
 *
 * No Cesium, no DOM.
 */
import { openRing, wrapLon } from './geodesy.js';

const round6 = (value) => Math.round(value * 1e6) / 1e6;
const pair = (p) => [round6(wrapLon(p.lon)), round6(p.lat)];

/** Text safe inside an XML element or attribute. */
export function escapeXml(value) {
  return String(value ?? '').replace(
    /[<>&'"]/g,
    (c) =>
      ({
        '<': '&lt;',
        '>': '&gt;',
        '&': '&amp;',
        "'": '&apos;',
        '"': '&quot;',
      })[c],
  );
}

/** The boundary as a closed GeoJSON ring, counter-clockwise (RFC 7946). */
export function boundaryRingCoordinates(boundary) {
  const ring = openRing(boundary).map(pair);
  if (ring.length < 3) return [];
  // Shoelace on lon/lat is enough to tell the winding.
  let twice = 0;
  for (let i = 0; i < ring.length; i += 1) {
    const [x1, y1] = ring[i];
    const [x2, y2] = ring[(i + 1) % ring.length];
    twice += x1 * y2 - x2 * y1;
  }
  if (twice < 0) ring.reverse();
  return [...ring, ring[0]];
}

/** Plan figures worth carrying into a file, SI units. */
function planProperties(plan) {
  if (!plan) return {};
  return {
    camera_sensor_mm: [plan.camera.sensorWidthMm, plan.camera.sensorHeightMm],
    camera_focal_mm: plan.camera.focalLengthMm,
    camera_image_px: [plan.camera.imageWidthPx, plan.camera.imageHeightPx],
    altitude_agl_m: round6(plan.altitudeM),
    speed_mps: round6(plan.speedMps),
    front_overlap: plan.frontOverlap,
    side_overlap: plan.sideOverlap,
    flight_line_bearing_deg: round6(plan.bearingDeg),
    gsd_cm_per_px: round6(plan.gsdM * 100),
    footprint_m: [
      round6(plan.footprint.acrossM),
      round6(plan.footprint.alongM),
    ],
    line_spacing_m: round6(plan.lineSpacingM),
    photo_spacing_m: round6(plan.photoSpacingM),
    flight_lines: plan.lineCount,
    passes: plan.passCount,
    photos: plan.photoCount,
    total_distance_m: round6(plan.totalDistanceM),
    flight_time_s: Math.round(plan.flightTimeS),
    batteries: plan.batteries,
  };
}

/**
 * A GeoJSON FeatureCollection: boundary, flight path and waypoints.
 * @param {{siteName?:string, boundary:Array, plan?:object, droneName?:string}} input
 * @returns {object}
 */
export function surveyGeoJson({ siteName = '', boundary, plan, droneName }) {
  const features = [];
  const ring = boundaryRingCoordinates(boundary);
  if (ring.length)
    features.push({
      type: 'Feature',
      properties: { role: 'boundary', name: siteName || 'Site boundary' }, // i18n-ignore: file data
      geometry: { type: 'Polygon', coordinates: [ring] },
    });
  if (plan?.path?.length >= 2) {
    features.push({
      type: 'Feature',
      properties: {
        role: 'flight-path',
        name: 'Flight plan', // i18n-ignore: file data
        drone: droneName || null,
        ...planProperties(plan),
      },
      geometry: { type: 'LineString', coordinates: plan.path.map(pair) },
    });
    plan.path.forEach((point, index) => {
      features.push({
        type: 'Feature',
        properties: {
          role: 'waypoint',
          index: index + 1,
          kind:
            index === 0
              ? 'start'
              : index === plan.path.length - 1
                ? 'end'
                : 'turn',
          altitude_agl_m: round6(plan.altitudeM),
        },
        geometry: { type: 'Point', coordinates: pair(point) },
      });
    });
  }
  return {
    type: 'FeatureCollection',
    name: siteName || 'Site survey',
    features,
  }; // i18n-ignore: file data
}

/**
 * A KML document: boundary polygon, flight path and waypoints.
 * @param {{siteName?:string, boundary:Array, plan?:object, droneName?:string}} input
 * @returns {string}
 */
export function surveyKml({ siteName = '', boundary, plan, droneName }) {
  const name = escapeXml(siteName || 'Site survey'); // i18n-ignore: file data
  const ring = boundaryRingCoordinates(boundary);
  const parts = [];
  parts.push('<?xml version="1.0" encoding="UTF-8"?>');
  parts.push('<kml xmlns="http://www.opengis.net/kml/2.2">');
  parts.push('<Document>');
  parts.push(`<name>${name}</name>`);
  parts.push(
    '<Style id="boundary"><LineStyle><color>ff00d4ff</color><width>3</width></LineStyle><PolyStyle><color>3300d4ff</color></PolyStyle></Style>',
  );
  parts.push(
    '<Style id="flight"><LineStyle><color>ff47b5ff</color><width>2</width></LineStyle></Style>',
  );
  if (ring.length) {
    parts.push('<Placemark>');
    parts.push(`<name>${name} boundary</name>`);
    parts.push('<styleUrl>#boundary</styleUrl>');
    parts.push(
      '<Polygon><tessellate>1</tessellate><altitudeMode>clampToGround</altitudeMode><outerBoundaryIs><LinearRing><coordinates>',
    );
    parts.push(ring.map(([lon, lat]) => `${lon},${lat},0`).join(' '));
    parts.push('</coordinates></LinearRing></outerBoundaryIs></Polygon>');
    parts.push('</Placemark>');
  }
  if (plan?.path?.length >= 2) {
    const height = round6(plan.altitudeM);
    const description = escapeXml(
      [
        droneName ? `Drone: ${droneName}` : null,
        `Altitude AGL: ${Math.round(plan.altitudeM)} m`,
        `GSD: ${(plan.gsdM * 100).toFixed(2)} cm/px`,
        `Front/side overlap: ${Math.round(plan.frontOverlap * 100)}% / ${Math.round(plan.sideOverlap * 100)}%`,
        `Lines: ${plan.lineCount}, photos: ${plan.photoCount}`,
      ]
        .filter(Boolean)
        .join('\n'),
    );
    parts.push('<Placemark>');
    parts.push('<name>Flight plan</name>');
    parts.push(`<description>${description}</description>`);
    parts.push('<styleUrl>#flight</styleUrl>');
    parts.push(
      '<LineString><altitudeMode>relativeToGround</altitudeMode><coordinates>',
    );
    parts.push(
      plan.path
        .map((p) => {
          const [lon, lat] = pair(p);
          return `${lon},${lat},${height}`;
        })
        .join(' '),
    );
    parts.push('</coordinates></LineString>');
    parts.push('</Placemark>');
    parts.push('<Folder><name>Waypoints</name>');
    plan.path.forEach((p, index) => {
      const [lon, lat] = pair(p);
      parts.push(
        `<Placemark><name>WP${index + 1}</name><Point><altitudeMode>relativeToGround</altitudeMode><coordinates>${lon},${lat},${height}</coordinates></Point></Placemark>`,
      );
    });
    parts.push('</Folder>');
  }
  parts.push('</Document>');
  parts.push('</kml>');
  return `${parts.join('\n')}\n`;
}

/** A file-name stem from a site name: "Tallulah Tract 4" → "tallulah-tract-4". */
export function fileStem(siteName) {
  const stem = String(siteName || '')
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[^\w\s-]/g, '')
    .trim()
    .replace(/[\s_-]+/g, '-')
    .slice(0, 60);
  return stem || 'site-survey';
}
