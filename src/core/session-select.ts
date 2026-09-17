/**
 * 导出时的**会话子集筛选**（从 DSH-Folk 的 DshBackupArchive.pickSessions 原样移植）。
 *
 * 为什么需要它：`/export` 的 `only` 只能选分区，**不能按数量筛会话** —— 只能「整棵会话树
 * 全带」或「一个都不带」。而真机上「只要最近几个会话」恰恰是最常见的诉求（会话树会随使用
 * 一直涨，全带会让备份包越来越大），宿主只能自己在本地挑，插件这边缺一个正规入口。
 *
 * 语义（三条都是踩过坑定下来的，移植时不要简化）：
 *  1. **单位是会话目录，不是文件**。一个会话可能同时有 `session.jsonl.zstd`（旧格式）与
 *     `session.v3.jsonl.zstd`（dsh 升级后留下的新格式）两份，只挑其中一份会让恢复出来的
 *     会话缺一半历史 —— 所以选中一个目录就把它下面的日志全部带走。
 *  2. **文件名判据不能写死**。`session.lock` 之类的运行时文件不是会话日志；而只认旧名字
 *     会让新格式会话在「最近 N 个」里被整批漏掉，它们恰恰是设备升级后最该备份的那批。
 *  3. **按「该会话最新一份日志的 mtime」排序**（不是目录 mtime：目录时间在增量写入时不可靠）。
 *
 * 数量档位的语义与宿主界面一致：`limit === 0` = 一个都不带（默认档）；`limit < 0` = 全带；
 * 其余 = 取最新 N 个。
 */
import { readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';

/** 会话日志文件名判据：`session.jsonl.zstd` / `session.v3.jsonl.zstd` / `session.jsonl` 都算。 */
export const SESSION_FILE_RE = /^session(\.[A-Za-z0-9]+)*\.jsonl(\.zstd)?$/;

/** 这个文件名是不是会话日志（不是的话就是 session.lock 之类的运行时文件）。 */
export function isSessionFile(name: string): boolean {
  return SESSION_FILE_RE.test(name);
}

/** 会话树里一个会话目录（两级：`<sessions-root>/<projectKey>/<sessionDir>`）。 */
export interface SessionEntry {
  /** 会话目录名（id 的目录名编码）。 */
  dir: string;
  /** 所属 projectKey 目录名。 */
  project: string;
  /** 会话目录的绝对路径。 */
  path: string;
  /** 该目录下的日志文件绝对路径（至少一个，否则这个目录不算会话）。 */
  files: string[];
  /** 该会话最新一份日志的 mtime（排序依据）。 */
  mtimeMs: number;
}

/** 列子目录；读不出来当作空（权限/竞态都不该让导出直接失败）。 */
function listDirs(parent: string): string[] {
  try {
    return readdirSync(parent, { withFileTypes: true })
      .filter((e) => e.isDirectory())
      .map((e) => join(parent, e.name));
  } catch {
    return [];
  }
}

/** 扫整棵会话树，只返回「真的有会话日志」的会话目录（顺序 = 最新在前）。 */
export function listSessions(sessionsRoot: string): SessionEntry[] {
  const out: SessionEntry[] = [];
  for (const projectPath of listDirs(sessionsRoot)) {
    const project = projectPath.slice(projectPath.lastIndexOf('/') + 1);
    for (const dirPath of listDirs(projectPath)) {
      let names: string[];
      try {
        names = readdirSync(dirPath);
      } catch {
        continue;
      }
      const files = names.filter(isSessionFile).map((n) => join(dirPath, n));
      if (files.length === 0) continue; // 只有 session.lock 之类 → 不算会话
      let mtimeMs = 0;
      for (const f of files) {
        try {
          const t = statSync(f).mtimeMs;
          if (t > mtimeMs) mtimeMs = t;
        } catch {
          // 单个文件读不到时间不影响判定，其余文件仍然参与取最大值
        }
      }
      out.push({ dir: dirPath.slice(dirPath.lastIndexOf('/') + 1), project, path: dirPath, files, mtimeMs });
    }
  }
  out.sort((a, b) => b.mtimeMs - a.mtimeMs);
  return out;
}

/**
 * 按档位挑会话目录。
 *
 * @param limit 0 = 不带会话；负数 = 全带；正数 = 最新 N 个
 */
export function pickSessions(sessionsRoot: string, limit: number): SessionEntry[] {
  if (limit === 0) return [];
  const all = listSessions(sessionsRoot);
  return limit < 0 ? all : all.slice(0, limit);
}

/** 会话树里一共有多少个会话（宿主界面显示「最近 N 个 / 共 M 个」用）。 */
export function sessionCount(sessionsRoot: string): number {
  return listSessions(sessionsRoot).length;
}
