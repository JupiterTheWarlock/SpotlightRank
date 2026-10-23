import { prevMetricFields } from './model.js';

export function validateSnapshot(snapshot, config) {
  const fail = () => { throw new Error('榜单文件不完整或不属于本届赛事，已有数据保持不变。'); };
  if (!snapshot || snapshot.schema !== 1 || snapshot.config?.eventId !== config.eventId || snapshot.config?.gameJamId !== config.gameJamId) fail();
  if (!Number.isFinite(snapshot.fetchedAt) || snapshot.fetchedAt <= 0 || !Number.isFinite(snapshot.startedAt) || snapshot.startedAt > snapshot.fetchedAt) fail();
  if (snapshot.previousAt !== null && (!Number.isFinite(snapshot.previousAt) || snapshot.previousAt >= snapshot.fetchedAt)) fail();
  if (!Array.isArray(snapshot.games) || !snapshot.games.length || snapshot.games.length !== snapshot.expectedCount || !Array.isArray(snapshot.categories)) fail();
  const ids = new Set();
  for (const game of snapshot.games) {
    if (!game || typeof game.id !== 'string' || !/^\d{1,12}$/.test(game.id) || ids.has(game.id) || typeof game.title !== 'string') fail();
    ids.add(game.id);
    if (!Array.isArray(game.categories) || !game.categories.every(Number.isInteger) || !Array.isArray(game.tags) || !game.tags.every(t => typeof t === 'string')) fail();
    for (const key of ['heat', 'fans', 'rating', 'reviews', 'officialRank', 'rankUpdatedAt', 'votes', 'growth']) {
      if (game[key] !== null && !Number.isFinite(game[key])) fail();
    }
    if (game.prev !== undefined && game.prev !== null) {
      if (typeof game.prev !== 'object' || Array.isArray(game.prev)) fail();
      for (const key of prevMetricFields) {
        if (game.prev[key] !== undefined && game.prev[key] !== null && !Number.isFinite(game.prev[key])) fail();
      }
    }
  }
  if (!snapshot.categories.every(c => c && Number.isInteger(c.id) && typeof c.title === 'string')) fail();
  return snapshot;
}

export function newerSnapshot(cached, published) {
  return !cached || published.fetchedAt > cached.fetchedAt ? published : cached;
}
