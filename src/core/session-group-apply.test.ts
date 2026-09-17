/**
 * 应用层的用例：注册表搬迁、计数字段、两条拒绝路径（projectKey 反查不到、header 改写失败）。
 * 会话文件用 node:zlib 现场造多帧容器；readSession/projectKeyFor 都是注入的假实现，不碰磁盘。
 */
import assert from 'node:assert/strict';
import { zstdCompressSync, zstdDecompressSync } from 'node:zlib';
import test from 'node:test';
import { applyGroupingPlan, type GroupingRegistry } from './session-group-apply.ts';
import { decompressAllFrames } from './session-files.ts';
import type { GroupingPlanItem } from './session-group-plan.ts';

function sessionFile(cwd: string, batches: string[] = ['{"a":1}']): Buffer {
  const frames = [zstdCompressSync(Buffer.from(JSON.stringify({ id: 'sess-1', cwd }) + '\n', 'utf8'))];
  for (const b of batches) frames.push(zstdCompressSync(Buffer.from(b + '\n', 'utf8')));
  return Buffer.concat(frames);
}

function registry(): GroupingRegistry {
  return {
    table: {
      'w-a': { path: '/root/workspace/456', sessionIds: ['old-session'], archivedSessionIds: ['archived-1'], updatedAt: 'old' },
      'w-b': { path: '/root/workspace/789', sessionIds: ['sess-1'] },
    },
  };
}

const ITEM: GroupingPlanItem = {
  id: 'sess-1',
  rel: '--root-workspace-456--/session-sess-1/session.jsonl.zstd',
  action: 'rewrite+group',
  workspace: 'w-a',
  how: 'mapped',
  from: '/old/path',
  to: '/root/workspace/456',
  needsRewrite: true,
};

test('改写 header 并把会话从别的工作区摘掉（一个会话只属于一个工作区）', () => {
  const out = applyGroupingPlan({
    items: [ITEM],
    registry: registry(),
    readSession: () => sessionFile('/old/path'),
    projectKeyFor: () => '--root-workspace-456--',
    now: () => '2026-01-01T00:00:00.000Z',
  });
  assert.equal(out.report.grouped, 1);
  assert.equal(out.report.groupedSessions, 1);
  assert.equal(out.report.rewritten, 1);
  assert.equal(out.report.moved, 1); // 原先在 w-b 里
  assert.equal(out.report.ungrouped.length, 0);
  assert.deepEqual(out.registry.table['w-b']?.sessionIds, []);
  assert.deepEqual(out.registry.table['w-a']?.sessionIds, ['old-session', 'sess-1']);
  assert.equal(out.registry.table['w-a']?.updatedAt, '2026-01-01T00:00:00.000Z');
  // 未知键原样保留
  assert.deepEqual(out.registry.table['w-a']?.archivedSessionIds, ['archived-1']);
  const [action] = out.actions;
  assert.ok(action);
  assert.equal(action.to, '--root-workspace-456--/session-sess-1/session.jsonl.zstd');
  assert.equal(action.removeFrom, false); // 同路径：不删源
  const content = action.content;
  assert.ok(content);
  const text = (decompressAllFrames(content) as Buffer).toString('utf8');
  assert.match(text, /"cwd":"\/root\/workspace\/456"/);
  const body = (decompressAllFrames(content) as Buffer).toString('utf8').split('\n').slice(1).join('\n');
  assert.equal(body, '{"a":1}\n'); // 批次字节没被动
});

test('needsRewrite=false 时不读文件、不改写（只进注册表）', () => {
  const out = applyGroupingPlan({
    items: [{ ...ITEM, action: 'group', needsRewrite: false, how: 'exact', to: '/root/workspace/456' }],
    registry: registry(),
    readSession: () => {
      throw new Error('不该读文件');
    },
    projectKeyFor: () => 'pk',
  });
  assert.equal(out.report.rewritten, 0);
  assert.equal(out.report.grouped, 1);
  const [action] = out.actions;
  assert.ok(action);
  assert.equal(action.content, null);
});

test('projectKey 反查不到 → 报 ungrouped，不动注册表也不给文件动作', () => {
  const out = applyGroupingPlan({
    items: [ITEM],
    registry: registry(),
    readSession: () => sessionFile('/old/path'),
    projectKeyFor: () => null,
  });
  assert.equal(out.report.grouped, 0);
  assert.equal(out.actions.length, 0);
  const [first] = out.report.ungrouped;
  assert.ok(first);
  assert.equal(first.reason, '找不到目标工作区的 projectKey 目录（不敢猜）');
  assert.deepEqual(out.registry.table['w-b']?.sessionIds, ['sess-1']); // 没被摘走
});

test('header 改写失败（第 1 帧不是单行）→ 报 ungrouped，绝不写入可疑内容', () => {
  const broken = zstdCompressSync(Buffer.from('{"id":"sess-1"}\n{"oops":true}\n', 'utf8'));
  const out = applyGroupingPlan({
    items: [ITEM],
    registry: registry(),
    readSession: () => broken,
    projectKeyFor: () => 'pk',
  });
  assert.equal(out.actions.length, 0);
  const [first] = out.report.ungrouped;
  assert.ok(first);
  assert.equal(first.reason, '无法安全改写 header 帧');
});

test('会话文件读不出来 → 报 ungrouped', () => {
  const out = applyGroupingPlan({
    items: [ITEM],
    registry: registry(),
    readSession: () => null,
    projectKeyFor: () => 'pk',
  });
  assert.equal(out.actions.length, 0);
  assert.equal(out.report.ungrouped[0]?.reason, '会话文件读不出来');
});

test('跨目录移动时 removeFrom=true，且 inferred 计入报告', () => {
  const out = applyGroupingPlan({
    items: [
      {
        ...ITEM,
        rel: 'old-pk/session-sess-1/session.v3.jsonl.zstd',
        action: 'group',
        needsRewrite: false,
        how: 'inferred',
      },
    ],
    registry: registry(),
    readSession: () => null,
    projectKeyFor: () => '--root-workspace-456--',
  });
  assert.equal(out.report.ungrouped.length, 0);
  const [action] = out.actions;
  assert.ok(action);
  assert.equal(action.to, '--root-workspace-456--/session-sess-1/session.v3.jsonl.zstd'); // 原文件名保留
  assert.equal(action.removeFrom, true);
  assert.equal(out.report.inferred.length, 1);
  assert.equal(out.report.inferred[0]?.workspace, 'w-a');
});
