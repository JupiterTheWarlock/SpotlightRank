import test from 'node:test';
import assert from 'node:assert/strict';
import { createHandler } from '../cloudflare/worker.js';

test('云端只转发允许的匿名读取请求，不共享缓存或传递访客凭据', async () => {
  let calls = 0;
  const handle = createHandler(async (url, options) => {
    calls++;
    assert.equal(url.hostname, 'www.taptap.cn');
    assert.equal(options.headers.Cookie, undefined);
    assert.equal(options.headers.Authorization, undefined);
    assert.equal(options.redirect, 'manual');
    assert.equal(options.cache, 'no-store');
    return Response.json({ success: true, data: { list: [] } });
  });
  const request = new Request('https://spotlight.example/api/games?ids=1,2', { headers: { Cookie: 'private=value', Authorization: 'private' } });
  const response = await handle(request, {});
  assert.equal(response.status, 200);
  assert.match(response.headers.get('cache-control'), /no-store/);
  assert.equal(response.headers.get('cdn-cache-control'), 'no-store');
  assert.equal(response.headers.get('access-control-allow-origin'), null);
  assert.equal(calls, 1);
  for (const [path, init, code] of [
    ['/api/games?ids=1', { method: 'POST' }, 405],
    ['/api/categories', { headers: { Origin: 'https://other.example' } }, 403],
    ['/api/categories', { headers: { 'Sec-Fetch-Site': 'cross-site' } }, 403],
    ['/api/games?ids=http://other.example', {}, 400],
    ['/api/arbitrary?url=https://other.example', {}, 404],
  ]) assert.equal((await handle(new Request(`https://spotlight.example${path}`, init), {})).status, code);
  assert.equal(calls, 1);
});

test('云端配置与错误格式兼容浏览器，失败不会写成成功空名单', async () => {
  const handle = createHandler(async () => new Response('<html>error</html>', { status: 403 }));
  const config = await (await handle(new Request('https://spotlight.example/api/config'), {})).json();
  assert.equal(config.runtime, 'cloudflare');
  assert.equal(config.eventId, 28);
  const response = await handle(new Request('https://spotlight.example/api/categories'), {});
  assert.equal(response.status, 502);
  assert.match((await response.json()).error, /403/);
});
