/**
 * workspaces 分区 adapter（设计 §3.3/§11）：
 * 数据源 = ~/.dsh/storages/workspace.json 的 tables.workspaces（经 ctx.workspace 门面）。
 * workspace.path 为绝对路径 → 跨设备必须 PathMapping（analyzeImport 生成 PathMapping 项，
 * 映射由引擎 PathMapper 先行应用到 sections，applyItem 拿到的已是映射后数据）。
 */
import { existsSync, mkdirSync } from 'node:fs';
import { isDeepStrictEqual } from 'node:util';
import { zhMsg } from '../core/messages.ts';
import type { MsgFunc } from '../core/messages.ts';
import type { WorkspaceRecord, WorkspacesSection } from '../schema/types.ts';
import type {
  ApplyResult, ConfigAdapter, ExportOptions, ExportSection, HostContext,
  ImportContext, PlanItem, ValidationResult,
} from '../core/types.ts';

/**
 * 缺目录就建出来，返回「这次真的建了」的路径；不需要建/不该建时返回 undefined。
 *
 * 只处理容器内绝对路径：非绝对路径、含 `..` 段一律不猜（跨设备映射是 PathMapping
 * 的职责，不是这里）；目标位置已存在**文件**时也不动（宁可不写记录，也不覆盖别人的东西）。
 */
function ensureWorkspaceDir(workspacePath: string): string | undefined {
  const p = workspacePath.trim();
  if (p === '' || !p.startsWith('/')) return undefined;
  if (p.split('/').some((seg) => seg === '..')) return undefined;
  try {
    // 已存在就不动：是目录正好，是文件则让 writeRecord 去报它原来的警告（不覆盖别人的东西）
    if (existsSync(p)) return undefined;
    mkdirSync(p, { recursive: true });
    return p;
  } catch {
    // 建不出来（权限/只读挂载）→ 保持今天的行为：让 writeRecord 去报它自己的警告
    return undefined;
  }
}

export class WorkspacesAdapter implements ConfigAdapter<WorkspacesSection> {
  readonly id = 'workspaces' as const;
  readonly displayName = 'Workspaces';
  readonly defaultIncluded = true;
  readonly portability = 'platformSpecific' as const;

  async export(ctx: HostContext, _options: ExportOptions): Promise<ExportSection<WorkspacesSection>> {
    const records = await ctx.workspace.listRecords();
    return {
      sectionId: 'workspaces',
      data: { version: 1, workspaces: records },
      counts: { workspaces: records.length },
      warnings: [],
    };
  }

  async analyzeImport(data: WorkspacesSection, ctx: ImportContext): Promise<PlanItem[]> {
    const msg = ctx.msg;
    const items: PlanItem[] = [];
    for (const rec of data.workspaces) {
      const id = `workspace:${rec.id}`;
      const existing = (await ctx.target.workspace.listRecords()).find((r) => r.id === rec.id);
      if (!existing) {
        items.push({
          id, kind: 'Create', adapter: 'workspaces',
          description: msg('adapter.workspaceCreate', { title: rec.title ?? rec.id, path: rec.path }), severity: 'info',
          target: { adapter: 'workspaces', ref: rec.id },
        });
      } else if (isDeepStrictEqual(existing, rec)) {
        items.push({ id, kind: 'Skip', adapter: 'workspaces', description: msg('adapter.workspaceSame', { id: rec.id }), severity: 'info' });
      } else {
        items.push({
          id, kind: 'Conflict', adapter: 'workspaces',
          description: msg('adapter.workspaceDiff', { id: rec.id }),
          detail: `current=${JSON.stringify(existing)} imported=${JSON.stringify(rec)}`.slice(0, 200),
          severity: 'warning', target: { adapter: 'workspaces', ref: rec.id },
        });
      }
      // 绝对路径 → 路径映射提示（oldPrefix 先用整条路径占位，newPrefix 由 UI 确认）
      if (rec.path.startsWith('/') || /^[a-zA-Z]:[\\/]/.test(rec.path)) {
        items.push({
          id: `${id}:path`, kind: 'PathMapping', adapter: 'workspaces',
          description: msg('adapter.workspacePathMapping', { path: rec.path }), severity: 'warning',
          pathMapping: { oldPrefix: rec.path, newPrefix: '', appliesTo: ['workspaces'] },
          target: { adapter: 'workspaces', ref: rec.id },
        });
      }
    }
    return items;
  }

  async applyItem(item: PlanItem, ctx: ImportContext): Promise<ApplyResult> {
    // PathMapping 项：数据已由 PathMapper 应用到 sections，无需额外写入
    if (item.kind === 'PathMapping') return { ok: true };
    const ref = item.target?.ref;
    if (!ref) return { ok: false, message: ctx.msg('adapter.missingTargetRef') };
    const data = ctx.sections.get('workspaces') as WorkspacesSection | undefined;
    const rec = data?.workspaces.find((r) => r.id === ref);
    if (!rec) return { ok: false, message: ctx.msg('adapter.workspaceMissing', { ref }) };
    // 目录不存在时自己补出来，而不是只留一条警告：工作区路径经常是「来源机器上才有的
    // 目录」（如 /root/workspace/456），写记录时对路径 realpath，缺目录直接 ENOENT，
    // 而按 §34.17 这属非致命警告 → 宿主随后按 workspace.json 归组会话时会「找不到对应
    // 工作区」，用户看到的是「会话归组 0/N」这种莫名其妙的结果。
    const ensured = ensureWorkspaceDir(rec.path);
    try {
      await ctx.target.workspace.writeRecord(rec);
      if (ensured !== undefined) {
        // 让宿主/用户知道我们动过文件系统（只建目录，不碰任何既有内容）
        ctx.log.info(`workspace ${rec.id}: created missing directory ${ensured}`);
        ctx.onLog?.(ctx.msg('adapter.workspaceDirCreated', { path: ensured }));
        return { ok: true, message: ctx.msg('adapter.workspaceDirCreated', { path: ensured }) };
      }
      return { ok: true };
    } catch (err) {
      // 目标端无法写入（如路径 realpath 失败/目录不存在）→ 非致命警告（§34.17），
      // 不触发整体回滚——否则一个失效路径会拖垮已成功导入的其余配置。
      const reason = err instanceof Error ? err.message : String(err);
      return {
        ok: false,
        warning: true,
        message: ctx.msg('adapter.workspaceWriteFailed', { ref, msg: reason }),
      };
    }
  }

  async validate(data: WorkspacesSection, msg: MsgFunc = zhMsg): Promise<ValidationResult> {
    const issues: ValidationResult['issues'] = [];
    if (data === null || typeof data !== 'object') {
      return { valid: false, issues: [{ path: '$', message: msg('adapter.validate.object', { subject: 'workspaces' }), severity: 'error' }] };
    }
    if (data.version !== 1) {
      issues.push({ path: 'version', message: msg('adapter.validate.version', { value: String(data.version) }), severity: 'error' });
    }
    if (!Array.isArray(data.workspaces)) {
      issues.push({ path: 'workspaces', message: msg('adapter.validate.array', { subject: 'workspaces' }), severity: 'error' });
    } else {
      for (const w of data.workspaces as WorkspaceRecord[]) {
        if (w === null || typeof w !== 'object' || typeof w.id !== 'string' || typeof w.path !== 'string') {
          issues.push({ path: 'workspaces[]', message: msg('adapter.validate.workspaceIdentity'), severity: 'error' });
        }
      }
    }
    return { valid: issues.filter((i) => i.severity === 'error').length === 0, issues };
  }
}
