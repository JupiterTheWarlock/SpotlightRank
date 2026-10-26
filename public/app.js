import { metrics, selectGames, filterOptions, summary, csv } from './model.js';
import { read, write, commitSnapshot, clearSnapshots } from './storage.js';
import { ValueDropdown } from './dropdown.js';
import { collectSnapshot } from './collector.js';
import { validateSnapshot, newerSnapshot } from './snapshot.js';

const $ = id => document.getElementById(id);
const number = new Intl.NumberFormat('zh-CN', { maximumFractionDigits: 1 });
const dateTime = new Intl.DateTimeFormat('zh-CN', { month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hour12: false });
const state = { config: null, snapshot: null, favorites: [], metric: 'heat', type: 'all', development: 'all', platform: 'all', team: 'all', query: '', favoritesOnly: false, minReviews: 5, page: 1, pageSize: 25, loading: false, controller: null };
let selection = { rows: [], rankedCount: 0, scopeCount: 0 };
let clearTimer;
const filterLabels = { type: '类型 / 标签', development: '开发方式', platform: '支持平台', team: '团队' };
const dropdowns = Object.fromEntries(Object.entries(filterLabels).map(([key, label]) => [key, new ValueDropdown($(`filter-${key}`), {
  label, onChange(value) { state[key] = value; state.page = 1; renderRanking(); savePreferences(); },
})]));
const reviewDropdown = new ValueDropdown($('rating-filter'), {
  label: '最低评价数', onChange(value) { state.minReviews = Number(value); state.page = 1; renderRanking(); savePreferences(); },
});

function renderFilters() {
  const options = filterOptions(state.snapshot);
  for (const [key, dropdown] of Object.entries(dropdowns)) {
    dropdown.setOptions(options[key], state[key], !state.snapshot);
    state[key] = dropdown.value;
  }
  reviewDropdown.setOptions([0, 5, 10, 30].map(value => ({ value: String(value), label: value ? `至少 ${value} 条` : '不限评价数' })), state.minReviews, !state.snapshot);
}

function resetFilters() {
  for (const key of Object.keys(filterLabels)) state[key] = 'all';
  state.query = ''; state.favoritesOnly = false; state.minReviews = 5; state.page = 1;
  $('search').value = '';
  renderFilters(); renderRanking(); savePreferences();
}

