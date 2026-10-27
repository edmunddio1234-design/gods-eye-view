import test from 'node:test';
import assert from 'node:assert/strict';
import { createSurveyWmsHandler, surveyWmsProxy } from './surveyWms.js';

const PNG = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 1, 2, 3]);
const QUERY =
  '?SERVICE=WMS&VERSION=1.1.1&REQUEST=GetMap&LAYERS=28&STYLES=&SRS=EPSG:4326&BBOX=-91.25,32.35,-91.12,32.45&WIDTH=256&HEIGHT=256&FORMAT=image/png&TRANSPARENT=TRUE';

/** A response recorder shaped like node's ServerResponse. */
function recorder() {
  return {
    statusCode: 200,
    headers: {},
    body: null,
    destroyed: false,
    writeHead(status, headers = {}) {
      this.statusCode = status;
      Object.assign(this.headers, headers);
    },
    setHeader(name, value) {
      this.headers[name] = value;
    },
    end(body) {
      this.body = body ?? null;
    },
  };
}
const request = (url, headers = {}) => ({
  method: 'GET',
  url,
  headers: { host: 'localhost:4173', ...headers },
  socket: { remoteAddress: '127.0.0.1' },
});

test('a GetMap tile is fetched from the fixed upstream, returned and cached', async () => {
  const calls = [];
  const handler = createSurveyWmsHandler({
    fetchImpl: async (url, init) => {
      calls.push({ url, init });
      return new Response(PNG, { headers: { 'content-type': 'image/png' } });
    },
  });
  const first = recorder();
  await handler(request(`/fema-nfhl${QUERY}`), first);
  assert.equal(first.statusCode, 200);
  assert.equal(first.headers['Content-Type'], 'image/png');
  assert.deepEqual([...first.body], [...PNG]);
  assert.equal(calls.length, 1);
  assert.equal(new URL(calls[0].url).host, 'hazards.fema.gov');
  assert.equal(calls[0].init.redirect, 'error');
  const second = recorder();
  await handler(request(`/fema-nfhl${QUERY}`), second);
  assert.equal(second.statusCode, 200);
  assert.equal(calls.length, 1, 'served from cache');
});

test('anything but an image GetMap for a known service is refused without fetching', async () => {
  let fetched = 0;
  const handler = createSurveyWmsHandler({
    fetchImpl: async () => {
      fetched += 1;
      return new Response('x');
    },
  });
  const cases = [
    [`/example.com${QUERY}`, 404],
    [`/fema-nfhl/extra${QUERY}`, 404],
    [`/fema-nfhl${QUERY.replace('GetMap', 'GetCapabilities')}`, 400],
    [`/fema-nfhl${QUERY.replace('LAYERS=28', 'LAYERS=0')}`, 400],
  ];
  for (const [url, status] of cases) {
    const res = recorder();
    await handler(request(url), res);
    assert.equal(res.statusCode, status, url);
  }
  const post = recorder();
  await handler({ ...request(`/fema-nfhl${QUERY}`), method: 'POST' }, post);
  assert.equal(post.statusCode, 405);
  const crossSite = recorder();
  await handler(
    request(`/fema-nfhl${QUERY}`, {
      origin: 'https://evil.example',
      'sec-fetch-site': 'cross-site',
    }),
    crossSite,
  );
  assert.equal(crossSite.statusCode, 403);
  assert.equal(fetched, 0);
});

test('an upstream error or a non-image answer becomes a 502, never passed through', async () => {
  for (const response of [
    () =>
      new Response('<html>504</html>', {
        status: 504,
        headers: { 'content-type': 'text/html' },
      }),
    () =>
      new Response('<html>ok</html>', {
        status: 200,
        headers: { 'content-type': 'text/html' },
      }),
    () => {
      throw new Error('network down');
    },
  ]) {
    const handler = createSurveyWmsHandler({
      fetchImpl: async () => response(),
    });
    const res = recorder();
    await handler(request(`/fema-nfhl${QUERY}`), res);
    assert.equal(res.statusCode, 502);
    assert.match(String(res.body), /survey_wms_unavailable/);
    assert.ok(!String(res.body).includes('html'));
  }
});

test('the plugin mounts one route in dev and in preview', () => {
  const mounted = [];
  const plugin = surveyWmsProxy();
  const middlewares = { use: (route) => mounted.push(route) };
  plugin.configureServer({ middlewares });
  plugin.configurePreviewServer({ middlewares });
  assert.deepEqual(mounted, ['/api/survey-wms', '/api/survey-wms']);
  assert.equal(plugin.name, 'survey-wms');
});

test('the tile cache keeps to its byte budget on a small host', async () => {
  const big = new Uint8Array(3 * 1024 * 1024); // 3 MB tiles
  big[0] = 0x89;
  const handler = createSurveyWmsHandler({
    fetchImpl: async () =>
      new Response(big, { headers: { 'content-type': 'image/png' } }),
  });
  for (let i = 0; i < 40; i += 1) {
    const res = recorder();
    await handler(
      request(`/fema-nfhl${QUERY.replace('-91.25', String(-91.25 - i))}`),
      res,
    );
    assert.equal(res.statusCode, 200);
  }
  const stats = handler.cacheStats();
  assert.ok(stats.bytes <= 48 * 1024 * 1024, `${stats.bytes} bytes cached`);
  assert.ok(stats.entries <= 16 && stats.entries > 0);
});
