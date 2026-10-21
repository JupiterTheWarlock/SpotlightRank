import path from 'node:path';
import { fileURLToPath } from 'node:url';

const repository = 'JupiterTheWarlock/SpotlightRank';
const workflowPath = `/repos/${repository}/actions/workflows/update.yml`;
const hour = 60 * 60 * 1000;

export function decideUpdate({ runs, lastSuccess, now = Date.now() }) {
  if (!Array.isArray(runs) || !Number.isFinite(now)) throw new Error('无法确认工作流状态，停止检查');
  if (runs.some(run => ['queued', 'in_progress', 'waiting', 'pending', 'requested'].includes(run.status))) {
    return { due: false, reason: '已有更新任务等待或正在运行，本次不重复启动。' };
  }
  if (!lastSuccess) return { due: true, reason: '还没有成功发布记录，需要获取榜单。' };
  const publishedAt = Date.parse(lastSuccess.updated_at);
  if (lastSuccess.status !== 'completed' || lastSuccess.conclusion !== 'success' || !Number.isFinite(publishedAt) || publishedAt > now + 5 * 60 * 1000) {
    throw new Error('成功发布时间无效，停止检查');
  }
  const elapsed = now - publishedAt;
  return { due: elapsed >= hour, reason: elapsed >= hour ? '距上次成功发布已满一小时，需要更新。' : '上次成功发布还不到一小时，本次保留当前榜单。' };
}

export async function scheduleUpdate({ request, now = Date.now() }) {
  const [recent, successful] = await Promise.all([
    request(`${workflowPath}/runs?per_page=100`),
    request(`${workflowPath}/runs?status=success&per_page=1`),
  ]);
  if (!Array.isArray(recent?.workflow_runs) || !Array.isArray(successful?.workflow_runs)) throw new Error('GitHub 没有返回有效的运行记录');
  const decision = decideUpdate({ runs: recent.workflow_runs, lastSuccess: successful.workflow_runs[0], now });
  if (decision.due) await request(`${workflowPath}/dispatches`, { method: 'POST', body: { ref: 'main' } });
  return decision;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    if (process.env.GITHUB_REPOSITORY !== repository) throw new Error('只允许在原站仓库运行发布检查');
    const token = process.env.GITHUB_TOKEN;
    if (!token) throw new Error('缺少 GitHub 工作流令牌');
    const request = async (route, { method = 'GET', body } = {}) => {
      const response = await fetch(`https://api.github.com${route}`, {
        method,
        headers: { Accept: 'application/vnd.github+json', Authorization: `Bearer ${token}`, 'Content-Type': 'application/json', 'User-Agent': 'SpotlightRank-scheduler' },
        body: body ? JSON.stringify(body) : undefined,
        signal: AbortSignal.timeout(20000),
        redirect: 'error',
      });
      if (!response.ok) throw new Error(`GitHub 返回 HTTP ${response.status}`);
      return response.status === 204 ? null : response.json();
    };
    const decision = await scheduleUpdate({ request });
    console.log(decision.reason);
    if (decision.due) console.log('已请求启动采集与发布；最终结果以发布工作流为准。');
  } catch (error) {
    console.error(`定时检查未完成：${error.message}`);
    process.exitCode = 1;
  }
}
