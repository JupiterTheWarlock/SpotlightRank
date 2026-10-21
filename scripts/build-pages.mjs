import { mkdir, readFile, writeFile, copyFile, readdir } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const output = path.join(root, 'dist', 'pages');
await mkdir(output, { recursive: true });
const files = ['index.html', 'app.js', 'model.js', 'dropdown.js', 'storage.js', 'styles.css', 'favicon.svg'];
const allowed = new Set([...files, '_worker.js', '_routes.json', '_headers']);
for (const file of await readdir(output)) if (!allowed.has(file)) throw new Error(`发布目录含有未批准文件：${file}。请先移出后重试。`);
for (const file of files) await copyFile(path.join(root, 'public', file), path.join(output, file));
const settings = JSON.parse(await readFile(path.join(root, 'app.config.json'), 'utf8'));
const upstream = await readFile(path.join(root, 'upstream.js'), 'utf8');
const worker = (await readFile(path.join(root, 'cloudflare', 'worker.js'), 'utf8')).replace(/^import .*;\r?\n/gm, '');
await writeFile(path.join(output, '_worker.js'), `${upstream}\nconst settings = ${JSON.stringify(settings)};\n${worker}`);
await writeFile(path.join(output, '_routes.json'), JSON.stringify({ version: 1, include: ['/api/*'], exclude: [] }, null, 2));
await writeFile(path.join(output, '_headers'), `/*
  X-Content-Type-Options: nosniff
  Referrer-Policy: no-referrer
  Content-Security-Policy: default-src 'self'; img-src 'self' https://*.tapimg.com data:; connect-src 'self'; style-src 'self'; script-src 'self'; object-src 'none'; base-uri 'none'; frame-ancestors 'none'
  Cache-Control: no-cache
`);
console.log(`已生成 Pages 发布目录：${output}（${allowed.size} 个文件，无作品数据）`);
