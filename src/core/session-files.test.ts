/**
 * 会话文件帧级改写的用例：夹具**现场用 node:zlib 生成真实的多帧容器**
 * （「header 一行」压一帧 + 「批次若干行」压一帧再拼接），不用任何二进制夹具文件。
 *
 * 重点钉住两件最容易做错的事：帧长度必须靠帧头算（不能靠解压），
 * 以及两种失败路径必须真的**放弃**而不是返回可疑内容。
 */
import assert from 'node:assert/strict';
import { zstdCompressSync, zstdDecompressSync } from 'node:zlib';
import test from 'node:test';
import { decompressAllFrames, firstFrameLength, readHeaderLine, rewriteHeader } from './session-files.ts';

/** 造一个合规的多帧容器：第 1 帧只有 header 一行，后面每帧一个批次。 */
function makeSessionFile(header: string, batches: string[][]): Buffer {
  const frames = [zstdCompressSync(Buffer.from(header.endsWith('\n') ? header : `${header}\n`, 'utf8'))];
  for (const batch of batches) frames.push(zstdCompressSync(Buffer.from(batch.join('\n') + '\n', 'utf8')));
  return Buffer.concat(frames);
}

test('按帧头算出第 1 帧长度，与「解压后只剩后面几帧」互相印证', () => {
  const header = '{"id":"sess-1","cwd":"/root/workspace/456"}';
  const file = makeSessionFile(header, [['{"a":1}'], ['{"b":2}']]);
  const len = firstFrameLength(file);
  assert.equal(typeof len, 'number');
  assert.ok(len !== null && len > 0 && len < file.length);
  // 帧边界必须真的落在「第 1 帧之后」：从该位置起的字节应能整体解压出后两批内容
  const body = (decompressAllFrames(file.subarray(len as number)) as Buffer).toString('utf8');
  assert.equal(body, '{"a":1}\n{"b":2}\n');
});

test('读 header 行：只解第 1 帧，拿到恰好一行', () => {
  const file = makeSessionFile('{"id":"sess-1","cwd":"/a"}', [['{"a":1}']]);
  assert.equal(readHeaderLine(file), '{"id":"sess-1","cwd":"/a"}\n');
});

test('改写 header 成功：返回新内容，且批次字节逐字节未变', () => {
  const file = makeSessionFile('{"id":"sess-1","cwd":"/old"}', [['{"a":1}'], ['{"b":2}']]);
  const out = rewriteHeader(file, '{"id":"sess-1","cwd":"/root/workspace/456"}');
  assert.equal(out.ok, true);
  if (!out.ok) return;
  assert.equal(readHeaderLine(out.buffer), '{"id":"sess-1","cwd":"/root/workspace/456"}\n');
  // 整体解压结果除 header 行外必须一致
  const before = (decompressAllFrames(file) as Buffer).toString('utf8').split('\n').slice(1).join('\n');
  const after = (decompressAllFrames(out.buffer) as Buffer).toString('utf8').split('\n').slice(1).join('\n');
  assert.equal(after, before);
  assert.ok(out.bodyLength > 0);
});

test('第 1 帧不是单行（多行）→ 放弃，不猜', () => {
  const file = makeSessionFile('{"id":"sess-1"}\n{"oops":true}', [['{"a":1}']]);
  const out = rewriteHeader(file, '{"id":"sess-1"}');
  assert.equal(out.ok, false);
  if (!out.ok) assert.equal(out.reason, 'header-frame-not-single-line');
});

test('不是 zstd 帧 → 放弃（firstFrameLength 返回 null）', () => {
  const file = Buffer.from('this is not zstd at all, just text\n');
  assert.equal(firstFrameLength(file), null);
  assert.equal(readHeaderLine(file), null);
  const out = rewriteHeader(file, '{"id":"x"}');
  assert.equal(out.ok, false);
  if (!out.ok) assert.equal(out.reason, 'not-a-zstd-frame');
});

test('单帧文件（没有第 2 帧）也能改写，bodyLength 为 0', () => {
  const file = zstdCompressSync(Buffer.from('{"id":"sess-1","cwd":"/a"}\n', 'utf8'));
  const out = rewriteHeader(file, '{"id":"sess-1","cwd":"/b"}');
  assert.equal(out.ok, true);
  if (!out.ok) return;
  assert.equal(out.bodyLength, 0);
  assert.equal((decompressAllFrames(out.buffer) as Buffer).toString('utf8'), '{"id":"sess-1","cwd":"/b"}\n');
});

test('帧头残缺/越界 → 返回 null 而不是抛错；截断只影响后续帧', () => {
  const file = makeSessionFile('{"id":"sess-1"}', [['{"a":1}']]);
  const len = firstFrameLength(file);
  assert.ok(len !== null && len > 0);
  const frameLen = len as number;
  // 把第 1 帧本身截断 → 判失败（不能拿残缺帧去算长度）
  for (const cut of [0, 1, 4, 5, frameLen - 1]) {
    assert.equal(firstFrameLength(file.subarray(0, cut)), null, `截断到 ${cut} 字节应判失败`);
  }
  // 第 1 帧完整时长度照旧：帧长只由第 1 帧自身决定（后面几帧截不截都不影响）
  assert.equal(firstFrameLength(file.subarray(0, frameLen)), frameLen);
});
