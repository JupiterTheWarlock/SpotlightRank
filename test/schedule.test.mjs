import test from 'node:test';
import assert from 'node:assert/strict';
import { decideUpdate, scheduleUpdate } from '../scripts/schedule-update.mjs';

const now = Date.parse('2026-10-22T01:00:00Z');
const success = age => ({ status: 'completed', conclusion: 'success', updated_at: new Date(now - age).toISOString() });

test('按成功发布间隔控制采集，未满一小时不重复，满一小时或首次需要更新', () => {
  assert.equal(decideUpdate({ runs: [], lastSuccess: success(3599999), now }).due, false);
  assert.equal(decideUpdate({ runs: [], lastSuccess: success(3600000), now }).due, true);
  assert.equal(decideUpdate({ runs: [], lastSuccess: null, now }).due, true);
});

test('正在等待或运行的更新不会重复启动，失败的发布不会掩盖旧成功时间', () => {
  for (const status of ['queued', 'in_progress', 'waiting', 'pending', 'requested']) {
    assert.equal(decideUpdate({ runs: [{ status }], lastSuccess: success(7200000), now }).due, false);
  }
  assert.equal(decideUpdate({ runs: [{ status: 'completed', conclusion: 'failure' }], lastSuccess: success(7200000), now }).due, true);
  assert.throws(() => decideUpdate({ runs: [], lastSuccess: { ...success(0), updated_at: 'invalid' }, now }));
});

test('只在需要更新时调用默认分支发布，不把接口错误当成更新成功', async () => {
  for (const age of [60000, 7200000]) {
    const dispatches = [];
    const request = async (route, options) => {
      if (options?.method === 'POST') { dispatches.push({ route, options }); return null; }
      return { workflow_runs: route.includes('status=success') ? [success(age)] : [] };
    };
    const result = await scheduleUpdate({ request, now });
    assert.equal(result.due, age >= 3600000);
    assert.equal(dispatches.length, age >= 3600000 ? 1 : 0);
    if (dispatches.length) {
      assert.equal(dispatches[0].route, '/repos/JupiterTheWarlock/SpotlightRank/actions/workflows/update.yml/dispatches');
      assert.deepEqual(dispatches[0].options.body, { ref: 'main' });
    }
  }
  await assert.rejects(scheduleUpdate({ request: async () => ({}), now }));
  await assert.rejects(scheduleUpdate({ request: async (route, options) => {
    if (options?.method === 'POST') throw new Error('HTTP 403');
    return { workflow_runs: [] };
  }, now }), /403/);
});
