export function upstreamUrl(route, search, config) {
  const url = new URL('https://www.taptap.cn');
  if (route === '/api/categories') {
    url.pathname = '/webapiv2/activity/game-jam/v1/get-categories';
    url.searchParams.set('id', config.gameJamId);
  } else if (route === '/api/event') {
    url.pathname = '/webapiv2/activity/game-jam/v1/event-detail';
    url.searchParams.set('event_id', config.eventId);
  } else if (route === '/api/games' || route === '/api/stats') {
    const raw = search.get('ids') || '';
    const ids = raw.split(',');
    const limit = route === '/api/games' ? 100 : 20;
    if (!/^\d+(,\d+)*$/.test(raw) || ids.length > limit || ids.some(id => id.length > 12)) {
      throw new Error(`作品编号格式不正确，单次最多 ${limit} 个。`);
    }
    url.pathname = route === '/api/games' ? '/webapiv2/activity/game-jam/v1/game-multi-get' : '/webapiv2/app/v1/multi-get-full-platform';
    if (route === '/api/games') url.searchParams.set('id', config.gameJamId);
    url.searchParams.set(route === '/api/games' ? 'identifications' : 'ids', [...new Set(ids)].join(','));
  } else return null;
  url.searchParams.set('X-UA', 'V=1&PN=WebApp&LANG=zh_CN&VN_CODE=100000000&LOC=CN&PLT=PC&DS=Android');
  return url;
}
