import { mkdir, readFile, writeFile, copyFile, readdir, rm } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { validateSnapshot } from '../public/snapshot.js';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const output = path.join(root, 'dist', 'pages');
const settings = JSON.parse(await readFile(path.join(root, 'app.config.json'), 'utf8'));
const snapshot = validateSnapshot(JSON.parse(await readFile(path.join(root, 'public/data/latest.json'), 'utf8')), settings);
await mkdir(path.join(output, 'data'), { recursive: true });
// Remove only the two known generated proxy files from earlier builds.
for (const file of ['_worker.js', '_routes.json']) await rm(path.join(output, file), { force: true });
const files = ['index.html', 'app.js', 'model.js', 'collector.js', 'snapshot.js', 'dropdown.js', 'storage.js', 'styles.css', 'favicon.svg'];
const allowed = new Set([...files, 'runtime.json', '404.html', 'data', '_headers']);
for (const file of await readdir(output)) if (!allowed.has(file)) throw new Error(`发布目录含有未批准文件：${file}。请先移出后重试。`);
for (const file of await readdir(path.join(output, 'data'))) if (file !== 'latest.json') throw new Error(`发布数据目录含有未批准文件：${file}`);
const sources = new Map(await Promise.all(files.map(async file => [file, await readFile(path.join(root, 'public', file), 'utf8')])));
const assetVersion = createHash('sha256').update([...sources.values()].join('\0')).digest('hex').slice(0, 12);
for (const [file, source] of sources) {
  let content = source;
  if (file.endsWith('.js')) content = content.replace(/(\bfrom\s+['"]\.\/[^'"]+\.js)(['"])/g, `$1?v=${assetVersion}$2`);
  if (file === 'index.html') content = content.replace(/\/(app\.js|styles\.css)(?:\?v=[^"\s]*)?/g, `/$1?v=${assetVersion}`);
  await writeFile(path.join(output, file), content);
}
await writeFile(path.join(output, 'data/latest.json'), JSON.stringify(snapshot));
await writeFile(path.join(output, 'runtime.json'), JSON.stringify({ eventId: settings.eventId, gameJamId: settings.gameJamId, version: '0.3.0', runtime: 'static', canRefresh: false }));
await writeFile(path.join(output, '404.html'), '<!doctype html><meta charset="utf-8"><title>页面不存在</title><p>这是静态榜单，不提供在线更新接口。</p><a href="/">返回聚光榜</a>');
await writeFile(path.join(output, '_headers'), `/*
  X-Content-Type-Options: nosniff
  Referrer-Policy: no-referrer
  Content-Security-Policy: default-src 'self'; img-src 'self' https://*.tapimg.com data:; connect-src 'self'; style-src 'self'; script-src 'self'; object-src 'none'; base-uri 'none'; frame-ancestors 'none'
  Cache-Control: no-cache
/data/latest.json
  Cache-Control: public, max-age=0, must-revalidate
`);
console.log(`已生成纯静态 Pages 目录：${output}，${snapshot.games.length} 款作品，无 Worker 或在线 API。`);
