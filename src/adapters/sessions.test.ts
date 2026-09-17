/**
 * sessions 分区的会话子集筛选：默认行为不变是重中之重（不传 limit 时必须原样全带），
 * 以及「单位是会话目录」（新旧日志一起走）。
 */
import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, rmSync, utimesSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import type { ExportOptions, HostContext } from '../core/types.ts';
import { SessionsAdapter } from './sessions.ts';

/** 暴露 protected 钩子（TS 里子类可访问 protected）。 */
class Probe extends SessionsAdapter {
  run(ctx: HostContext, rels: string[], options: ExportOptions): string[] {
    return this.selectRels(ctx, rels, options);
  }
}

/** 造 sessions 树：<root>/<project>/<dir>/<files...>，日志 mtime 设为 ageMinutes 分钟前。 */
function fixture(): { root: string; home: string } {
  const home = mkdtempSync(join(tmpdir(), 'dcm-sessions-adapter-'));
  const root = join(home, 'sessions');
  const mk = (project: string, dir: string, files: string[], ageMinutes: number): void => {
    const p = join(root, project, dir);
    mkdirSync(p, { recursive: true });
    const t = new Date(Date.now() - ageMinutes * 60_000);
    for (const f of files) {
      writeFileSync(join(p, f), 'x');
      utimesSync(join(p, f), t, t);
    }
  };
  mk('proj-old', 'session-old', ['session.jsonl.zstd'], 120);
  mk('proj-new', 'session-new', ['session.jsonl.zstd', 'session.v3.jsonl.zstd'], 1);
  return { root, home };
}

const CTX = (home: string): HostContext => ({ homeDir: home } as unknown as HostContext);

test('不传 limit → 原样全带（默认行为不变）', () => {
  const { root, home } = fixture();
  try {
    const rels = [
      'proj-old/session-old/session.jsonl.zstd',
      'proj-new/session-new/session.jsonl.zstd',
      'proj-new/session-new/session.v3.jsonl.zstd',
    ];
    assert.deepEqual(new Probe().run(CTX(home), rels, { includeSecrets: false }), rels);
    assert.deepEqual(new Probe().run(CTX(home), rels, { includeSecrets: false, sessions: { limit: -1 } }), rels);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('limit=0 → 一个都不带', () => {
  const { root, home } = fixture();
  try {
    const rels = ['proj-new/session-new/session.jsonl.zstd'];
    assert.deepEqual(new Probe().run(CTX(home), rels, { includeSecrets: false, sessions: { limit: 0 } }), []);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('limit=1 → 只留最新的那个会话，且它的新旧日志一起走', () => {
  const { root, home } = fixture();
  try {
    const rels = [
      'proj-old/session-old/session.jsonl.zstd',
      'proj-new/session-new/session.jsonl.zstd',
      'proj-new/session-new/session.v3.jsonl.zstd',
    ];
    assert.deepEqual(new Probe().run(CTX(home), rels, { includeSecrets: false, sessions: { limit: 1 } }), [
      'proj-new/session-new/session.jsonl.zstd',
      'proj-new/session-new/session.v3.jsonl.zstd',
    ]);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('层级不足的条目在筛选时被剔除（不是 <projectKey>/<会话目录>/<文件> 的形态）', () => {
  const { root, home } = fixture();
  try {
    const rels = ['stray-file.jsonl.zstd', 'proj-new/session-new/session.jsonl.zstd'];
    assert.deepEqual(new Probe().run(CTX(home), rels, { includeSecrets: false, sessions: { limit: 5 } }), [
      'proj-new/session-new/session.jsonl.zstd',
    ]);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
