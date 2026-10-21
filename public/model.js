export const metrics = {
  heat: { label: '活动热度', short: '热度', hint: '按活动接口返回的热度数值降序排列。', field: 'heat' },
  fans: { label: '关注榜', short: '关注', hint: '按作品当前关注人数降序排列。', field: 'fans' },
  rating: { label: '评分榜', short: '评分', hint: '按 TapTap 玩家评分降序排列，可设置最低评价数。未评分作品不参与。', field: 'rating' },
  reviews: { label: '评价榜', short: '评价', hint: '按作品评价数量降序排列。', field: 'reviews' },
  official: { label: '官方返回名次', short: '官方名次', hint: '原样展示活动接口的 rank；未返回的作品不补造名次。这不是评委成绩或获奖排名。', field: 'officialRank', ascending: true },
  growth: { label: '热度变化', short: '变化', hint: '比较榜单记录的两次完整采集的热度差。它不是官方日榜；新出现作品不参与增量排名。', field: 'growth' },
};

export function numeric(value) {
  if (value === null || value === undefined || value === '') return null;
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}

export function normalizeGame(game, statApp, previous, categories) {
  const stat = statApp?.stat;
  const id = String(game.id);
  const heat = numeric(game.play_uv);
  const rating = numeric(stat?.rating?.score);
  const officialRank = numeric(game.rank);
  return {
    id,
    title: String(game.title || statApp?.title?.fallback || `作品 ${id}`),
    icon: game.icon?.medium_url || game.icon?.url || '',
    description: game.description?.text || '',
    heat,
    fans: numeric(stat?.fans_count),
    rating: rating > 0 ? rating : null,
    reviews: numeric(stat?.review_count),
    officialRank: officialRank > 0 ? officialRank : null,
    rankUpdatedAt: numeric(game.rank_updated_at),
    votes: numeric(game.number_of_votes),
    growth: previous && heat !== null && previous.heat !== null ? heat - previous.heat : null,
    categories: categories.filter(c => c.ids.has(id)).map(c => c.id),
    tags: (statApp?.tags || game.tags || []).map(t => t.value).filter(Boolean),
    statsAvailable: Boolean(stat),
  };
}

export function rankGames(games, metric) {
  const spec = metrics[metric] || metrics.heat;
  const ranked = games.filter(g => g[spec.field] !== null && g[spec.field] !== undefined);
  ranked.sort((a, b) => {
    const delta = spec.ascending ? a[spec.field] - b[spec.field] : b[spec.field] - a[spec.field];
    return delta || Number(a.id) - Number(b.id);
  });
  let lastValue, place = 0;
  return ranked.map((game, index) => {
    const value = game[spec.field];
    if (value !== lastValue) place = index + 1;
    lastValue = value;
    return { ...game, place: metric === 'official' ? game.officialRank : place };
  });
}

const metadataTags = new Set(['聚光灯GameJam', 'TapTap制造']);
export const gameTypes = game => [...new Set((game.tags || []).filter(tag => typeof tag === 'string' && tag.trim() && !metadataTags.has(tag)))];

export function filterOptions(snapshot) {
  const games = snapshot?.games || [];
  const count = predicate => games.filter(predicate).length;
  const has = (game, id) => (game.categories || []).includes(id);
  const tags = new Map();
  for (const game of games) for (const tag of gameTypes(game)) tags.set(tag, (tags.get(tag) || 0) + 1);
  const all = label => ({ value: 'all', label, count: games.length });
  return {
    type: [all('全部类型'), ...[...tags].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0], 'zh-CN')).map(([tag, total]) => ({ value: `tag:${tag}`, label: tag, count: total })), { value: 'untagged', label: '未标注类型', count: count(g => !gameTypes(g).length) }],
    development: [all('全部开发方式'), { value: 'maker', label: 'TapTap 制造', count: count(g => has(g, 4)) }, { value: 'other', label: '其他开发方式', count: count(g => !has(g, 4)) }],
    platform: [all('全部平台'), { value: '1', label: '手机可玩（含双端）', count: count(g => has(g, 1)) }, { value: '2', label: 'PC 可玩（含双端）', count: count(g => has(g, 2)) }, { value: '3', label: '手机 + PC 双端', count: count(g => has(g, 3)) }],
    team: [all('全部团队'), { value: 'student', label: '学生团队', count: count(g => has(g, 5)) }],
  };
}

export function selectGames(snapshot, { metric = 'heat', category = 'all', type = 'all', development = 'all', platform = 'all', team = 'all', query = '', favoritesOnly = false, favorites = [], minReviews = 5 } = {}) {
  let scope = snapshot?.games || [];
  if (category !== 'all') scope = scope.filter(g => g.categories.includes(Number(category)));
  if (type !== 'all') scope = scope.filter(g => type === 'untagged' ? !gameTypes(g).length : gameTypes(g).includes(type.slice(4)));
  if (development !== 'all') scope = scope.filter(g => (g.categories || []).includes(4) === (development === 'maker'));
  if (platform !== 'all') scope = scope.filter(g => (g.categories || []).includes(Number(platform)));
  if (team === 'student') scope = scope.filter(g => (g.categories || []).includes(5));
  if (metric === 'rating') scope = scope.filter(g => g.reviews !== null && g.reviews >= Number(minReviews));
  const ranked = rankGames(scope, metric);
  const needle = query.trim().toLocaleLowerCase();
  const pins = new Set(favorites.map(String));
  return {
    scopeCount: scope.length,
    rankedCount: ranked.length,
    rows: ranked.filter(g => (!needle || g.title.toLocaleLowerCase().includes(needle) || g.id.includes(needle)) && (!favoritesOnly || pins.has(g.id))),
  };
}

export function summary(games) {
  const heat = games.map(g => g.heat).filter(v => v !== null).sort((a, b) => a - b);
  const middle = Math.floor(heat.length / 2);
  return {
    count: games.length,
    heat: heat.reduce((a, b) => a + b, 0),
    median: heat.length ? (heat.length % 2 ? heat[middle] : (heat[middle - 1] + heat[middle]) / 2) : null,
    rated: games.filter(g => g.rating !== null).length,
  };
}

export function csv(rows) {
  const cells = value => {
    let text = value == null ? '' : String(value);
    if (/^[=+\-@\t\r]/.test(text)) text = `'${text}`;
    return `"${text.replaceAll('"', '""')}"`;
  };
  const data = [['当前榜单名次', '游戏名', '作品ID', '活动热度', '关注人数', '玩家评分', '评价数', '接口原始名次', '较上次热度变化', '作品链接'],
    ...rows.map(g => [g.place, g.title, g.id, g.heat, g.fans, g.rating, g.reviews, g.officialRank, g.growth, `https://www.taptap.cn/app/${g.id}`])];
  return '\uFEFF' + data.map(row => row.map(cells).join(',')).join('\r\n');
}
