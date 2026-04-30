import * as fs from 'node:fs/promises';
import * as path from 'node:path';

const KNOWLEDGE_DIR_NAME = 'knowledge';
const DEFAULT_TOP_K = 5;
const MAX_CHUNK_CHARS = 1_200;
const MAX_EXCERPT_CHARS = 520;

export interface KnowledgeChunk {
  sourcePath: string;
  relativePath: string;
  title: string;
  heading: string;
  text: string;
}

export interface KnowledgeSearchResult extends KnowledgeChunk {
  score: number;
}

export interface KnowledgeSearchOptions {
  projectRoot?: string;
  knowledgeDir?: string;
  topK?: number;
}

export function resolveKnowledgeDir(projectRoot = process.cwd()): string {
  return path.join(projectRoot, KNOWLEDGE_DIR_NAME);
}

function normalizeText(text: string): string {
  return text.toLowerCase().replace(/\s+/g, ' ').trim();
}

function stripMarkdownSyntax(text: string): string {
  return text
    .replace(/```[\s\S]*?```/g, ' ')
    .replace(/`([^`]+)`/g, '$1')
    .replace(/\[([^\]]+)\]\([^)]+\)/g, '$1')
    .replace(/[*_~>#-]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function addHanNgrams(tokens: Set<string>, segment: string): void {
  if (segment.length <= 12) {
    tokens.add(segment);
  }

  for (let size = 2; size <= 4; size += 1) {
    if (segment.length < size) {
      continue;
    }

    for (let index = 0; index <= segment.length - size; index += 1) {
      tokens.add(segment.slice(index, index + size));
    }
  }
}

export function tokenizeForSearch(text: string): string[] {
  const tokens = new Set<string>();
  const normalized = normalizeText(stripMarkdownSyntax(text));
  const segments = normalized.match(/[\p{Script=Han}]+|[a-z0-9][a-z0-9_-]*/gu) ?? [];

  for (const segment of segments) {
    if (/^[\p{Script=Han}]+$/u.test(segment)) {
      addHanNgrams(tokens, segment);
      continue;
    }

    if (segment.length >= 2) {
      tokens.add(segment);
    }
  }

  return [...tokens];
}

async function listMarkdownFiles(dir: string): Promise<string[]> {
  const entries = await fs.readdir(dir, { withFileTypes: true }).catch((error: any) => {
    if (error?.code === 'ENOENT') {
      return [];
    }

    throw error;
  });
  const files: string[] = [];

  for (const entry of entries) {
    const fullPath = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      files.push(...(await listMarkdownFiles(fullPath)));
      continue;
    }

    if (entry.isFile() && entry.name.endsWith('.md')) {
      files.push(fullPath);
    }
  }

  return files.sort();
}

function splitSectionIntoChunks(input: {
  sourcePath: string;
  relativePath: string;
  title: string;
  heading: string;
  text: string;
}): KnowledgeChunk[] {
  const paragraphs = input.text
    .split(/\n{2,}/)
    .map((paragraph) => paragraph.trim())
    .filter(Boolean);
  const chunks: KnowledgeChunk[] = [];
  let current = '';

  const flush = () => {
    const text = current.trim();
    if (!text) {
      return;
    }

    chunks.push({ ...input, text });
    current = '';
  };

  for (const paragraph of paragraphs) {
    const next = current ? `${current}\n\n${paragraph}` : paragraph;
    if (next.length > MAX_CHUNK_CHARS && current) {
      flush();
      current = paragraph;
    } else {
      current = next;
    }
  }

  flush();
  return chunks;
}

export function chunkMarkdownDocument(input: {
  sourcePath: string;
  relativePath: string;
  content: string;
}): KnowledgeChunk[] {
  const lines = input.content.replace(/\r\n/g, '\n').split('\n');
  const titleLine = lines.find((line) => /^#\s+/.test(line));
  const title = titleLine?.replace(/^#\s+/, '').trim() || path.basename(input.sourcePath, '.md');
  const chunks: KnowledgeChunk[] = [];
  let heading = title;
  let sectionLines: string[] = [];

  const flushSection = () => {
    const text = sectionLines.join('\n').trim();
    if (!text) {
      sectionLines = [];
      return;
    }

    chunks.push(
      ...splitSectionIntoChunks({
        sourcePath: input.sourcePath,
        relativePath: input.relativePath,
        title,
        heading,
        text,
      }),
    );
    sectionLines = [];
  };

  for (const line of lines) {
    const headingMatch = /^(#{1,4})\s+(.+)$/.exec(line);
    if (headingMatch) {
      flushSection();
      heading = headingMatch[2].trim();
      continue;
    }

    sectionLines.push(line);
  }

  flushSection();
  return chunks;
}

export async function loadKnowledgeChunks(
  options: KnowledgeSearchOptions = {},
): Promise<KnowledgeChunk[]> {
  const projectRoot = options.projectRoot ?? process.cwd();
  const knowledgeDir = options.knowledgeDir ?? resolveKnowledgeDir(projectRoot);
  const files = await listMarkdownFiles(knowledgeDir);
  const chunks: KnowledgeChunk[] = [];

  for (const file of files) {
    const relativePath = path.relative(knowledgeDir, file);
    if (relativePath === 'README.md') {
      continue;
    }

    const content = await fs.readFile(file, 'utf8');
    chunks.push(
      ...chunkMarkdownDocument({
        sourcePath: file,
        relativePath,
        content,
      }),
    );
  }

  return chunks;
}

function scoreChunk(chunk: KnowledgeChunk, queryTokens: string[]): number {
  if (queryTokens.length === 0) {
    return 0;
  }

  const title = normalizeText(chunk.title);
  const heading = normalizeText(chunk.heading);
  const body = normalizeText(stripMarkdownSyntax(chunk.text));
  const relativePath = normalizeText(chunk.relativePath);
  let score = 0;

  for (const token of queryTokens) {
    if (title.includes(token)) {
      score += 8;
    }
    if (heading.includes(token)) {
      score += 5;
    }
    if (relativePath.includes(token)) {
      score += 4;
    }
    if (body.includes(token)) {
      score += Math.min(3, Math.ceil(token.length / 2));
    }
  }

  return score;
}

export function rankKnowledgeChunks(
  chunks: KnowledgeChunk[],
  query: string,
  topK = DEFAULT_TOP_K,
): KnowledgeSearchResult[] {
  const queryTokens = tokenizeForSearch(query);

  return chunks
    .map((chunk) => ({ ...chunk, score: scoreChunk(chunk, queryTokens) }))
    .filter((result) => result.score > 0)
    .sort((left, right) => right.score - left.score || left.relativePath.localeCompare(right.relativePath))
    .slice(0, topK);
}

export async function searchKnowledgeBase(
  query: string,
  options: KnowledgeSearchOptions = {},
): Promise<KnowledgeSearchResult[]> {
  const chunks = await loadKnowledgeChunks(options);
  return rankKnowledgeChunks(chunks, query, options.topK ?? DEFAULT_TOP_K);
}

function truncateText(text: string, maxChars: number): string {
  const normalized = text.replace(/\s+/g, ' ').trim();
  if (normalized.length <= maxChars) {
    return normalized;
  }

  return `${normalized.slice(0, maxChars - 1)}…`;
}

export function formatKnowledgeResults(results: KnowledgeSearchResult[]): string {
  if (results.length === 0) {
    return '（没有检索到相关资料）';
  }

  return results
    .map((result, index) => {
      const heading =
        result.heading && result.heading !== result.title
          ? `${result.title} / ${result.heading}`
          : result.title;
      return [
        `资料 ${index + 1}：${heading}`,
        `来源：${result.relativePath}`,
        `内容：${truncateText(result.text, MAX_EXCERPT_CHARS)}`,
      ].join('\n');
    })
    .join('\n\n');
}
