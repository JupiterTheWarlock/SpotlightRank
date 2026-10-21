import { upstreamUrl } from '../upstream.js';
import settings from '../app.config.json' with { type: 'json' };

const headers = {
  'Content-Type': 'application/json; charset=utf-8',
  'Cache-Control': 'private, no-store',
  'CDN-Cache-Control': 'no-store',
  'X-Content-Type-Options': 'nosniff',
};
const json = (value, status = 200) => new Response(JSON.stringify(value), { status, headers });

export function createHandler(fetcher = fetch) {
  // Only active requests live here, never responses or persistent visitor records.
  const active = new Map();
  return async (request, env) => {
    const url = new URL(request.url);
    if (!url.pathname.startsWith('/api/')) return env.ASSETS.fetch(request);
    if (request.method !== 'GET') return json({ error: '仅支持读取。' }, 405);
    const origin = request.headers.get('Origin');
    if ((origin && origin !== url.origin) || request.headers.get('Sec-Fetch-Site') === 'cross-site') return json({ error: '请从本站页面获取数据。' }, 403);
    if (url.pathname === '/api/config') return json({ eventId: settings.eventId, gameJamId: settings.gameJamId, version: '0.2.0', runtime: 'cloudflare' });
    if (url.pathname === '/api/health') return json({ ok: true, storage: 'browser-only', runtime: 'cloudflare' });
    let upstream;
    try { upstream = upstreamUrl(url.pathname, url.searchParams, settings); }
    catch (error) { return json({ error: error.message }, 400); }
    if (!upstream) return json({ error: '接口不存在。' }, 404);
    const client = request.headers.get('CF-Connecting-IP') || 'unknown';
    if ((active.get(client) || 0) >= 4 || active.size >= 1000) return json({ error: '请求较多，请等当前更新完成。' }, 429);
    active.set(client, (active.get(client) || 0) + 1);
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 20000);
    try {
      const response = await fetcher(upstream, {
        headers: { 'User-Agent': 'Mozilla/5.0', Accept: 'application/json' },
        signal: controller.signal, redirect: 'manual', cache: 'no-store',
      });
      if (response.status === 429) return json({ error: 'TapTap 暂时限制了请求频率，请稍后更新。已有缓存仍可使用。' }, 429);
      if (!response.ok) return json({ error: `TapTap 接口返回 HTTP ${response.status}，请稍后重试。` }, 502);
      const data = await response.json();
      if (data.success !== true) return json({ error: 'TapTap 没有返回有效数据，请稍后重试。' }, 502);
      return json(data);
    } catch (error) {
      console.error('TapTap upstream request failed:', error.name, error.message);
      return json({ error: error.name === 'AbortError' ? '连接 TapTap 超时，请稍后重试。' : '无法连接 TapTap，请稍后重试。已有缓存仍可使用。' }, 502);
    } finally {
      clearTimeout(timer);
      const remaining = active.get(client) - 1;
      if (remaining) active.set(client, remaining); else active.delete(client);
    }
  };
}

export default { fetch: createHandler() };
