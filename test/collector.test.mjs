import test from 'node:test';
import assert from 'node:assert/strict';
import { collectSnapshot } from '../public/collector.js';
import { validateSnapshot, newerSnapshot } from '../public/snapshot.js';
const config = { eventId: 28, gameJamId: 3 };
const request = async route => {
  if (route === '/api/categories') return { data: { list: [{ id: 0, title: '全部', identifications: [1, 2] }, { id: 3, title: '双端', identifications: [1] }] } };
  if (route.startsWith('/api/games')) return { data: { list: [{ id: 1, title: '作品一', play_uv: 10 }, { id: 2, title: '作品二', play_uv: 0 }] } };
  if (route.startsWith('/api/stats')) return { data: { list: [{ id: 1, stat: { fans_count: 2, rating: { score: 8 }, review_count: 5 }, tags: [{ value: '休闲' }] }] } };
  return { data: { event: { year: 2026, event_name: '测试赛事' } } };
};

test('定时与本地采集共用完整数据模型，保留零值、缺失值、筛选和真实对照时间', async () => {
  const previous = { fetchedAt: 1000, games: [{ id: '1', heat: 12 }] };
  const snapshot = await collectSnapshot({ config, previous, request });
  assert.equal(snapshot.games.length, 2);
  assert.equal(snapshot.games[0].growth, -2);
  assert.equal(snapshot.games[1].heat, 0);
  assert.equal(snapshot.games[1].fans, null);
  assert.deepEqual(snapshot.games[0].categories, [3]);
  assert.deepEqual(snapshot.games[0].tags, ['休闲']);
  assert.equal(snapshot.previousAt, 1000);
  assert.equal(snapshot.missingStats, 1);
  assert.equal(validateSnapshot(JSON.parse(JSON.stringify(snapshot)), config).games.length, 2);
});

test('空目录、部分明细、上游失败和取消都拒绝产出替换榜单', async () => {
  await assert.rejects(collectSnapshot({ config, request: async () => ({ data: { list: [] } }) }), /目录/);
  await assert.rejects(collectSnapshot({ config, request: route => route.startsWith('/api/games') ? { data: { list: [{ id: 1 }] } } : request(route) }), /未返回明细/);
  await assert.rejects(collectSnapshot({ config, request: async () => { throw new Error('upstream unavailable'); } }), /unavailable/);
  const controller = new AbortController(); controller.abort();
  await assert.rejects(collectSnapshot({ config, request, signal: controller.signal }), { name: 'AbortError' });
});

test('无效或不同赛事文件被拒绝，已缓存的新榜单不会被旧发布覆盖', async () => {
  const snapshot = await collectSnapshot({ config, request });
  assert.throws(() => validateSnapshot({ ...snapshot, config: { ...config, eventId: 1 } }, config));
  assert.throws(() => validateSnapshot({ ...snapshot, games: [snapshot.games[0], snapshot.games[0]] }, config));
  assert.throws(() => validateSnapshot({ ...snapshot, expectedCount: 3 }, config));
  const newer = { ...snapshot, fetchedAt: snapshot.fetchedAt + 1000 };
  assert.equal(newerSnapshot(newer, snapshot), newer);
  assert.equal(newerSnapshot(snapshot, newer), newer);
  assert.equal(newerSnapshot(null, snapshot), snapshot);
});
