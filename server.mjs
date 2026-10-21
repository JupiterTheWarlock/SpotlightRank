import { upstreamUrl as buildUpstreamUrl } from './upstream.js';
import http from 'node:http';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const root = path.dirname(fileURLToPath(import.meta.url));
const settings = JSON.parse(await readFile(path.join(root, 'app.config.json'), 'utf8'));

const assets = new Map([
  ['/', ['index.html', 'text/html; charset=utf-8']],
  ['/app.js', ['app.js', 'text/javascript; charset=utf-8']],
  ['/model.js', ['model.js', 'text/javascript; charset=utf-8']],
  ['/dropdown.js', ['dropdown.js', 'text/javascript; charset=utf-8']],
  ['/storage.js', ['storage.js', 'text/javascript; charset=utf-8']],
  ['/styles.css', ['styles.css', 'text/css; charset=utf-8']],
  ['/favicon.svg', ['favicon.svg', 'image/svg+xml']],
]);

function sendJson(res, status, value) {
  res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' });
  res.end(JSON.stringify(value));
}

export const upstreamUrl = (route, search, config = settings) => buildUpstreamUrl(route, search, config);

export function createServer({ fetcher = fetch, config = settings } = {}) {
  let active = 0;
  return http.createServer(async (req, res) => {
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('Referrer-Policy', 'no-referrer');
    res.setHeader('Content-Security-Policy', "default-src 'self'; img-src 'self' https://*.tapimg.com data:; connect-src 'self'; style-src 'self'; script-src 'self'; object-src 'none'; base-uri 'none'; frame-ancestors 'none'");
    const host = req.headers.host || '';
    if (!/^(127\.0\.0\.1|localhost)(:\d+)?$/.test(host)) return sendJson(res, 403, { error: '仅允许从本机访问。' });
    if (req.headers.origin && req.headers.origin !== `http://${host}`) return sendJson(res, 403, { error: '不接受其他网页发起的请求。' });
    if (req.method !== 'GET' && req.method !== 'HEAD') return sendJson(res, 405, { error: '仅支持读取。' });
    const url = new URL(req.url, `http://${host}`);
    if (url.pathname === '/api/config') return sendJson(res, 200, { eventId: config.eventId, gameJamId: config.gameJamId, version: '0.2.0', runtime: 'local' });
    if (url.pathname === '/api/health') return sendJson(res, 200, { ok: true, storage: 'browser-only' });
    if (url.pathname.startsWith('/api/')) {
      let upstream;
      try { upstream = upstreamUrl(url.pathname, url.searchParams, config); }
      catch (error) { return sendJson(res, 400, { error: error.message }); }
      if (!upstream) return sendJson(res, 404, { error: '接口不存在。' });
      if (active >= 6) return sendJson(res, 429, { error: '本机请求较多，请等当前更新完成。' });
      active++;
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), 20000);
      const onClose = () => controller.abort();
      res.on('close', onClose);
      try {
        const response = await fetcher(upstream, {
          headers: { 'User-Agent': 'Mozilla/5.0', Accept: 'application/json' },
          signal: controller.signal,
          redirect: 'error',
        });
        if (response.status === 429) return sendJson(res, 429, { error: 'TapTap 暂时限制了请求频率，请稍后更新。已有缓存仍可使用。' });
        if (!response.ok) return sendJson(res, 502, { error: `TapTap 接口返回 HTTP ${response.status}，请稍后重试。` });
        const data = await response.json();
        if (data.success !== true) return sendJson(res, 502, { error: data.data?.msg || 'TapTap 没有返回有效数据，请稍后重试。' });
        sendJson(res, 200, data);
      } catch (error) {
        if (!res.destroyed) sendJson(res, 502, { error: error.name === 'AbortError' ? '连接 TapTap 超时，请检查网络后重试。' : '无法连接 TapTap，请检查网络后重试。' });
      } finally {
        clearTimeout(timer);
        res.off('close', onClose);
        active--;
      }
      return;
    }
    const asset = assets.get(url.pathname);
    if (!asset) return sendJson(res, 404, { error: '页面不存在。' });
    try {
      const body = await readFile(path.join(root, 'public', asset[0]));
      res.writeHead(200, { 'Content-Type': asset[1], 'Cache-Control': 'no-cache' });
      res.end(req.method === 'HEAD' ? undefined : body);
    } catch { sendJson(res, 500, { error: '页面文件缺失，请重新解压完整工具包。' }); }
  });
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const port = Number(process.env.PORT || settings.port);
  const server = createServer();
  server.on('error', error => {
    console.error(error.code === 'EADDRINUSE' ? `端口 ${port} 已被占用。若已启动，请打开 http://127.0.0.1:${port}` : error.message);
    process.exitCode = 1;
  });
  server.listen(port, '127.0.0.1', () => console.log(`聚光榜已启动：http://127.0.0.1:${port}\n仅在本机运行；数据仅缓存在浏览器。按 Ctrl+C 停止。`));
}
