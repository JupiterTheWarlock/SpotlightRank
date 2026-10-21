import test from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { readFile, readdir } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';

test('公开发布只包含静态文件，配置禁止手动更新且不会带入旧云端转发', async () => {
  const root = fileURLToPath(new URL('../', import.meta.url));
  execFileSync(process.execPath, ['scripts/build-pages.mjs'], { cwd: root });
  const files = await readdir(new URL('../dist/pages/', import.meta.url));
  assert.ok(!files.includes('_worker.js'));
  assert.ok(!files.includes('_routes.json'));
  assert.ok(!files.includes('server.mjs'));
  assert.ok(files.includes('404.html'));
  const config = JSON.parse(await readFile(new URL('../dist/pages/runtime.json', import.meta.url), 'utf8'));
  assert.equal(config.runtime, 'static');
  assert.equal(config.canRefresh, false);
  const data = JSON.parse(await readFile(new URL('../dist/pages/data/latest.json', import.meta.url), 'utf8'));
  assert.equal(data.games.length, data.expectedCount);
  assert.ok(data.games.length > 0);
});
