import { readFile, mkdir, writeFile, rename, rm } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { collectSnapshot } from '../public/collector.js';
import { validateSnapshot } from '../public/snapshot.js';
import { upstreamUrl } from '../upstream.js';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const config = JSON.parse(await readFile(path.join(root, 'app.config.json'), 'utf8'));
const target = path.join(root, 'public', 'data', 'latest.json');
let previous = null;
try { previous = validateSnapshot(JSON.parse(await readFile(target, 'utf8')), config); }
catch (error) { if (error.code !== 'ENOENT') throw error; }
const controller = new AbortController();
const deadline = setTimeout(() => controller.abort(), 8 * 60 * 1000);
let lastProgress = -1;
async function request(route, signal, retry = true) {
  const url = new URL(route, 'http://localhost');
  try {
    const response = await fetch(upstreamUrl(url.pathname, url.searchParams, config), {
      headers: { Accept: 'application/json', 'User-Agent': 'Mozilla/5.0' },
      signal: AbortSignal.any([signal, AbortSignal.timeout(25000)]), redirect: 'error',
    });
    if (!response.ok) {
      const error = new Error(`TapTap 返回 HTTP ${response.status}`);
      error.status = response.status;
      throw error;
    }
    const data = await response.json();
    if (data.success !== true) throw new Error('TapTap 没有返回有效数据');
    return data;
  } catch (error) {
    if (retry && !signal.aborted && error.status !== 429 && (!error.status || error.status >= 500)) {
      await new Promise(resolve => setTimeout(resolve, 1500));
      return request(route, signal, false);
    }
    throw error;
  }
}
try {
  const snapshot = await collectSnapshot({ config, previous, request, signal: controller.signal,
    onProgress(value, message) { const step = Math.floor(value / 10); if (step !== lastProgress) { lastProgress = step; console.log(message); } },
  });
  await mkdir(path.dirname(target), { recursive: true });
  // Replace only after the complete collection and validation succeed.
  await writeFile(`${target}.tmp`, JSON.stringify(snapshot, null, 2) + '\n');
  await rename(`${target}.tmp`, target);
  console.log(`已保存 ${snapshot.games.length} 款作品；数据时间 ${new Date(snapshot.fetchedAt).toISOString()}。`);
} catch (error) {
  controller.abort();
  await rm(`${target}.tmp`, { force: true });
  console.error(`采集未完成，旧榜单未覆盖：${error.message}`);
  process.exitCode = 1;
} finally { clearTimeout(deadline); }
