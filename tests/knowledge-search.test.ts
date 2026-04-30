import test from 'node:test';
import assert from 'node:assert/strict';
import * as fs from 'node:fs/promises';
import * as os from 'node:os';
import * as path from 'node:path';

import {
  chunkMarkdownDocument,
  formatKnowledgeResults,
  loadKnowledgeChunks,
  rankKnowledgeChunks,
  resolveKnowledgeDir,
  searchKnowledgeBase,
  tokenizeForSearch,
} from '../knowledge-search.ts';

async function createKnowledgeRoot(): Promise<string> {
  const projectRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'wechat-knowledge-'));
  await fs.mkdir(path.join(projectRoot, 'knowledge', 'products'), { recursive: true });
  await fs.mkdir(path.join(projectRoot, 'knowledge', 'policies'), { recursive: true });
  await fs.writeFile(
    path.join(projectRoot, 'knowledge', 'README.md'),
    '# 说明\n\n这个文件不应该进入检索结果。\n',
  );
  await fs.writeFile(
    path.join(projectRoot, 'knowledge', 'products', '花瓣沙发.md'),
    [
      '# 花瓣沙发',
      '',
      '## 核心卖点',
      '',
      '- 造型柔和，适合法式、奶油风、现代轻奢空间。',
      '- 坐感偏软，但仍有支撑，不是塌陷型。',
      '',
      '## 回复注意',
      '',
      '客户问价格时，先问尺寸和材质，不要直接报死价。',
    ].join('\n'),
  );
  await fs.writeFile(
    path.join(projectRoot, 'knowledge', 'policies', '售后说明.md'),
    [
      '# 售后说明',
      '',
      '## 质保',
      '',
      '质保问题需要结合品类、材质和订单情况确认。',
    ].join('\n'),
  );
  return projectRoot;
}

test('resolveKnowledgeDir points to the project knowledge folder', () => {
  assert.equal(
    resolveKnowledgeDir('/tmp/wechat-project'),
    '/tmp/wechat-project/knowledge',
  );
});

test('tokenizeForSearch creates Chinese ngrams and latin tokens', () => {
  const tokens = tokenizeForSearch('花瓣沙发 core selling points');

  assert.ok(tokens.includes('花瓣沙发'));
  assert.ok(tokens.includes('花瓣'));
  assert.ok(tokens.includes('沙发'));
  assert.ok(tokens.includes('core'));
});

test('chunkMarkdownDocument splits sections with source metadata', () => {
  const chunks = chunkMarkdownDocument({
    sourcePath: '/tmp/knowledge/products/花瓣沙发.md',
    relativePath: 'products/花瓣沙发.md',
    content: '# 花瓣沙发\n\n## 核心卖点\n\n坐感偏软，但仍有支撑。',
  });

  assert.equal(chunks.length, 1);
  assert.equal(chunks[0].title, '花瓣沙发');
  assert.equal(chunks[0].heading, '核心卖点');
  assert.equal(chunks[0].relativePath, 'products/花瓣沙发.md');
});

test('loadKnowledgeChunks reads markdown files and skips the knowledge README', async () => {
  const projectRoot = await createKnowledgeRoot();
  const chunks = await loadKnowledgeChunks({ projectRoot });

  assert.ok(chunks.some((chunk) => chunk.relativePath === 'products/花瓣沙发.md'));
  assert.ok(!chunks.some((chunk) => chunk.relativePath === 'README.md'));
});

test('rankKnowledgeChunks prefers product and selling point matches', async () => {
  const projectRoot = await createKnowledgeRoot();
  const chunks = await loadKnowledgeChunks({ projectRoot });
  const results = rankKnowledgeChunks(chunks, '客户问花瓣沙发有什么卖点', 3);

  assert.equal(results[0].relativePath, 'products/花瓣沙发.md');
  assert.match(results[0].text, /造型柔和|坐感偏软/);
});

test('searchKnowledgeBase returns top matching snippets', async () => {
  const projectRoot = await createKnowledgeRoot();
  const results = await searchKnowledgeBase('质保怎么说', { projectRoot });

  assert.equal(results[0].relativePath, 'policies/售后说明.md');
});

test('formatKnowledgeResults includes sources and handles empty results', () => {
  assert.equal(formatKnowledgeResults([]), '（没有检索到相关资料）');

  const formatted = formatKnowledgeResults([
    {
      sourcePath: '/tmp/knowledge/products/花瓣沙发.md',
      relativePath: 'products/花瓣沙发.md',
      title: '花瓣沙发',
      heading: '核心卖点',
      text: '坐感偏软，但仍有支撑。',
      score: 12,
    },
  ]);

  assert.match(formatted, /资料 1：花瓣沙发 \/ 核心卖点/);
  assert.match(formatted, /来源：products\/花瓣沙发.md/);
});
