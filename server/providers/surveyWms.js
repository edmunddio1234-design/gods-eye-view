import {
  SURVEY_WMS_ROUTE,
  surveyWmsUpstreamUrl,
} from '../../src/survey/wmsServices.js';
import { readResponseBytesCapped } from './common/http.js';
import { makeRateLimiter, clientKey } from './common/rate-limit.js';
import { admitSameSiteKeyless } from './common/same-site.js';

// Site Survey map tiles from public federal WMS services (FEMA NFHL and the
// other services in src/survey/wmsServices.js), for the ones the browser
// cannot request directly. Keyless and public domain. The upstream is chosen
// by service id from that fixed table and only GetMap for the service's own
// layer is forwarded, rebuilt from validated values; this is not a general
// proxy. Responses must be images; tiles are cached briefly in memory.

const TIMEOUT_MS = 20_000;
const MAX_TILE_BYTES = 4 * 1024 * 1024;
const CACHE_MS = 6 * 3600_000;
const CACHE_MAX = 512;
// A byte budget as well as an entry count, so the cache stays small on a
// 512 MB host whatever size the tiles are.
const CACHE_MAX_BYTES = 48 * 1024 * 1024;
const USER_AGENT = 'gods-eye-view-site-survey/1.0';

/**
 * The request handler behind `/api/survey-wms/<id>`; the route strips the
 * prefix, so `req.url` starts at `/<id>`.
 * @param {{fetchImpl?: Function, now?: Function}} [options]
 */
export function createSurveyWmsHandler(options = {}) {
  const {
    fetchImpl = (...args) => globalThis.fetch(...args),
    now = () => Date.now(),
  } = options;
  // A map view asks for a few dozen tiles at once; panning asks for more.
  const allow = makeRateLimiter({
    windowMs: 60_000,
    max: 600,
    globalMax: 2400,
  });
  const cache = new Map();
  let cacheBytes = 0;
  const evict = (key) => {
    const entry = cache.get(key);
    if (!entry) return;
    cacheBytes -= entry.bytes.length;
    cache.delete(key);
  };

  async function handler(req, res) {
    const fail = (status, error) => {
      if (res.destroyed) return;
      res.writeHead(status, {
        'Content-Type': 'application/json',
        'Cache-Control': 'no-store',
        ...(status === 405 ? { Allow: 'GET' } : {}),
      });
      res.end(JSON.stringify({ error }));
    };
    if (req.method !== 'GET') return fail(405, 'method_not_allowed');
    if (admitSameSiteKeyless(req, res)) return undefined;
    const [rawPath, rawQuery = ''] = String(req.url || '/').split('?');
    const id = rawPath.replace(/^\/+|\/+$/g, '');
    if (!id || id.includes('/')) return fail(404, 'unknown_service');
    const target = surveyWmsUpstreamUrl(id, new URLSearchParams(rawQuery));
    if (target.error) return fail(target.status, target.error);
    const cached = cache.get(target.url);
    if (cached && now() - cached.at < CACHE_MS) {
      res.writeHead(200, {
        'Content-Type': cached.type,
        'Cache-Control': 'public, max-age=3600',
      });
      return res.end(cached.bytes);
    }
    if (!allow(clientKey(req))) return fail(429, 'rate_limited');
    try {
      const signal = AbortSignal.timeout(TIMEOUT_MS);
      const upstream = await fetchImpl(target.url, {
        signal,
        redirect: 'error',
        headers: { Accept: 'image/png,image/*', 'User-Agent': USER_AGENT },
      });
      const type = String(upstream.headers.get('content-type') || '')
        .split(';')[0]
        .trim()
        .toLowerCase();
      if (!upstream.ok || !type.startsWith('image/')) {
        await upstream.body?.cancel().catch(() => {});
        return fail(502, 'survey_wms_unavailable');
      }
      const bytes = Buffer.from(
        await readResponseBytesCapped(upstream, MAX_TILE_BYTES, signal),
      );
      evict(target.url);
      cache.set(target.url, { at: now(), type, bytes });
      cacheBytes += bytes.length;
      while (cache.size > CACHE_MAX || cacheBytes > CACHE_MAX_BYTES)
        evict(cache.keys().next().value);
      if (res.destroyed) return undefined;
      res.writeHead(200, {
        'Content-Type': type,
        'Cache-Control': 'public, max-age=3600',
      });
      return res.end(bytes);
    } catch {
      return fail(502, 'survey_wms_unavailable');
    }
  }

  handler.cacheStats = () => ({ entries: cache.size, bytes: cacheBytes });
  return handler;
}

/** The `/api/survey-wms/<id>` route for dev and preview. */
export function surveyWmsProxy(options = {}) {
  const handler = createSurveyWmsHandler(options);
  return {
    name: 'survey-wms',
    configureServer({ middlewares }) {
      middlewares.use(SURVEY_WMS_ROUTE, handler);
    },
    configurePreviewServer({ middlewares }) {
      middlewares.use(SURVEY_WMS_ROUTE, handler);
    },
  };
}
