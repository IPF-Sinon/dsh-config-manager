/**
 * 归组规划的三条选路（exact / mapped / inferred）与两条拒绝路径。
 * canonical 注入成「直接把路径当已存在」的假实现，这些用例测的是决策而不是文件系统。
 */
import assert from 'node:assert/strict';
import test from 'node:test';
import { planGrouping, type GroupingWorkspace } from './session-group-plan.ts';

const WS: GroupingWorkspace[] = [
  { id: 'w-456', path: '/root/workspace/456' },
  { id: 'w-789', path: '/root/workspace/789' },
];
/** 假 canonical：把路径原样返回（都当作存在）。 */
const passThrough = (p: string): string => p;

test('exact：cwd 就是已注册工作区路径 → 不需要改写 header', () => {
  const plan = planGrouping({
    sessions: [{ rel: '--root-workspace-456--/session-a/session.jsonl.zstd', id: 'a', cwd: '/root/workspace/456' }],
    workspaces: WS,
    canonical: passThrough,
  });
  assert.equal(plan.ungrouped.length, 0);
  const [first] = plan.items;
  assert.ok(first);
  assert.equal(first.how, 'exact');
  assert.equal(first.workspace, 'w-456');
  assert.equal(first.needsRewrite, false);
  assert.equal(first.action, 'group');
});

test('mapped：显式映射命中已注册工作区 → 需要改写 header', () => {
  const plan = planGrouping({
    sessions: [{ rel: 'p/session-a/session.jsonl.zstd', id: 'a', cwd: '/old/device/path' }],
    workspaces: WS,
    maps: new Map([['/old/device/path', '/root/workspace/789']]),
    canonical: passThrough,
  });
  const [first] = plan.items;
  assert.ok(first);
  assert.equal(first.how, 'mapped');
  assert.equal(first.workspace, 'w-789');
  assert.equal(first.needsRewrite, true);
  assert.equal(first.action, 'rewrite+group');
  assert.equal(first.from, '/old/device/path');
  assert.equal(first.to, '/root/workspace/789');
});

test('inferred：按 cwd 的 basename 唯一命中工作区', () => {
  const plan = planGrouping({
    sessions: [{ rel: 'p/session-a/session.jsonl.zstd', id: 'a', cwd: '/somewhere/else/456' }],
    workspaces: WS,
    canonical: () => null, // 源路径在本机不存在 → 走推断
  });
  const [first] = plan.items;
  assert.ok(first);
  assert.equal(first.how, 'inferred');
  assert.equal(first.workspace, 'w-456');
});

test('inferred 歧义（多个工作区同名 basename）→ 报 ungrouped，不猜', () => {
  const plan = planGrouping({
    sessions: [{ rel: 'p/session-a/session.jsonl.zstd', id: 'a', cwd: '/x/456' }],
    workspaces: [
      { id: 'w1', path: '/root/workspace/456' },
      { id: 'w2', path: '/other/place/456' },
    ],
    canonical: () => null,
  });
  assert.equal(plan.items.length, 0);
  const [first] = plan.ungrouped;
  assert.ok(first);
  assert.equal(first.reason, '没有工作区路径与这个会话的 cwd 对应');
});

test('三条都不成立 → ungrouped（原因文案与脚本一致）', () => {
  const plan = planGrouping({
    sessions: [{ rel: 'p/session-a/session.jsonl.zstd', id: 'a', cwd: '/nowhere/at/all' }],
    workspaces: WS,
    canonical: () => null,
  });
  assert.equal(plan.items.length, 0);
  assert.equal(plan.ungrouped.length, 1);
  assert.equal(plan.ungrouped[0]?.cwd, '/nowhere/at/all');
});

test('映射目标本身不是已注册工作区 → 不认这条路，继续走推断/拒绝', () => {
  const plan = planGrouping({
    sessions: [{ rel: 'p/session-a/session.jsonl.zstd', id: 'a', cwd: '/old/path' }],
    workspaces: WS,
    maps: new Map([['/old/path', '/not/a/registered/workspace']]),
    canonical: passThrough,
  });
  assert.equal(plan.items.length, 0);
  assert.equal(plan.ungrouped.length, 1);
});

test('多个会话各自判定，互不影响', () => {
  const plan = planGrouping({
    sessions: [
      { rel: 'p1/session-a/session.jsonl.zstd', id: 'a', cwd: '/root/workspace/456' },
      { rel: 'p2/session-b/session.jsonl.zstd', id: 'b', cwd: '/missing/xyz' },
    ],
    workspaces: WS,
    canonical: (p) => (p === '/root/workspace/456' ? p : null),
  });
  assert.equal(plan.items.length, 1);
  assert.equal(plan.ungrouped.length, 1);
});
