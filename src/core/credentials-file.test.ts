/**
 * 凭据文件解析：这里用的夹具就是**实测的真实形状**（来自导出包解密后的明文），
 * 值已替换成假值。
 *
 * 背景：容器把凭据放在顶层 `refs:` 下面，而收集逻辑原来只看顶层字符串项，
 * 于是 `refs` 整个对象被跳过 → 「备份里带着凭据原文、导入时也解开了，却照样提示
 * 需人工重填」。这些用例就是钉住这件事。
 */
import assert from 'node:assert/strict';
import test from 'node:test';
import { collectCredentialRefs, collectCredentialRefsFromText } from './credentials-file.ts';

/** 实测形状（记录段与 refs 段并存）。 */
const REAL_SHAPE = [
  'version: 1',
  'records:',
  '  client-connection/browser-session:',
  '    kind: browser-session',
  '    payload:',
  '      version: 1',
  '      secret: FAKE-SESSION-SECRET-VALUE',
  'refs:',
  '  RJK66_API_KEY: FAKE-RJK66-VALUE-0123456789',
  '  DEEPSEEK_API_KEY: FAKE-DEEPSEEK-VALUE-0123456789',
  '',
].join('\n');

test('凭据在顶层 refs: 块里也能收集到（真实形状）', () => {
  const refs = collectCredentialRefsFromText(REAL_SHAPE);
  assert.equal(refs.get('RJK66_API_KEY'), 'FAKE-RJK66-VALUE-0123456789');
  assert.equal(refs.get('DEEPSEEK_API_KEY'), 'FAKE-DEEPSEEK-VALUE-0123456789');
});

test('records 之类嵌套不当凭据（会话秘密不该进 refs 清单）', () => {
  const refs = collectCredentialRefsFromText(REAL_SHAPE);
  for (const key of refs.keys()) {
    assert.ok(!key.includes('client-connection'), `不该出现 ${key}`);
    assert.ok(key !== 'records' && key !== 'version' && key !== 'kind' && key !== 'payload' && key !== 'secret');
  }
  assert.equal(refs.size, 2);
});

test('平铺写法（顶层即凭据）继续有效', () => {
  const refs = collectCredentialRefsFromText('DEEPSEEK_API_KEY: sk-flat\nOTHER: 1\n');
  assert.equal(refs.get('DEEPSEEK_API_KEY'), 'sk-flat');
});

test('空值/非字符串值不进清单，空文件返回空表', () => {
  assert.equal(collectCredentialRefsFromText('refs:\n  A: ""\n  B: 3\n').size, 0);
  assert.equal(collectCredentialRefsFromText('').size, 0);
});

test('解析结果不是对象时安全返回空表', () => {
  assert.equal(collectCredentialRefs(null).size, 0);
  assert.equal(collectCredentialRefs('nope').size, 0);
  assert.equal(collectCredentialRefs([1, 2]).size, 0);
});

test('YAML 解不开时按「没有凭据」返回，不抛错', () => {
  assert.equal(collectCredentialRefsFromText('refs:\n  - [unbalanced\n').size, 0);
});
