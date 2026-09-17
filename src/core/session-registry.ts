/**
 * workspace.json 的读取与**红线**校验（等价上游 dsh-workspace 的 validateStoredState）。
 *
 * 为什么必须改原文而不是走 workspace 门面：`WorkspaceRecord` 类型只有
 * { id, path, title?, sessionIds, createdAt?, updatedAt? }，而真实文件里还有
 * `archivedSessionIds`、`pendingMutation` 等键。走门面回写等于**把未知键抹掉**，
 * 那是不可接受的数据丢失 —— 所以这里只对**解析后的文档**做最小改动（只动
 * sessionIds / updatedAt），其余键一个字节都不碰。
 *
 * 校验不过就一字不写：宁可不归组，也不能把用户的注册表写坏。
 */
import * as yaml from 'js-yaml';

/** 一条工作区记录（未知键原样保留）。 */
export interface RawWorkspaceRecord {
  path: string;
  sessionIds: string[];
  updatedAt?: string;
  [key: string]: unknown;
}

/** registry 文档的解析结果（table + state 均为**原文档中的对象引用**，改动即改文档）。 */
export interface RegistryParts {
  doc: unknown;
  table: Record<string, RawWorkspaceRecord>;
  /** 全局状态（workspaceIds / initialized） */
  state: Record<string, unknown>;
}

function isRecord(v: unknown): v is Record<string, unknown> {
  return v !== null && typeof v === 'object' && !Array.isArray(v);
}

/** 在文档里找 workspaces 表与全局 state（照脚本的 walk：值全是记录的对象即表；键名为 workspaces 的空对象也认）。 */
function walk(node: unknown, out: { table?: Record<string, RawWorkspaceRecord>; state?: Record<string, unknown> }): void {
  if (!isRecord(node)) return;
  for (const [k, v] of Object.entries(node)) {
    if (isRecord(v)) {
      const vals = Object.values(v);
      // 判据要够严：上一层的 'tables' 值也全是对象（workspaces 本身），只按「值是对象」
      // 会把 tables 误认成表。所以要求每个值都**长得像工作区记录**（有 path 字符串）；
      // 空对象的特例只在键名就是 workspaces 时才认（照脚本）。
      const looksLikeTable =
        vals.length > 0
          ? vals.every((x) => isRecord(x) && typeof x['path'] === 'string')
          : k === 'workspaces';
      if (out.table === undefined && looksLikeTable && k !== 'state') {
        out.table = v as Record<string, RawWorkspaceRecord>;
        continue;
      }
      if (out.state === undefined && k === 'state' && Array.isArray(v['workspaceIds'])) {
        out.state = v;
        continue;
      }
      walk(v, out);
    }
  }
}

/** 解析 workspace.json 文本；结构不认识返回 null（调用方一律当「读不出」处理）。 */
export function parseRegistry(text: string): RegistryParts | null {
  let doc: unknown;
  try {
    doc = yaml.load(text);
  } catch {
    return null;
  }
  const out: { table?: Record<string, RawWorkspaceRecord>; state?: Record<string, unknown> } = {};
  walk(doc, out);
  if (out.table === undefined || out.state === undefined) return null;
  return { doc, table: out.table, state: out.state };
}

/**
 * 红线校验：返回问题清单（空 = 通过）。
 *
 * 覆盖上游 validateStoredState 的等价判据：workspaceIds 顺序唯一、每条记录都在顺序里、
 * 顺序里的每个 id 都有记录、每条记录的 sessionIds 是字符串数组、path 非空。
 */
export function validateRegistry(parts: RegistryParts): string[] {
  const problems: string[] = [];
  const order = parts.state['workspaceIds'];
  if (!Array.isArray(order)) return ['registry has no workspaceIds order'];
  const seen = new Set<string>();
  for (const id of order) {
    if (typeof id !== 'string') {
      problems.push('registry order contains a non-string id');
      continue;
    }
    if (seen.has(id)) problems.push(`registry order repeats workspace '${id}'`);
    seen.add(id);
    if (!(id in parts.table)) problems.push(`registry order references missing workspace '${id}'`);
  }
  for (const [id, rec] of Object.entries(parts.table)) {
    if (!seen.has(id)) problems.push(`workspace '${id}' is missing from registry order`);
    if (typeof rec.path !== 'string' || rec.path === '') {
      problems.push(`workspace '${id}' has no path`);
    }
    const ids = rec.sessionIds;
    if (!Array.isArray(ids) || ids.some((x) => typeof x !== 'string')) {
      problems.push(`workspace '${id}' sessionIds is not a string array`);
    }
  }
  return problems;
}

/** 是否有进行中的注册表改动（有就绝不能写）。 */
export function hasPendingMutation(parts: RegistryParts): boolean {
  return parts.state['pendingMutation'] !== undefined && parts.state['pendingMutation'] !== null;
}
