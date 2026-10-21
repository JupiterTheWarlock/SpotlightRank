import test from 'node:test';
import assert from 'node:assert/strict';
import { numeric, normalizeGame, rankGames, selectGames, filterOptions, csv } from '../public/model.js';

const games = [
  { id: '1', title: '作品甲', heat: 100, fans: 8, rating: 9, reviews: 10, officialRank: 6, growth: 0, categories: [4] },
  { id: '2', title: '作品乙', heat: 100, fans: 0, rating: 10, reviews: 1, officialRank: null, growth: 3, categories: [4] },
  { id: '3', title: '作品丙', heat: 30, fans: null, rating: null, reviews: 0, officialRank: 15, growth: null, categories: [1] },
  { id: '4', title: '作品丁', heat: 0, fans: 1, rating: 8, reviews: 8, officialRank: null, growth: -5, categories: [4] },
];
test('真实零值参与排名，缺失值不伪装为零；并列采用竞赛名次', () => {
  assert.equal(numeric(null), null);
  assert.equal(numeric('0'), 0);
  assert.deepEqual(rankGames(games, 'heat').map(g => g.place), [1, 1, 3, 4]);
  assert.deepEqual(rankGames(games, 'fans').map(g => g.id), ['1', '4', '2']);
});
test('搜索和收藏不重算名次；分类筛选按组排名', () => {
  assert.equal(selectGames({ games }, { query: '丙' }).rows[0].place, 3);
  assert.equal(selectGames({ games }, { favoritesOnly: true, favorites: ['4'] }).rows[0].place, 4);
  assert.equal(selectGames({ games }, { category: '1' }).rows[0].place, 1);
});
test('官方名次保留缺口，不把99条压成1到99', () => {
  assert.deepEqual(rankGames(games, 'official').map(g => g.place), [6, 15]);
});
test('评分门槛屏蔽小样本高分；无评分不参与', () => {
  assert.deepEqual(selectGames({ games }, { metric: 'rating', minReviews: 5 }).rows.map(g => g.id), ['1', '4']);
});
test('首次快照不制造增长；负向修正照实保留', () => {
  const raw = { id: 7, title: '测试', play_uv: 10 };
  assert.equal(normalizeGame(raw, undefined, undefined, []).growth, null);
  assert.equal(normalizeGame(raw, undefined, { heat: 20 }, []).growth, -10);
  assert.equal(normalizeGame(raw, undefined, undefined, []).fans, null);
});
test('CSV防止标题被电子表格当作公式执行', () => {
  const text = csv([{ ...games[0], title: '=2+3', place: 1 }]);
  assert.ok(text.includes('"\'=2+3"'));
  assert.ok(text.startsWith('\uFEFF'));
});

test('类型、开发方式、平台、团队取交集，随后搜索不重算名次', () => {
  const snapshot = { games: [
    { ...games[0], tags: ['聚光灯GameJam', '策略'], categories: [1, 2, 3, 4, 5] },
    { ...games[1], heat: 80, tags: ['策略'], categories: [1, 2, 3, 4, 5] },
    { ...games[2], tags: ['策略'], categories: [1, 5] },
    { ...games[3], tags: ['休闲'], categories: [2, 4, 5] },
  ] };
  const filters = { type: 'tag:策略', development: 'maker', platform: '3', team: 'student' };
  assert.deepEqual(selectGames(snapshot, filters).rows.map(g => g.id), ['1', '2']);
  assert.equal(selectGames(snapshot, { ...filters, query: '乙' }).rows[0].place, 2);
  assert.deepEqual(selectGames(snapshot, { ...filters, development: 'other', platform: '1' }).rows.map(g => g.id), ['3']);
  assert.deepEqual(selectGames(snapshot, { ...filters, metric: 'official' }).rows.map(g => g.place), [6]);
});

test('类型选项来自缓存标签，去重并排除赛事和开发方式标签；不漏掉未标注作品', () => {
  const snapshot = { games: [
    { ...games[0], tags: ['策略', '策略', 'TapTap制造', '聚光灯GameJam'], categories: [1, 2, 3, 4] },
    { ...games[1], tags: ['TapTap制造', '聚光灯GameJam'], categories: [1, 4] },
    { ...games[2], tags: [], categories: [2] },
  ] };
  const options = filterOptions(snapshot);
  assert.deepEqual(options.type.map(o => [o.value, o.count]), [['all', 3], ['tag:策略', 1], ['untagged', 2]]);
  assert.deepEqual(options.platform.map(o => o.count), [3, 2, 2, 1]);
  assert.deepEqual(options.development.map(o => o.count), [3, 2, 1]);
  assert.deepEqual(selectGames(snapshot, { type: 'untagged' }).rows.map(g => g.id), ['2', '3']);
  assert.deepEqual(selectGames(snapshot, { type: 'tag:休闲' }).rows, []);
});
