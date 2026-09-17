/**
 * sessions 分区 adapter（默认关，设计 §3.3/§15）：
 * 数据源 = ~/.dsh/sessions/<projectKey>/<sessionId>/…（zstd jsonl，含敏感信息）。
 * defaultIncluded=false：Quick Export 不包含，用户显式勾选才导出（v1 文件级复制）。
 * 研究报告 §4.9：DSH 无会话批量导出 API，逐会话文件复制是唯一通道。
 */
import { join } from 'node:path';
import { pickSessions } from '../core/session-select.ts';
import type { ExportOptions, HostContext } from '../core/types.ts';
import { FileCollectionAdapter } from './file-collection.ts';

export class SessionsAdapter extends FileCollectionAdapter {
  readonly id = 'sessions' as const;
  readonly displayName = 'Sessions';
  readonly defaultIncluded = false;
  readonly portability = 'deviceSpecific' as const;
  readonly baseDir = 'sessions';

  /**
   * 会话子集筛选：`options.sessions.limit` 缺省 = 今天的行为（分区被选中就全带）。
   *
   * 单位是**会话目录**（两级：`<projectKey>/<会话目录>`）—— 同一会话的新旧日志必须一起走，
   * 只挑一份会让恢复出来的会话缺一半历史；选中后原文件名照旧，不在这里改名。
   * 目录归属从 `sessions` 树的实际列目录结果算（不猜 projectKey）。
   */
  protected override selectRels(ctx: HostContext, rels: string[], options: ExportOptions): string[] {
    const limit = options.sessions?.limit;
    if (limit === undefined || limit < 0) return rels; // 缺省/全带：原样
    if (limit === 0) return [];
    const keep = new Set(pickSessions(join(ctx.homeDir, this.baseDir), limit).map((s) => `${s.project}/${s.dir}`));
    return rels.filter((rel) => {
      const parts = rel.split(/[\\/]/);
      if (parts.length < 3) return false; // 不是 <projectKey>/<会话目录>/<文件> 的形态
      return keep.has(`${parts[0]}/${parts[1]}`);
    });
  }
}
