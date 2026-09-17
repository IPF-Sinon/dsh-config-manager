/**
 * 会话归组的**规划**（从 DSH-Folk 的 dsh-session-group.cjs 原样移植）。
 *
 * 背景（为什么需要归组）：dsh 的工作区分组只在注册表首次 bootstrap 时做一次
 * （`@deepseek-ai/dsh-workspace` 的 `Service.init()`：`if (!state.initialized) bootstrap(headers)`），
 * 之后放进 sessions 树的会话永远不会被归组，界面里也没有「从未分组移进工作区」的入口。
 * 而**光把 session id 塞进 registry 的 sessionIds 也没用**：成员判定是
 * `host.sessionPath(id) === record.path`，而 `sessionPath(id)` 由会话 header 里的 cwd 反推，
 * 不相等时那条会话会被过滤掉，只在日志里留一句 `canonical cwd '<a>' differs from workspace path '<b>'`。
 * 所以真正归组要同时满足三件事：文件落在 `<sessions-root>/<projectKey>/<seg>/<原文件名>`、
 * header 的 cwd（realpath 规范化后）等于工作区 path、id 出现在该工作区的 sessionIds 里且不在别处。
 *
 * ## 目标工作区是怎么选出来的（三条路，歧义一律不猜）
 *
 *  1. `exact`：会话 cwd 规范化后**就是**某个已注册工作区的 path；
 *  2. `mapped`：显式映射表（本插件里来自 manifest 的 pathMappings 或调用方给的 --map）命中的目标
 *     规范化后是已注册工作区；
 *  3. `inferred`：按 cwd 的 **basename** 反查工作区，**且只有一个**工作区命中才认 —— 命中多个
 *     说明歧义，宁可报 ungrouped。
 *
 * 三条都不成立 → 报 ungrouped（原因文案与脚本一致，宿主不必改解析）。
 *
 * 本模块只做**决策**，不碰文件系统（除注入的 canonical 外）：写盘、备份、注册表红线校验与回滚
 * 都在应用层，这样「读不出注册表就一个字都不写」这条红线才落得实。
 */
import { realpathSync } from 'node:fs';

/** 已注册工作区的必要信息（registry 里一条记录的子集）。 */
export interface GroupingWorkspace {
  id: string;
  path: string;
}

/** 待归组的会话（rel = 相对 sessions-root 的路径，含文件名）。 */
export interface GroupingSession {
  rel: string;
  id: string;
  cwd: string;
}

export interface GroupingPlanItem {
  id: string;
  rel: string;
  /** group = 只进注册表；rewrite+group = 还要把 header 的 cwd 改写到目标路径 */
  action: 'group' | 'rewrite+group';
  workspace: string;
  how: 'exact' | 'mapped' | 'inferred';
  from: string;
  to: string;
  /** 是否需要改写 header（cwd 规范化后与目标 path 不同） */
  needsRewrite: boolean;
}

export interface GroupingPlanUngrouped {
  rel: string;
  id: string;
  cwd: string;
  reason: string;
}

export interface GroupingPlan {
  items: GroupingPlanItem[];
  ungrouped: GroupingPlanUngrouped[];
}

export interface GroupingPlanInput {
  sessions: GroupingSession[];
  workspaces: GroupingWorkspace[];
  /** cwd → 目标路径（manifest pathMappings 或 --map）。 */
  maps?: Map<string, string>;
  /** 路径规范化（默认 realpathSync；注入只为测试可控）。不存在返回 null。 */
  canonical?: (p: string) => string | null;
}

/** 取路径 basename（不依赖平台：host 侧路径一律是 POSIX 形态）。 */
function baseName(p: string): string {
  const cut = p.replace(/\/+$/, '');
  const i = cut.lastIndexOf('/');
  return i < 0 ? cut : cut.slice(i + 1);
}

/**
 * 规划归组。
 *
 * 注意 `pathToId` 用的是**记录里原样的 path**（脚本如此）：会话侧的 cwd 会被规范化后去比，
 * 所以注册表里的 path 必须是已经规范化的真实路径 —— dsh 写的记录本来就满足这一点。
 */
export function planGrouping(input: GroupingPlanInput): GroupingPlan {
  const canonical = input.canonical ?? defaultCanonical;
  const pathToId = new Map<string, string>();
  const baselineIds = new Map<string, string[]>();
  for (const ws of input.workspaces) {
    pathToId.set(ws.path, ws.id);
    const b = baseName(ws.path);
    baselineIds.set(b, [...(baselineIds.get(b) ?? []), ws.id]);
  }

  const items: GroupingPlanItem[] = [];
  const ungrouped: GroupingPlanUngrouped[] = [];

  for (const session of input.sessions) {
    const cwd = session.cwd;
    const canonicalCwd = canonical(cwd);
    let targetId: string | null = null;
    let targetPath = '';
    let how: GroupingPlanItem['how'] = 'exact';

    if (canonicalCwd !== null && pathToId.has(canonicalCwd)) {
      targetId = pathToId.get(canonicalCwd) ?? null;
      targetPath = canonicalCwd;
    } else {
      const mapped = input.maps?.get(cwd);
      if (mapped !== undefined) {
        const c = canonical(mapped);
        if (c !== null && pathToId.has(c)) {
          targetId = pathToId.get(c) ?? null;
          targetPath = c;
          how = 'mapped';
        }
      }
      if (targetId === null) {
        // 按 basename 推断：唯一命中才认（歧义不猜）
        const ids = baselineIds.get(baseName(cwd)) ?? [];
        const only = ids.length === 1 ? ids[0] : undefined;
        if (only !== undefined) {
          const ws = input.workspaces.find((w) => w.id === only);
          if (ws !== undefined) {
            targetId = only;
            targetPath = ws.path;
            how = 'inferred';
          }
        }
      }
    }

    if (targetId === null) {
      ungrouped.push({ rel: session.rel, id: session.id, cwd, reason: '没有工作区路径与这个会话的 cwd 对应' });
      continue;
    }

    const needsRewrite = canonicalCwd !== targetPath;
    items.push({
      id: session.id,
      rel: session.rel,
      action: needsRewrite ? 'rewrite+group' : 'group',
      workspace: targetId,
      how,
      from: cwd,
      to: targetPath,
      needsRewrite,
    });
  }

  return { items, ungrouped };
}

function defaultCanonical(p: string): string | null {
  try {
    return realpathSync(p);
  } catch {
    return null;
  }
}
