import fs from 'node:fs';
import path from 'node:path';
import { BM25Index, chunkText, type IndexedChunk } from '../bm25.js';
import { demoChunks } from '../adapters/mock.js';
import { DATA_DIR } from '../store.js';

interface StoredDoc {
  id: string;
  title: string;
  content: string;
}

const FILE = path.join(DATA_DIR, 'demo-mcp-docs.json');
let docs: StoredDoc[] = [];
try {
  docs = JSON.parse(fs.readFileSync(FILE, 'utf8'));
} catch {
  docs = [];
}
let index: BM25Index | null = null;
let timer: ReturnType<typeof setTimeout> | undefined;

function persist() {
  index = null;
  clearTimeout(timer);
  timer = setTimeout(() => {
    fs.mkdirSync(DATA_DIR, { recursive: true });
    fs.writeFileSync(FILE, JSON.stringify(docs));
  }, 300);
}

/** 演示 MCP 知识库的可写部分：内置星云云文档 + 通过 add_document 添加的文档 */
export const demoKb = {
  add(title: string, content: string, id?: string) {
    const docId = id || `added-${docs.length + 1}`;
    docs = docs.filter((d) => d.id !== docId);
    docs.push({ id: docId, title, content });
    persist();
    return docId;
  },
  clear() {
    const n = docs.length;
    docs = [];
    persist();
    return n;
  },
  list: () => docs,
  search(query: string, k: number) {
    if (!index) {
      const added: IndexedChunk[] = docs.flatMap((d) => chunkText(d.content).map((content, i) => ({ id: `${d.id}#${i}`, source: d.title, content })));
      index = new BM25Index([...demoChunks, ...added], (c) => `${c.source.replace(/\.md$/, '')} ${c.content}`);
    }
    return index.search(query, k);
  },
};
