/**
 * 凭据文件（`~/.dsh/.credentials.yaml`）→「ref → 值」的收集。
 *
 * 为什么要单独一个模块：这份文件的**真实形状**里，凭据并不在顶层，而是挂在
 * 顶层 `refs:` 下面（实测导出包解密后的明文）：
 *
 * ```yaml
 * version: 1
 * records:
 *   client-connection/browser-session:
 *     kind: ...
 *     payload:
 *       secret: ...
 * refs:
 *   RJK66_API_KEY: sk-...
 *   DEEPSEEK_API_KEY: sk-...
 * ```
 *
 * 而收集逻辑原来只看**顶层字符串项**（`Object.entries` + `typeof v === 'string'`）：
 * `refs` 是对象 → 整段被跳过 → 于是「备份里明明带着凭据原文、导入时也解开了，
 * 却照样提示需人工重填」。这里把两种形状都认下来，并明确忽略 `records` 之类嵌套
 * （会话秘密不是凭据 ref，混进去只会污染补录清单）。
 */
import * as yaml from 'js-yaml';

/** 顶层值如果是字符串，本身就是一条凭据（历史形状 / 平铺写法）。 */
function isPlainString(value: unknown): value is string {
  return typeof value === 'string' && value !== '';
}

function collectInto(out: Map<string, string>, value: unknown, onlyRefsBlock: boolean): void {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) return;
  for (const [key, raw] of Object.entries(value as Record<string, unknown>)) {
    if (isPlainString(raw)) {
      out.set(key, raw);
      continue;
    }
    // `refs:` 是本文件里凭据值真正的容身处；其它嵌套（records/payload…）不当凭据。
    if (onlyRefsBlock && key === REFS_BLOCK) collectInto(out, raw, true);
  }
}

/** 凭据值所在的顶层块名（DSH 的 .credentials.yaml 就用这个）。 */
export const REFS_BLOCK = 'refs';

/**
 * 从 `yaml.load()` 的结果里收集「ref → 值」。
 *
 * 顶层字符串项与 `refs:` 块下的字符串项都算凭据；其余嵌套结构忽略。
 */
export function collectCredentialRefs(parsed: unknown): Map<string, string> {
  const out = new Map<string, string>();
  collectInto(out, parsed, true);
  return out;
}

/** 从 YAML 原文收集（解不开就算没有凭据，调用方负责把「解不开」当成别的错误）。 */
export function collectCredentialRefsFromText(text: string): Map<string, string> {
  let parsed: unknown;
  try {
    parsed = yaml.load(text);
  } catch {
    return new Map();
  }
  return collectCredentialRefs(parsed);
}
