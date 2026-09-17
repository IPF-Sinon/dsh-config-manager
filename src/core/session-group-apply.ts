/**
 * 归组的**应用层**：把规划结果算成「注册表新状态 + 需要在文件系统上做的动作」。
 *
 * 本模块**不碰文件系统**（读写都由调用方注入/执行）：
 *  - 这样「读不出注册表就一个字都不写」「写前备份、写后读回自检、失败回滚」这些红线
 *    才能落在路由层一处实现，而不是散在业务逻辑里；
 *  - 也才好在单测里用假数据把每条分支跑穿。
 *
 * 语义照抄 DSH-Folk 的 dsh-session-group.cjs：
 *  1. 目标工作区的 projectKey 目录**反查**（由调用方注入 projectKeyFor）—— 查不到就报
 *     ungrouped「找不到目标工作区的 projectKey 目录（不敢猜）」，绝不自己编目录名；
 *  2. 会话目录段沿用原路径里已有的段，**原文件名也保留**（把 session.v3.jsonl.zstd 写成
 *     session.jsonl.zstd 等于偷换格式名）；
 *  3. 一个会话只能属于一个工作区：先从别的工作区 sessionIds 里摘掉（计 moved），再塞进目标；
 *  4. header 只在 needsRewrite 时改写，且必须改写成功（两重自证不过 → 报 ungrouped
 *     「无法安全改写 header 帧」，不动那条会话）。
 */
import { readHeaderLine, rewriteHeader } from './session-files.ts';
import type { GroupingPlanItem } from './session-group-plan.ts';

/** registry 里一条工作区记录（未知键一律保留）。 */
export interface RegistryWorkspaceRecord {
  path: string;
  sessionIds?: string[];
  updatedAt?: string;
  [key: string]: unknown;
}

/** registry（已由调用方从 workspace.json 解析出来）。 */
export interface GroupingRegistry {
  /** id → 记录（原样，含未知键）。 */
  table: Record<string, RegistryWorkspaceRecord>;
}

/** 需要在文件系统上执行的动作：写 [to]（内容 [content]），[removeFrom] 非空则删掉旧文件。 */
export interface GroupingFileAction {
  from: string;
  to: string;
  content: Buffer | null;
  /** to 与 from 解析后不同才删源（同路径不能删） */
  removeFrom: boolean;
}

export interface GroupingReport {
  grouped: number;
  groupedSessions: number;
  rewritten: number;
  moved: number;
  ungrouped: { path: string; id: string; cwd: string; reason: string }[];
  inferred: { id: string; from: string; to: string; workspace: string }[];
  items: { id: string; action: string; workspace: string; how: string; from: string; to: string }[];
}

export interface ApplyGroupingInput {
  items: GroupingPlanItem[];
  registry: GroupingRegistry;
  /** 读会话文件内容（相对 sessions-root 的路径 → 内容）；读不到返回 null。 */
  readSession: (rel: string) => Buffer | null;
  /** 反查目标工作区的 projectKey 目录名；查不到返回 null。 */
  projectKeyFor: (workspacePath: string) => string | null;
  /** 时间戳来源（默认当前时间），注入只为测试可断言。 */
  now?: () => string;
}

export interface ApplyGroupingResult {
  report: GroupingReport;
  /** 复制后的注册表（调用方负责写回；未变更时与原对象内容等价）。 */
  registry: GroupingRegistry;
  actions: GroupingFileAction[];
}

/** 取 POSIX basename / dirname（host 侧路径一律 POSIX 形态）。 */
function baseName(p: string): string {
  const cut = p.replace(/\/+$/, '');
  const i = cut.lastIndexOf('/');
  return i < 0 ? cut : cut.slice(i + 1);
}
function dirName(p: string): string {
  const cut = p.replace(/\/+$/, '');
  const i = cut.lastIndexOf('/');
  return i <= 0 ? '' : cut.slice(0, i);
}

