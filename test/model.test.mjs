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
test('上次指标随快照保存，缺失字段补 null，没有对照时不编造', () => {
  const raw = { id: 7, title: '测试', play_uv: 10 };
  assert.equal(normalizeGame(raw, undefined, undefined, []).prev, null);
  assert.deepEqual(normalizeGame(raw, undefined, { heat: 20, fans: 4 }, []).prev, { heat: 20, fans: 4, rating: null, reviews: null, officialRank: null, growth: null });
});
test('CSV防止标题被电子表格当作公式执行，名次变动一并列出', () => {
  const text = csv([{ ...games[0], title: '=2+3', place: 1, rankStatus: 'up', rankDelta: 2 }]);
  assert.ok(text.includes('"\'=2+3"'));
  assert.ok(text.includes('较上次名次'));
  assert.ok(text.includes('"\'+2"'));
  assert.ok(csv([{ ...games[0], place: 1, rankStatus: 'new', rankDelta: null }]).includes('"新"'));
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
  assert.deepEqual(options.platform.map(o => o.count), [3, 1, 1, 1]);
  assert.deepEqual(options.development.map(o => o.count), [3, 2, 1]);
  assert.deepEqual(selectGames(snapshot, { type: 'untagged' }).rows.map(g => g.id), ['2', '3']);
  assert.deepEqual(selectGames(snapshot, { type: 'tag:休闲' }).rows, []);
});

test('平台分为仅手机、仅 PC 和双端，三组互斥；未标注作品仅保留在全部平台', () => {
  const snapshot = { games: [[1], [2], [1, 2, 3], [3], [1, 2], [1, 3], [2, 3], []].map((categories, index) => ({ ...games[0], id: String(index + 1), categories })) };
  const options = filterOptions(snapshot).platform;
  assert.deepEqual(options.map(option => [option.label, option.count]), [['全部平台', 8], ['仅手机', 1], ['仅 PC', 1], ['双端', 5]]);
  const ids = value => selectGames(snapshot, { platform: value }).rows.map(game => game.id);
  assert.deepEqual(ids('1'), ['1']);
  assert.deepEqual(ids('2'), ['2']);
  assert.deepEqual(ids('3'), ['3', '4', '5', '6', '7']);
  assert.equal(ids('all').length, 8);
  for (const option of options) assert.equal(ids(option.value).length, option.count);
});

test('名次变动按同一筛选口径对比，涨、跌、新各自成立', () => {
  const base = { title: '作品', fans: 1, rating: 8, reviews: 20, officialRank: 5, growth: 0, categories: [] };
  const prev = extra => ({ heat: 50, fans: 1, rating: 8, reviews: 20, officialRank: 9, growth: 1, ...extra });
  const snapshot = { games: [
    { ...base, id: '1', heat: 100, prev: prev() },
    { ...base, id: '2', heat: 80, prev: prev({ heat: 100 }) },
    { ...base, id: '3', heat: 30, prev: prev({ heat: 60 }) },
    { ...base, id: '4', heat: 0, prev: null },
  ] };
  const result = selectGames(snapshot);
  assert.equal(result.hasPrev, true);
  const byId = Object.fromEntries(result.rows.map(g => [g.id, [g.rankStatus, g.rankDelta]]));
  assert.deepEqual(byId, { '1': ['up', 2], '2': ['down', -1], '3': ['down', -1], '4': ['new', null] });
});

test('没有上次数据时不显示变动；上次并列时按并列名次对比', () => {
  const plain = selectGames({ games: [...games] });
  assert.equal(plain.hasPrev, false);
  assert.ok(plain.rows.every(g => g.rankStatus === undefined && g.rankDelta === undefined));
  const snapshot = { games: [
    { ...games[0], heat: 100, prev: { heat: 100, fans: null, rating: null, reviews: null, officialRank: null, growth: null } },
    { ...games[1], heat: 90, prev: { heat: 100, fans: null, rating: null, reviews: null, officialRank: null, growth: null } },
  ] };
  const rows = selectGames(snapshot).rows;
  assert.deepEqual(rows.map(g => [g.id, g.rankStatus, g.rankDelta]), [['1', 'flat', 0], ['2', 'down', -1]]);
});

test('筛选后按筛选范围对比名次，而不是全站名次', () => {
  const snapshot = { games: [
    { ...games[0], id: '1', heat: 100, categories: [1], prev: { heat: 50, fans: null, rating: null, reviews: null, officialRank: null, growth: null } },
    { ...games[0], id: '2', heat: 80, categories: [1], prev: { heat: 100, fans: null, rating: null, reviews: null, officialRank: null, growth: null } },
    { ...games[0], id: '3', heat: 200, categories: [2], prev: { heat: 10, fans: null, rating: null, reviews: null, officialRank: null, growth: null } },
  ] };
  const rows = selectGames(snapshot, { category: '1' }).rows;
  assert.deepEqual(rows.map(g => [g.id, g.rankStatus, g.rankDelta]), [['1', 'up', 1], ['2', 'down', -1]]);
});

test('评分榜与官方名次榜的名次变动遵守各自的规则', () => {
  const rated = { games: [
    { ...games[0], id: '1', rating: 9, reviews: 10, prev: { heat: 1, fans: 1, rating: 8, reviews: 10, officialRank: 1, growth: 0 } },
    { ...games[0], id: '2', rating: 8, reviews: 10, prev: { heat: 1, fans: 1, rating: 9, reviews: 3, officialRank: 1, growth: 0 } },
  ] };
  const rows = selectGames(rated, { metric: 'rating', minReviews: 5 }).rows;
  assert.deepEqual(rows.map(g => [g.id, g.rankStatus]), [['1', 'flat'], ['2', 'new']]);
  const official = { games: [
    { ...games[0], id: '1', officialRank: 3, prev: { heat: 1, fans: 1, rating: 8, reviews: 10, officialRank: 6, growth: 0 } },
    { ...games[0], id: '2', officialRank: 10, prev: { heat: 1, fans: 1, rating: 8, reviews: 10, officialRank: 2, growth: 0 } },
  ] };
  const officialRows = selectGames(official, { metric: 'official' }).rows;
  assert.deepEqual(officialRows.map(g => [g.id, g.rankStatus, g.rankDelta]), [['1', 'up', 3], ['2', 'down', -8]]);
  const growth = { games: [
    { ...games[0], id: '1', growth: 5, prev: { heat: 1, fans: 1, rating: 8, reviews: 10, officialRank: 1, growth: 1 } },
    { ...games[0], id: '2', growth: 2, prev: { heat: 1, fans: 1, rating: 8, reviews: 10, officialRank: 1, growth: 9 } },
  ] };
  assert.deepEqual(selectGames(growth, { metric: 'growth' }).rows.map(g => [g.id, g.rankStatus, g.rankDelta]), [['1', 'up', 1], ['2', 'down', -1]]);
});
