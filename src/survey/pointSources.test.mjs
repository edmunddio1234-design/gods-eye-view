// Pure tests for the USGS station and EPA site sources. Run with: npm test.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  EPA_PROGRAMS,
  epaFacilityPage,
  epaQueryUrl,
  formatReading,
  parseEpaSites,
  parseUsgsStations,
  pointQueryBox,
  usgsStationPage,
  usgsUrls,
} from './pointSources.js';

test('points load only for views under four degrees, padded and rounded', () => {
  assert.deepEqual(
    pointQueryBox({ west: -91.4, south: 32.3, east: -91.0, north: 32.6 }),
    [-91.44, 32.27, -90.96, 32.63],
  );
  assert.equal(
    pointQueryBox({ west: -100, south: 30, east: -90, north: 35 }),
    null,
  );
  assert.equal(pointQueryBox(null), null);
});

test('USGS requests go to the OGC API with the box', () => {
  const urls = usgsUrls([-91.5, 32.2, -91, 32.6]);
  assert.equal(
    urls.latest,
    'https://api.waterdata.usgs.gov/ogcapi/v0/collections/latest-continuous/items?bbox=-91.5,32.2,-91,32.6&f=json&limit=1000',
  );
  assert.match(
    urls.names,
    /monitoring-locations\/items\?bbox=-91.5,32.2,-91,32.6&/,
  );
  assert.equal(
    usgsStationPage('USGS-07369515'),
    'https://waterdata.usgs.gov/monitoring-location/07369515/',
  );
  assert.equal(usgsStationPage('<script>'), null);
});

const feature = (id, code, value, time, lon = -91.33, lat = 32.39) => ({
  type: 'Feature',
  geometry: { type: 'Point', coordinates: [lon, lat] },
  properties: {
    monitoring_location_id: id,
    parameter_code: code,
    value,
    unit_of_measure: code === '00065' ? 'ft' : 'deg C',
    time,
    approval_status: 'Provisional',
  },
});

test('stations keep the latest value per parameter, named and ordered', () => {
  const latest = {
    features: [
      feature('USGS-07369515', '00065', '3.79', '2026-10-27T18:30:00+00:00'),
      feature('USGS-07369515', '00010', '21.4', '2026-10-27T18:30:00+00:00'),
      feature('USGS-07369515', '00065', '3.10', '2026-10-26T18:30:00+00:00'),
      feature(
        'USGS-1',
        '00010',
        null,
        '2026-10-27T18:30:00+00:00',
        -91.2,
        32.4,
      ),
      { properties: { monitoring_location_id: 'bad' } },
    ],
  };
  const names = {
    features: [
      {
        id: 'USGS-07369515',
        properties: { monitoring_location_name: 'Tensas River at Tendal, LA' },
      },
    ],
  };
  const sites = parseUsgsStations(latest, names);
  assert.equal(sites.length, 2);
  const [tensas, other] = sites;
  assert.equal(tensas.name, 'Tensas River at Tendal, LA');
  assert.deepEqual(
    tensas.readings.map((r) => [r.code, r.value]),
    [
      ['00010', 21.4],
      ['00065', 3.79],
    ],
  );
  assert.equal(other.name, 'USGS-1');
  assert.equal(other.readings.length, 0);
  assert.deepEqual(parseUsgsStations(null, null), []);
});

test('readings show °F beside °C and convert flow and stage to metric', () => {
  assert.equal(
    formatReading({ value: 21.4, unit: 'deg C' }, 'us'),
    '21.4 °C (70.52 °F)',
  );
  assert.equal(
    formatReading({ value: 1000, unit: 'ft^3/s' }, 'metric'),
    '28.32 m³/s',
  );
  assert.equal(formatReading({ value: 10, unit: 'ft' }, 'metric'), '3.05 m');
  assert.equal(formatReading({ value: 7.6, unit: '' }, 'us'), '7.6');
  assert.equal(formatReading({ value: 250, unit: 'uS/cm' }, 'us'), '250 µS/cm');
});

test('EPA queries ask the EMEF point layers, and sites merge across programs', () => {
  assert.deepEqual(
    EPA_PROGRAMS.map((p) => p.layer),
    [0, 4, 5],
  );
  const url = new URL(epaQueryUrl(4, [-91.5, 32.2, -91, 32.6]));
  assert.equal(url.host, 'geopub.epa.gov');
  assert.equal(
    url.pathname,
    '/arcgis/rest/services/EMEF/efpoints/MapServer/4/query',
  );
  assert.equal(url.searchParams.get('geometry'), '-91.5,32.2,-91,32.6');
  assert.equal(url.searchParams.get('f'), 'geojson');
  const site = (program, sys) => ({
    geometry: { coordinates: [-91.19, 32.41] },
    properties: {
      registry_id: '110000123456',
      primary_name: 'Sample Facility',
      city_name: 'Tallulah',
      state_code: 'LA',
      pgm_sys_acrnm: sys,
      pgm_sys_id: `${sys}123`,
      facility_url: 'http://example.gov/record',
    },
  });
  const sites = parseEpaSites([
    { program: EPA_PROGRAMS[2], features: [site(5, 'ACRES')] },
    {
      program: EPA_PROGRAMS[0],
      features: [site(0, 'SEMS'), { geometry: null }],
    },
  ]);
  assert.equal(sites.length, 1);
  assert.equal(sites[0].address, 'Tallulah, LA');
  assert.deepEqual(
    sites[0].programs.map((p) => p.name),
    ['Brownfields', 'Superfund'],
  );
  assert.equal(sites[0].color, EPA_PROGRAMS[0].color, 'Superfund colour wins');
  assert.equal(sites[0].programs[0].url, 'https://example.gov/record');
  assert.equal(
    epaFacilityPage('110000123456'),
    'https://frs-public.epa.gov/ords/frs_public2/fii_query_dtl.disp_program_facility?p_registry_id=110000123456',
  );
  assert.equal(epaFacilityPage('x1'), null);
});
