/**
 * 会话日志文件（`*.jsonl.zstd`）的**帧级**改写。
 *
 * ## 为什么不能整文件重压
 *
 * dsh 的 `.jsonl.zstd` 是**多帧拼接容器**，不是「整文件压一下」：
 *   - 第 1 帧：只含 SessionHeader 一行（解压后恰好一行、以 `\n` 结尾，加载时硬校验）
 *   - 第 2 帧起：每个持久化批次一帧
 * 所以改写 header 只能**替换第 1 帧、把后面的字节原样接回去**；整文件重压会把批次边界
 * 抹掉，dsh 侧读的时候直接判为坏文件 —— 这类损坏在恢复现场是不可接受的风险。
 *
 * ## 为什么能不解压就算出第 1 帧长度
 *
 * zstd 帧自带长度信息，按规格可推：magic(4) + Frame_Header_Descriptor(1) [+ Window_Descriptor]
 * [+ Dictionary_ID] [+ Frame_Content_Size] + blocks（每块 3 字节头，最后一块 Last_Block 置位）
 * [+ 4 字节校验和]。逐块累加即可得到第 1 帧的字节边界，不需要解压整个文件（几 MB 的会话
 * 只改一行 header 时，这个差别是数量级的）。
 *
 * ## 保守性（每一条都是「宁可不动」）
 *
 * 任一步判断不了就返回失败，**绝不猜**：帧头不合法、第 1 帧解出来不是恰好一行（或多行）、
 * 改写后自证不过 —— 一律放弃并让调用方报 ungrouped。写入本身不在这里做（调用方负责备份、
 * 写回自校验与回滚）。
 */
import { zstdCompressSync, zstdDecompressSync } from 'node:zlib';

/** zstd 帧 magic（小端读取为 0xFD2FB528）。 */
const ZSTD_MAGIC = 0xfd2fb528;
/** 单帧的固定最小长度：magic(4) + FHD(1) + 至少 1 字节块头。 */
const MIN_FRAME_BYTES = 8;

/** 改写结果：成功带新内容，失败带原因（调用方据此报 ungrouped，不要抛错）。 */
export type RewriteOutcome =
  | { ok: true; buffer: Buffer; headerLength: number; bodyLength: number }
  | { ok: false; reason: string };

/**
 * 算第 1 帧的字节长度。
 *
 * @returns 帧长；不是合法 zstd 帧或越界时返回 null（调用方一律当失败处理）
 */
export function firstFrameLength(buf: Buffer): number | null {
  if (buf.length < MIN_FRAME_BYTES) return null;
  if (buf.readUInt32LE(0) !== ZSTD_MAGIC) return null;
  const fhd = buf.readUInt8(4);
  // bit7-6 Frame_Content_Size 标志、bit5 单段标志、bit4 未使用、bit3 保留、bit2 校验和、bit1-0 字典 ID 长度
  if ((fhd & 0x08) !== 0) return null; // 保留位必须为 0，否则不是我们认识的帧
  const fcsFlag = fhd >> 6;
  const singleSegment = (fhd & 0x20) !== 0;
  const checksum = (fhd & 0x04) !== 0;
  const dictIdSize = [0, 1, 2, 4][fhd & 0x03];
  if (dictIdSize === undefined) return null;

  let offset = 5;
  if (!singleSegment) offset += 1; // Window_Descriptor
  offset += dictIdSize; // Dictionary_ID
  // Frame_Content_Size：0 时单段帧占 1 字节、非单段帧不占；1→2 字节、2→4 字节、3→8 字节
  offset += fcsFlag === 0 ? (singleSegment ? 1 : 0) : [0, 2, 4, 8][fcsFlag] ?? 0;
  if (offset + 3 > buf.length) return null;

  for (;;) {
    if (offset + 3 > buf.length) return null;
    const blockHeader = buf.readUIntLE(offset, 3);
    const lastBlock = (blockHeader & 0x01) !== 0;
    const blockType = (blockHeader >> 1) & 0x03;
    const blockSize = blockHeader >> 3; // 21 bit
    if (blockType === 0x03) return null; // 保留块类型
    offset += 3 + blockSize;
    if (offset > buf.length) return null;
    if (lastBlock) break;
  }
  if (checksum) offset += 4;
  if (offset > buf.length) return null;
  return offset;
}

