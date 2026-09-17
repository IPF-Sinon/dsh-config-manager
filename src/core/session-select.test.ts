/**
 * 会话子集筛选的用例：夹具在临时目录里现搭，覆盖「单位是会话目录」「文件名判据」
 * 「按最新日志 mtime 排序」「三档数量语义」这几条移植时必须钉住的规则。
 */
import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, rmSync, utimesSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { isSessionFile, listSessions, pickSessions, sessionCount } from './session-select.ts';

function fixture(): string {
  return mkdtempSync(join(tmpdir(), 'dcm-sessions-'));
}

/** 造一个会话目录：<root>/<project>/<dir>/<files...>，日志 mtime 设为 ageMinutes 分钟前。 */
function mkSession(root: string, project: string, dir: string, files: string[], ageMinutes: number): string {
  const p = join(root, project, dir);
  mkdirSync(p, { recursive: true });
  const t = new Date(Date.now() - ageMinutes * 60_000);
  for (const f of files) {
    writeFileSync(join(p, f), 'x');
    utimesSync(join(p, f), t, t);
  }
  return p;
}

test('文件名判据：新旧会话日志都算，session.lock 之类不算', () => {
  assert.equal(isSessionFile('session.jsonl.zstd'), true);
  assert.equal(isSessionFile('session.v3.jsonl.zstd'), true);
  assert.equal(isSessionFile('session.jsonl'), true);
  assert.equal(isSessionFile('session.lock'), false);
  assert.equal(isSessionFile('session.v3.jsonl.zstd.tmp'), false);
});

test('单位是会话目录：同一会话的新旧两份日志一起带走', () => {
  const root = fixture();
  try {
    mkSession(root, 'proj-a', 'sess-1', ['session.jsonl.zstd', 'session.v3.jsonl.zstd'], 1);
    const picked = pickSessions(root, 5);
    assert.equal(picked.length, 1);
    assert.equal(picked[0].files.length, 2);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('只有运行时文件（session.lock）的目录不算会话', () => {
  const root = fixture();
  try {
    mkSession(root, 'proj-a', 'sess-lock', ['session.lock'], 1);
    assert.equal(sessionCount(root), 0);
    assert.equal(pickSessions(root, -1).length, 0);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('按「最新一份日志的 mtime」倒序，取最新 N 个', () => {
  const root = fixture();
  try {
    mkSession(root, 'proj-a', 'old', ['session.jsonl.zstd'], 100);
    mkSession(root, 'proj-b', 'mid', ['session.jsonl.zstd'], 50);
    mkSession(root, 'proj-c', 'new', ['session.v3.jsonl.zstd'], 1);
    assert.deepEqual(pickSessions(root, 2).map((s) => s.dir), ['new', 'mid']);
    assert.deepEqual(pickSessions(root, -1).map((s) => s.dir), ['new', 'mid', 'old']);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('三档数量语义：0 不带、负数全带、正数取 N', () => {
  const root = fixture();
  try {
    mkSession(root, 'proj-a', 'a', ['session.jsonl.zstd'], 3);
    mkSession(root, 'proj-a', 'b', ['session.jsonl.zstd'], 2);
    assert.equal(pickSessions(root, 0).length, 0);
    assert.equal(pickSessions(root, 1).length, 1);
    assert.equal(pickSessions(root, 9).length, 2);
    assert.equal(pickSessions(root, -1).length, 2);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('会话树不存在时安全返回空（不抛错）', () => {
  const missing = join(tmpdir(), 'dcm-sessions-definitely-missing-' + Date.now());
  assert.deepEqual(listSessions(missing), []);
  assert.equal(sessionCount(missing), 0);
});
