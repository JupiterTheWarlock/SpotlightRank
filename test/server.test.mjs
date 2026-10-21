import test from 'node:test';
import assert from 'node:assert/strict';
import { createServer, upstreamUrl } from '../server.mjs';

test('转发仅允许固定TapTap接口和受限作品编号', () => {
  assert.equal(upstreamUrl('/api/anything', new URLSearchParams()), null);
  assert.throws(() => upstreamUrl('/api/games', new URLSearchParams({ ids: 'https://example.com' })));
  assert.throws(() => upstreamUrl('/api/stats', new URLSearchParams({ ids: Array(21).fill('1').join(',') })));
  const url = upstreamUrl('/api/games', new URLSearchParams({ ids: '1,2', url: 'http://example.com' }));
  assert.equal(url.hostname, 'www.taptap.cn');
  assert.equal(url.searchParams.get('identifications'), '1,2');
});

test('其他网页不能调用本机接口；失败不伪造成功数据', async t => {
  let calls = 0;
  const server = createServer({ fetcher: async () => { calls++; return new Response('unavailable', { status: 503 }); } });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  t.after(() => new Promise(resolve => server.close(resolve)));
  const base = `http://127.0.0.1:${server.address().port}`;
  const config = await (await fetch(`${base}/runtime.json`)).json();
  assert.equal(config.runtime, 'local');
  assert.equal(config.canRefresh, true);
  const denied = await fetch(`${base}/api/categories`, { headers: { Origin: 'https://example.com' } });
  assert.equal(denied.status, 403);
  assert.equal(calls, 0);
  const failed = await fetch(`${base}/api/categories`);
  assert.equal(failed.status, 502);
  assert.equal(failed.headers.get('cache-control'), 'no-store');
  assert.match((await failed.json()).error, /503/);
  const privateFile = await fetch(`${base}/app.config.json`);
  assert.equal(privateFile.status, 404);
});
