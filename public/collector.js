import { normalizeGame } from './model.js';
import { validateSnapshot } from './snapshot.js';

const chunks = (items, size) => Array.from({ length: Math.ceil(items.length / size) }, (_, i) => items.slice(i * size, (i + 1) * size));
const check = signal => { if (signal?.aborted) throw new DOMException('已取消', 'AbortError'); };

async function pool(tasks, handler, signal) {
  let next = 0;
  const results = [];
  await Promise.all(Array.from({ length: Math.min(2, tasks.length) }, async () => {
    while (next < tasks.length) {
      check(signal);
      const index = next++;
      results[index] = await handler(tasks[index]);
      await new Promise(resolve => setTimeout(resolve, 60));
    }
  }));
  return results;
}

export async function collectSnapshot({ config, previous = null, request, signal, onProgress = () => {} }) {
  const startedAt = Date.now();
  check(signal);
  const oldById = new Map((previous?.games || []).map(g => [g.id, g]));
  onProgress(0, '读取本届作品目录…');
  const rawCategories = (await request('/api/categories', signal)).data?.list;
  if (!Array.isArray(rawCategories)) throw new Error('官方目录结构发生变化，本次没有覆盖旧榜单。');
  const all = rawCategories.find(c => Number(c.id) === 0);
  if (!all || !Array.isArray(all.identifications) || !all.identifications.length) throw new Error('官方目录暂未返回作品，旧榜单已保留。');
  const ids = [...new Set(all.identifications.map(String))];
  if (ids.some(id => !/^\d{1,12}$/.test(id))) throw new Error('目录含有无法识别的作品编号。');
  const categories = rawCategories.filter(c => Number(c.id) !== 0).map(c => ({ id: Number(c.id), title: String(c.title), ids: new Set((c.identifications || []).map(String)) }));
  let completed = 0;
  const gameResults = await pool(chunks(ids, 100), async batch => {
    const data = await request(`/api/games?ids=${batch.join(',')}`, signal);
    if (!Array.isArray(data.data?.list)) throw new Error('作品明细格式发生变化，旧榜单已保留。');
    completed += batch.length;
    onProgress(4 + completed / ids.length * 26, `获取作品 ${completed} / ${ids.length}`);
    return data.data.list;
  }, signal);
  const games = new Map(gameResults.flat().map(g => [String(g.id), g]));
  const missing = ids.filter(id => !games.has(id));
  if (missing.length) throw new Error(`目录中有 ${missing.length} 款未返回明细，本次更新未保存。`);
  completed = 0;
  const statsResults = await pool(chunks(ids, 20), async batch => {
    const data = await request(`/api/stats?ids=${batch.join(',')}`, signal);
    if (!Array.isArray(data.data?.list)) throw new Error('作品统计格式发生变化，旧榜单已保留。');
    completed += batch.length;
    onProgress(30 + completed / ids.length * 65, `获取关注与评分 ${completed} / ${ids.length}`);
    return data.data.list;
  }, signal);
  const stats = new Map(statsResults.flat().map(g => [String(g.id), g]));
  let event = previous?.event || null;
  try { const result = await request('/api/event', signal, false); event = result.data?.event || result.data; }
  catch (error) { check(signal); }
  check(signal);
  return validateSnapshot({
    schema: 1, config: { eventId: config.eventId, gameJamId: config.gameJamId },
    event, startedAt, fetchedAt: Date.now(), previousAt: previous?.fetchedAt || null,
    expectedCount: ids.length, missingStats: ids.filter(id => !stats.get(id)?.stat).length,
    categories: categories.map(c => ({ id: c.id, title: c.title, count: c.ids.size })),
    games: ids.map(id => normalizeGame(games.get(id), stats.get(id), oldById.get(id), categories)),
  }, config);
}
