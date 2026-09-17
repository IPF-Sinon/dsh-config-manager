/**
 * registry 解析与红线校验：只测「能不能安全地读写」，不测归组语义（那在别的模块）。
 * 夹具用接近真实的 workspace.json 形状（含未知键，验证这些键不会被碰）。
 */
import assert from 'node:assert/strict';
import test from 'node:test';
import { hasPendingMutation, parseRegistry, validateRegistry } from './session-registry.ts';

const GOOD = [
  'version: 1',
  'tables:',
  '  workspaces:',
  '    w-a:',
  '      id: w-a',
  '      path: /root/workspace/456',
  '      sessionIds:',
  '        - sess-1',
  '      archivedSessionIds:',
  '        - old-1',
  '      updatedAt: "2026-01-01T00:00:00.000Z"',
  'state:',
  '  workspaceIds:',
  '    - w-a',
  '  initialized: true',
  '',
].join('\n');

test('解析出 table 与 state，未知键（archivedSessionIds）原样保留', () => {
  const parts = parseRegistry(GOOD);
  assert.ok(parts);
  assert.deepEqual(parts.state['workspaceIds'], ['w-a']);
  assert.deepEqual(parts.table['w-a']?.sessionIds, ['sess-1']);
  assert.deepEqual(parts.table['w-a']?.archivedSessionIds, ['old-1']);
  assert.deepEqual(validateRegistry(parts), []);
});

test('改动 table 即改动文档（回头看文档能看到改动）', () => {
  const parts = parseRegistry(GOOD);
  assert.ok(parts);
  const rec = parts.table['w-a'];
  assert.ok(rec);
  rec.sessionIds = ['sess-2'];
  const text = JSON.stringify(parts.doc);
  assert.match(text, /sess-2/);
});

test('红线：顺序重复 / 顺序指向缺失记录 / 记录不在顺序里', () => {
  const dup = parseRegistry(GOOD.replace('    - w-a\n', '    - w-a\n    - w-a\n'));
  assert.ok(dup);
  assert.match(validateRegistry(dup).join(';'), /repeats workspace/);

  const missing = parseRegistry(GOOD.replace('  workspaceIds:\n    - w-a', '  workspaceIds:\n    - w-none'));
  assert.ok(missing);
  assert.match(validateRegistry(missing).join(';'), /references missing workspace/);

  const extra = parseRegistry(GOOD.replace('  workspaceIds:\n    - w-a', '  workspaceIds: []'));
  assert.ok(extra);
  assert.match(validateRegistry(extra).join(';'), /is missing from registry order/);
});

test('红线：sessionIds 不是字符串数组 / path 为空', () => {
  const bad = parseRegistry(GOOD.replace('      sessionIds:\n        - sess-1', '      sessionIds: "sess-1"'));
  assert.ok(bad);
  assert.match(validateRegistry(bad).join(';'), /sessionIds is not a string array/);

  const noPath = parseRegistry(GOOD.replace('      path: /root/workspace/456', '      path: ""'));
  assert.ok(noPath);
  assert.match(validateRegistry(noPath).join(';'), /has no path/);
});

test('pendingMutation 存在即拒写', () => {
  const withPending = parseRegistry(GOOD.replace('  initialized: true', '  initialized: true\n  pendingMutation:\n    id: x'));
  assert.ok(withPending);
  assert.equal(hasPendingMutation(withPending), true);
  const clean = parseRegistry(GOOD);
  assert.ok(clean);
  assert.equal(hasPendingMutation(clean), false);
});

test('结构不认识（改不动 YAML / 没有 state）→ 返回 null，不猜', () => {
  assert.equal(parseRegistry('this: [is: not: yaml'), null);
  assert.equal(parseRegistry('version: 1\ntables:\n  workspaces:\n    w-a:\n      path: /x\n      sessionIds: []\n'), null);
});