/**
 * 逐帧解压整个容器。
 *
 * **必须逐帧**：Node 的 `zstdDecompressSync` 只解**第一个帧**（多帧输入时后面几帧被静默
 * 忽略），所以直接拿它去解会话文件会「只看到 header、以为文件就这一行」。这里按帧头推边界
 * 一帧帧解、拼起来；帧边界不严丝合缝（有尾巴/有残留）就判失败 —— 这类文件宁可不动。
 */
export function decompressAllFrames(buf: Buffer): Buffer | null {
  const parts: Buffer[] = [];
  let offset = 0;
  let guard = 0;
  while (offset < buf.length) {
    const len = firstFrameLength(buf.subarray(offset));
    if (len === null || len <= 0) return null;
    try {
      parts.push(zstdDecompressSync(buf.subarray(offset, offset + len)));
    } catch {
      return null;
    }
    offset += len;
    if (++guard > 1_000_000) return null; // 病态输入的保护，正常会话远达不到
  }
  return Buffer.concat(parts);
}

/** 在「第 1 帧之后」逐帧解压（自证 body 未被改动用）。 */
function decompressFramesAfter(buf: Buffer, start: number): Buffer | null {
  return decompressAllFrames(buf.subarray(start));
}

/** 解压第 1 帧（只看 header 那一行，不解整个文件）。失败返回 null。 */
export function readHeaderLine(buf: Buffer): string | null {
  const len = firstFrameLength(buf);
  if (len === null) return null;
  try {
    return zstdDecompressSync(buf.subarray(0, len)).toString('utf8');
  } catch {
    return null;
  }
}

/**
 * 把文件内容里的第 1 帧换成「只含 [headerLine] 的新帧」，其余字节原样接回。
 *
 * headerLine 允许带或不带结尾换行；这里统一补成 `\n`（dsh 侧要求恰好一行 + 换行）。
 * 两重自证（不过就返回失败，绝不返回可疑内容）：
 *   1. 新缓冲区的第 1 帧单独解压后，必须**恰好**是这一行；
 *   2. 新缓冲区整体解压后，必须与旧缓冲区整体解压结果**逐字节相同**。
 */
export function rewriteHeader(buf: Buffer, headerLine: string): RewriteOutcome {
  const len = firstFrameLength(buf);
  if (len === null) return { ok: false, reason: 'not-a-zstd-frame' };

  const current = readHeaderLine(buf);
  if (current === null) return { ok: false, reason: 'header-frame-unreadable' };
  // 第 1 帧必须恰好一行（多行说明这不是「header 帧」，改写它会破坏语义）
  if (!current.endsWith('\n') || current.slice(0, -1).includes('\n')) {
    return { ok: false, reason: 'header-frame-not-single-line' };
  }

  const line = headerLine.endsWith('\n') ? headerLine : `${headerLine}\n`;
  let newFrame: Buffer;
  try {
    newFrame = zstdCompressSync(Buffer.from(line, 'utf8'));
  } catch {
    return { ok: false, reason: 'header-compress-failed' };
  }
  const out = Buffer.concat([newFrame, buf.subarray(len)]);

  // 自证 1：新第 1 帧单独解出来必须恰好是这一行
  const recheck = readHeaderLine(out);
  if (recheck !== line) return { ok: false, reason: 'self-check-header-mismatch' };

  // 自证 2：**第 1 帧之后的所有帧**必须解出逐字节相同的内容（批次字节没被动过）。
  // 注意不能用 zstdDecompressSync 直接解整个文件：它只解第一个帧，会让这条自证变成空壳
  // （header 一改，新旧第一帧本来就不同，比的是「新旧 header」而不是 body）。
  const bodyBefore = decompressFramesAfter(buf, len);
  const bodyAfter = decompressFramesAfter(out, newFrame.length);
  if (bodyBefore === null || bodyAfter === null) {
    return { ok: false, reason: 'self-check-decompress-failed' };
  }
  if (!bodyBefore.equals(bodyAfter)) return { ok: false, reason: 'self-check-body-changed' };

  return { ok: true, buffer: out, headerLength: newFrame.length, bodyLength: buf.length - len };
}