const escape = value => String(value ?? '').replace(/[&<>"']/g, char => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[char]);
const format = value => value === null || value === undefined ? '—' : number.format(value);
const compact = value => value >= 10000 ? `${number.format(value / 10000)}万` : format(value);
const cacheKey = () => `snapshot:${state.config.eventId}:${state.config.gameJamId}`;
const stamp = time => time ? dateTime.format(new Date(time)) : '未知';
const canRefresh = () => state.config?.runtime === 'local' && state.config?.canRefresh === true;

function notice(message = '', error = false) {
  $('notice').hidden = !message;
  $('notice').textContent = message;
  $('notice').classList.toggle('error', error);
}

function progress(value, message) {
  $('progress-bar').style.width = `${Math.max(0, Math.min(100, value))}%`;
  $('progress-text').textContent = message;
}

async function request(path, signal, retry = true) {
  try {
    const response = await fetch(path, { signal, cache: 'no-store' });
    const data = await response.json();
    if (!response.ok) {
      const error = new Error(data.error || `请求失败（${response.status}）。`);
      error.status = response.status;
      throw error;
    }
    return data;
  } catch (error) {
    if (signal?.aborted) throw new DOMException('已取消', 'AbortError');
    if (retry && error.status !== 429 && (!error.status || error.status >= 500)) {
      await new Promise(resolve => setTimeout(resolve, 800));
      return request(path, signal, false);
    }
    throw error;
  }
}

function setLoading(loading) {
  state.loading = loading;
  $('refresh-button').disabled = loading || !canRefresh();
  $('refresh-button').title = canRefresh() ? '从本机连接 TapTap 更新' : '当前为静态站；请按下方说明在本地运行后更新';
  $('sync-progress').hidden = !loading;
  $('clear-cache').disabled = loading || !state.snapshot;
  $('refresh-label').textContent = loading ? '正在更新…' : !canRefresh() ? '本地运行后可更新' : state.snapshot ? '更新本届数据' : '获取本届数据';
  $('cache-pill').textContent = loading ? '更新中' : state.snapshot ? (canRefresh() ? '浏览器缓存' : '已发布榜单') : '等待载入';
}

async function refresh() {
  if (state.loading || !canRefresh()) return;
  if (navigator.locks) {
    await navigator.locks.request(`spotlight-refresh:${cacheKey()}`, { ifAvailable: true }, async lock => {
      if (!lock) return notice('另一个窗口正在更新这届赛事，请等它完成后刷新页面。');
      await updateSnapshot();
    });
  } else await updateSnapshot();
}

async function updateSnapshot() {
  const controller = new AbortController();
  state.controller = controller;
  const signal = controller.signal;
  setLoading(true);
  notice();
  progress(0, '读取本届作品目录…');
  try {
    const previous = await read(cacheKey());
    const snapshot = await collectSnapshot({ config: state.config, previous, request, signal, onProgress: progress });
    progress(98, '保存到浏览器…');
    await commitSnapshot(cacheKey(), snapshot);
    state.snapshot = snapshot;
    state.page = 1;
    renderSnapshot();
    progress(100, '更新完成');
    notice(`已更新 ${format(snapshot.games.length)} 款作品，数据已保存在这个浏览器。${snapshot.missingStats ? `其中 ${snapshot.missingStats} 款未返回关注或评分统计，相关指标显示为空。` : ''}`);
  } catch (error) {
    const cancelled = signal.aborted;
    controller.abort();
    notice(cancelled ? '更新已取消，原有缓存和收藏均已保留。' : `${error.message || '更新失败，请检查网络后重试。'}${state.snapshot ? ' 你仍可查看上次缓存。' : ''}`, !cancelled);
  } finally {
    setLoading(false);
    state.controller = null;
  }
}

function renderSnapshot() {
  const snapshot = state.snapshot;
  document.body.classList.toggle('has-data', Boolean(snapshot));
  const totals = snapshot ? summary(snapshot.games) : null;
  $('stat-count').textContent = totals ? format(totals.count) : '—';
  $('stat-heat').textContent = totals ? compact(totals.heat) : '—';
  $('stat-heat').title = totals ? format(totals.heat) : '';
  $('stat-median').textContent = totals ? format(totals.median) : '—';
  $('stat-rated').textContent = totals ? format(totals.rated) : '—';
  $('stat-coverage').textContent = snapshot ? `目录 ${format(snapshot.expectedCount)} 款 · 全部明细已获取` : '等待获取官方目录';
  $('sync-time').textContent = snapshot ? stamp(snapshot.fetchedAt) : '从最新数据开始';
  const local = canRefresh();
  $('sync-caption').textContent = snapshot ? '数据时间如上。筛选、排序和收藏均在当前浏览器完成。' : '正在载入已发布的榜单。';
  $('sync-footnote').textContent = local ? '本机直接获取 · 手动更新 · 浏览器缓存' : '每小时计划更新 · 以上为实际数据时间';
  $('runtime-label').textContent = local ? '本机运行' : '静态榜单';
  $('local-guide').hidden = local;
  $('data-route').textContent = local ? '本机服务只转发 TapTap 公开读取请求，不需要账号或云服务器。可以手动更新，并将最近两份榜单保存到当前浏览器。' : '定时任务每小时采集 TapTap 公开数据，将完整榜单提交到公开仓库并部署。网页读取已发布的文件，不运行云端转发。采集失败时保留上一份榜单；计划任务可能延迟，请以实际数据时间为准。';
  const event = snapshot?.event;
  if (event?.year && event?.event_name) $('event-eyebrow').textContent = `${event.year} ${event.brand?.name || 'TapTap 聚光灯'} · ${event.event_name}`;
  renderFilters();
  const times = snapshot?.games.map(g => g.rankUpdatedAt).filter(Boolean) || [];
  const rankTime = times.length ? stamp(Math.max(...times) * 1000) : '接口未返回';
  $('about-snapshot').textContent = snapshot ? `本次获取：${stamp(snapshot.fetchedAt)}；试玩人气榜刷新时间：${rankTime}。目录 ${format(snapshot.expectedCount)} 款，已获取 ${format(snapshot.games.length)} 款，缺少统计 ${snapshot.missingStats || 0} 款。${snapshot.previousAt ? `热度变化的对照快照：${stamp(snapshot.previousAt)}。` : '首次获取还没有热度变化的对照快照。'}` : '尚无快照。';
  $('cache-size').textContent = snapshot ? `当前快照约 ${(new Blob([JSON.stringify(snapshot)]).size / 1024 / 1024).toFixed(1)} MB` : '暂无作品缓存';
  $('clear-cache').disabled = !snapshot || state.loading;
  setLoading(state.loading);
  renderRanking();
}

function metricValue(game) {
  const value = game[metrics[state.metric].field];
  if (state.metric === 'rating') return Number(value).toFixed(1);
  if (state.metric === 'official') return `#${format(value)}`;
  if (state.metric === 'growth') return `${value > 0 ? '+' : ''}${format(value)}`;
  return format(value);
}

function rankDeltaMarkup(game) {
  if (!game.rankStatus) return '';
  if (game.rankStatus === 'new') return '<span class="rank-delta new" title="上次榜单没有这款作品">新</span>';
  if (game.rankStatus === 'flat') return '<span class="rank-delta flat" title="名次与上次持平">—</span>';
  const up = game.rankStatus === 'up';
  return `<span class="rank-delta ${up ? 'up' : 'down'}" title="较上次${up ? '上升' : '下降'} ${Math.abs(game.rankDelta)} 名">${up ? '▲' : '▼'}${Math.abs(game.rankDelta)}</span>`;
}

function imageMarkup(game) {
  let url;
  try { url = new URL(game.icon); } catch {}
  if (url?.protocol === 'https:' && (url.hostname === 'tapimg.com' || url.hostname.endsWith('.tapimg.com'))) {
    return `<span class="game-icon"><img src="${escape(url.href)}" alt="${escape(game.title)}图标" loading="lazy" referrerpolicy="no-referrer"></span>`;
  }
  return `<span class="game-icon" aria-hidden="true">${escape(game.title.slice(0, 1))}</span>`;
}

function renderRanking() {
  selection = selectGames(state.snapshot, state);
  const maxPage = Math.max(1, Math.ceil(selection.rows.length / state.pageSize));
  state.page = Math.min(state.page, maxPage);
  $('result-count').textContent = state.snapshot ? `${format(selection.rows.length)} 款作品` : '尚无数据';
  $('primary-column').textContent = metrics[state.metric].label.replace('榜', '');
  let hint = metrics[state.metric].hint;
  if (state.metric === 'official' && state.snapshot) {
    const times = state.snapshot.games.map(g => g.rankUpdatedAt).filter(Boolean);
    hint = `TapTap 试玩人气榜的前 ${format(selection.rankedCount)} 名${times.length ? ` · 排名刷新 ${stamp(Math.max(...times) * 1000)}` : ''}。按助力数排序，试玩满 10 分钟才能助力；名次取接口原值，不是评审成绩。`;
  }
  if (state.metric === 'growth' && state.snapshot?.previousAt) hint = `热度变化：${stamp(state.snapshot.previousAt)} → ${stamp(state.snapshot.fetchedAt)}。新出现的作品不参与增量排名。`;
  if (state.metric !== 'growth' && selection.hasPrev && state.snapshot?.previousAt) {
    hint += selection.rankComparable === false
      ? ' 上一份榜单的名次按热度排，与现在的人气榜口径不同，本轮不显示名次变动。'
      : ` 名次变动对比 ${stamp(state.snapshot.previousAt)} 的同一筛选结果，新＝上次未上榜。`;
  }
  $('metric-description').textContent = hint;
  $('rating-filter').hidden = state.metric !== 'rating';
  if (state.metric !== 'rating') reviewDropdown.close();
  const activeFilters = Object.keys(filterLabels).filter(key => state[key] !== 'all');
  const hasFilters = Boolean(activeFilters.length || state.query || state.favoritesOnly || (state.metric === 'rating' && state.minReviews !== 5));
  $('reset-filters').disabled = !hasFilters;
  $('empty-reset').hidden = !state.snapshot || !hasFilters;
  $('filter-summary').textContent = activeFilters.length ? activeFilters.map(key => dropdowns[key].valueLabel.textContent).join(' · ') : '全部作品';
  $('favorite-count').textContent = state.favorites.length;
  $('favorites-button').setAttribute('aria-pressed', state.favoritesOnly);
  document.querySelectorAll('[data-metric]').forEach(button => {
    const active = button.dataset.metric === state.metric;
    button.classList.toggle('active', active);
    button.setAttribute('aria-pressed', active);
  });
  const start = (state.page - 1) * state.pageSize;
  const visible = selection.rows.slice(start, start + state.pageSize);
  $('ranking-body').innerHTML = visible.map(game => {
    const favorite = state.favorites.includes(game.id);
    const labels = game.categories.map(id => state.snapshot.categories.find(c => c.id === id)?.title).filter(Boolean);
    const meta = labels.filter(label => !['手游', 'PC游戏'].includes(label)).slice(0, 2);
    const sub = state.metric === 'growth' ? `当前热度 ${format(game.heat)}` : state.metric === 'official' ? `${compact(game.heat)}人试玩` : '';
    return `<tr><td class="rank-cell ${game.place <= 3 ? 'top-rank' : ''}"><div class="rank-stack"><span class="rank-place">${game.place <= 9 ? '0' : ''}${game.place}</span>${rankDeltaMarkup(game)}</div></td><td><div class="game-info">${imageMarkup(game)}<div class="game-text"><a class="game-title" href="https://www.taptap.cn/app/${game.id}" target="_blank" rel="noopener noreferrer" title="${escape(game.title)}">${escape(game.title)}</a><div class="game-meta">${meta.map(label => `<span class="tag">${escape(label)}</span>`).join('')}<span class="game-id">${game.id}</span></div></div></div></td><td class="number-cell primary-value ${state.metric === 'growth' && game.growth > 0 ? 'positive' : ''}">${metricValue(game)}${sub ? `<span class="metric-sub">${sub}</span>` : ''}</td><td class="number-cell detail-cell">${game.votes ? format(game.votes) : '<span class="muted">—</span>'}</td><td class="number-cell detail-cell">${format(game.fans)}</td><td class="number-cell detail-cell"><span class="score-value">${game.rating === null ? '<span class="muted">暂无评分</span>' : `<span>✦</span>${game.rating.toFixed(1)}`}</span><span class="metric-sub">${format(game.reviews)} 条评价</span></td><td><button class="favorite-toggle" data-favorite="${game.id}" aria-label="${favorite ? '取消收藏' : '收藏'} ${escape(game.title)}" aria-pressed="${favorite}" title="${favorite ? '取消收藏' : '收藏'}">${favorite ? '★' : '☆'}</button></td></tr>`;
  }).join('');
  $('table-shell').hidden = !visible.length;
  $('empty-state').hidden = Boolean(visible.length);
  $('table-footer').hidden = !visible.length;
  $('export-button').disabled = !selection.rows.length;
  if (!visible.length) {
    let title = '没有符合条件的作品';
    let description = `当前筛选：${$('filter-summary').textContent}。试试放宽条件，或重置筛选。`;
    if (!state.snapshot) { title = '让本届作品，在这里涌现'; description = canRefresh() ? '点击「获取本届数据」，从本机获取榜单。' : '已发布榜单暂时无法载入。请重新打开页面，或按上方说明在本地运行。'; }
    else if (state.metric === 'growth' && !state.snapshot.previousAt) { title = '下一次更新，就能看见变化'; description = '首次快照已保存。稍后再次更新，即可比较两次获取之间的热度变化。'; }
    else if (state.metric === 'official' && !selection.rankedCount) { title = '这一分组还没有作品进入人气榜前 100'; description = '试玩人气榜只公开前 100 名。可以切换到活动热度、关注或评分榜，查看本地计算的排序。'; }
    else if (state.metric === 'rating' && !selection.rankedCount) { title = '暂无符合评价数门槛的作品'; description = '降低最低评价数，或查看其他作品分组。'; }
    $('empty-title').textContent = title;
    $('empty-description').textContent = description;
  }
  $('page-info').textContent = `${format(start + 1)}–${format(Math.min(start + state.pageSize, selection.rows.length))} / ${format(selection.rows.length)} 款`;
  $('page-label').textContent = `${state.page} / ${maxPage}`;
  $('prev-page').disabled = state.page <= 1;
  $('next-page').disabled = state.page >= maxPage;
}

async function savePreferences() {
  try { await write('preferences', { favorites: state.favorites, metric: state.metric, minReviews: state.minReviews, filters: Object.fromEntries(Object.keys(filterLabels).map(key => [key, state[key]])) }); }
  catch (error) { notice(error.message, true); }
}

$('refresh-button').addEventListener('click', () => refresh().catch(error => notice(error.message, true)));
$('cancel-button').addEventListener('click', () => state.controller?.abort());
$('search').addEventListener('input', event => { state.query = event.target.value; state.page = 1; renderRanking(); });
$('reset-filters').addEventListener('click', resetFilters);
$('empty-reset').addEventListener('click', resetFilters);
$('favorites-button').addEventListener('click', () => { state.favoritesOnly = !state.favoritesOnly; state.page = 1; renderRanking(); });
$('metric-tabs').addEventListener('click', event => {
  const button = event.target.closest('[data-metric]');
  if (!button) return;
  state.metric = button.dataset.metric; state.page = 1; renderRanking(); savePreferences();
});
$('ranking-body').addEventListener('click', event => {
  const button = event.target.closest('[data-favorite]');
  if (!button) return;
  const id = button.dataset.favorite;
  state.favorites = state.favorites.includes(id) ? state.favorites.filter(v => v !== id) : [...state.favorites, id];
  renderRanking(); savePreferences();
});
$('ranking-body').addEventListener('error', event => {
  if (event.target.tagName === 'IMG') {
    const holder = event.target.parentElement;
    holder.textContent = event.target.alt.slice(0, 1);
  }
}, true);
for (const [id, delta] of [['prev-page', -1], ['next-page', 1]]) {
  $(id).addEventListener('click', () => { state.page += delta; renderRanking(); $('metric-tabs').scrollIntoView({ block: 'start', behavior: 'auto' }); });
}
$('export-button').addEventListener('click', () => {
  const url = URL.createObjectURL(new Blob([csv(selection.rows)], { type: 'text/csv;charset=utf-8;' }));
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = `聚光榜_${metrics[state.metric].label}_${new Date(state.snapshot.fetchedAt).toISOString().slice(0, 10)}.csv`;
  anchor.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
});
$('about-button').addEventListener('click', () => $('about-dialog').showModal());
$('close-about').addEventListener('click', () => $('about-dialog').close());
$('about-dialog').addEventListener('click', event => { if (event.target === $('about-dialog')) { const box = event.target.getBoundingClientRect(); if (event.clientX < box.left || event.clientX > box.right || event.clientY < box.top || event.clientY > box.bottom) event.target.close(); } });
$('clear-cache').addEventListener('click', async () => {
  if (!$('clear-cache').dataset.confirm) {
    $('clear-cache').dataset.confirm = 'true'; $('clear-cache').textContent = '再次点击确认清除';
    clearTimer = setTimeout(() => { delete $('clear-cache').dataset.confirm; $('clear-cache').textContent = '清除作品缓存'; }, 6000);
    return;
  }
  clearTimeout(clearTimer);
  try { await clearSnapshots(cacheKey()); state.snapshot = null; state.page = 1; renderSnapshot(); notice('作品快照已清除，收藏仍保留在本浏览器。'); }
  catch (error) { notice(error.message, true); }
  delete $('clear-cache').dataset.confirm; $('clear-cache').textContent = '清除作品缓存';
});
document.addEventListener('keydown', event => {
  if (event.key === '/' && !['INPUT', 'SELECT', 'TEXTAREA'].includes(document.activeElement.tagName) && !$('about-dialog').open) { event.preventDefault(); $('search').focus(); }
});

async function init() {
  $('refresh-button').disabled = true;
  try {
    state.config = await request('/runtime.json', undefined, false);
    let cached = null;
    try {
      const [snapshot, preferences] = await Promise.all([read(cacheKey()), read('preferences')]);
      if (snapshot) cached = validateSnapshot(snapshot, state.config);
      if (preferences) {
        state.favorites = Array.isArray(preferences.favorites) ? preferences.favorites.map(String) : [];
        if (metrics[preferences.metric]) state.metric = preferences.metric;
        if ([0, 5, 10, 30].includes(preferences.minReviews)) state.minReviews = preferences.minReviews;
        for (const key of Object.keys(filterLabels)) if (typeof preferences.filters?.[key] === 'string') state[key] = preferences.filters[key];
      }
    } catch { notice('浏览器缓存暂不可用，本次仍可读取已发布榜单。'); }
    state.snapshot = cached;
    renderSnapshot();
    try {
      const published = validateSnapshot(await request('/data/latest.json', undefined, false), state.config);
      state.snapshot = newerSnapshot(cached, published);
      if (state.snapshot !== cached) {
        try { await commitSnapshot(cacheKey(), state.snapshot); }
        catch { notice('榜单已载入，但浏览器未允许保存缓存。'); }
      }
    } catch {
      if (!canRefresh()) notice(cached ? '暂时无法载入已发布榜单，正在显示上次缓存。' : '已发布榜单暂时无法载入，请稍后重新打开页面。', !cached);
    }
    renderSnapshot();
    if (state.snapshot && Date.now() - state.snapshot.fetchedAt > 3 * 60 * 60 * 1000) notice(canRefresh() ? '当前数据已超过三小时，可点击更新。' : '当前数据已超过三小时，定时更新可能延迟或失败。可在公开仓库查看任务状态，或自行本地更新。');
  } catch (error) { notice(error.message || '页面配置未载入，请重新打开页面。', true); }
}

renderFilters();
init();