/** 把 header 行里的 cwd 换成目标路径（其余字段原样保留）。解析失败返回 null。 */
function headerWithCwd(headerLine: string, targetPath: string): string | null {
  const raw = headerLine.endsWith('\n') ? headerLine.slice(0, -1) : headerLine;
  try {
    const parsed: unknown = JSON.parse(raw);
    if (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed)) return null;
    const next = { ...(parsed as Record<string, unknown>), cwd: targetPath };
    return JSON.stringify(next);
  } catch {
    return null;
  }
}

/**
 * 应用规划：算出新注册表与文件动作。
 *
 * 不写盘、不备份 —— 调用方拿到 actions 与 registry 后自行：备份 → 写文件 → 写注册表 →
 * 读回自检 → 失败回滚。
 */
export function applyGroupingPlan(input: ApplyGroupingInput): ApplyGroupingResult {
  const now = input.now ?? (() => new Date().toISOString());
  // 深拷贝注册表表体（未知键、archivedSessionIds、pendingMutation 等一律原样带过）
  const table: Record<string, RegistryWorkspaceRecord> = {};
  for (const [id, rec] of Object.entries(input.registry.table)) {
    table[id] = { ...rec, sessionIds: [...(rec.sessionIds ?? [])] };
  }

  const report: GroupingReport = {
    grouped: 0,
    groupedSessions: 0,
    rewritten: 0,
    moved: 0,
    ungrouped: [],
    inferred: [],
    items: [],
  };
  const actions: GroupingFileAction[] = [];
  const seenSessionIds = new Set<string>();

  for (const item of input.items) {
    const target = table[item.workspace];
    if (target === undefined) {
      report.ungrouped.push({ path: item.rel, id: item.id, cwd: item.from, reason: '目标工作区不在注册表里' });
      continue;
    }

    const pk = input.projectKeyFor(item.to);
    if (pk === null) {
      report.ungrouped.push({
        path: item.rel,
        id: item.id,
        cwd: item.from,
        reason: '找不到目标工作区的 projectKey 目录（不敢猜）',
      });
      continue;
    }

    const seg = baseName(dirName(item.rel));
    if (seg === '') {
      report.ungrouped.push({ path: item.rel, id: item.id, cwd: item.from, reason: '会话路径层级不足，无法定位目录段' });
      continue;
    }
    const destRel = `${pk}/${seg}/${baseName(item.rel)}`;

    let content: Buffer | null = null;
    if (item.needsRewrite) {
      const source = input.readSession(item.rel);
      if (source === null) {
        report.ungrouped.push({ path: item.rel, id: item.id, cwd: item.from, reason: '会话文件读不出来' });
        continue;
      }
      const current = readHeaderLine(source);
      const headerLine = current === null ? null : headerWithCwd(current, item.to);
      if (headerLine === null) {
        report.ungrouped.push({ path: item.rel, id: item.id, cwd: item.from, reason: '无法安全改写 header 帧' });
        continue;
      }
      const rewritten = rewriteHeader(source, headerLine);
      if (!rewritten.ok) {
        report.ungrouped.push({ path: item.rel, id: item.id, cwd: item.from, reason: '无法安全改写 header 帧' });
        continue;
      }
      content = rewritten.buffer;
      report.rewritten += 1;
    }

    actions.push({ from: item.rel, to: destRel, content, removeFrom: destRel !== item.rel });

    for (const [wid, rec] of Object.entries(table)) {
      if (wid !== item.workspace && (rec.sessionIds ?? []).includes(item.id)) {
        rec.sessionIds = (rec.sessionIds ?? []).filter((x) => x !== item.id);
        report.moved += 1;
      }
    }
    if (!(target.sessionIds ?? []).includes(item.id)) (target.sessionIds ??= []).push(item.id);
    target.updatedAt = now();
    report.grouped += 1;
    if (!seenSessionIds.has(item.id)) {
      seenSessionIds.add(item.id);
      report.groupedSessions += 1;
    }
    report.items.push({
      id: item.id,
      action: item.action,
      workspace: item.workspace,
      how: item.how,
      from: item.from,
      to: item.to,
    });
    if (item.how === 'inferred') {
      report.inferred.push({ id: item.id, from: item.from, to: item.to, workspace: item.workspace });
    }
  }

  return { report, registry: { table }, actions };
}
