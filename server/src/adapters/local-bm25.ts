import type { AdapterDefinition, DatasetDocument, RetrievedContext } from '../types.js';
import { BM25Index, chunkText, type IndexedChunk } from '../bm25.js';
import { docFileName } from '../corpus.js';
import { demoDocs } from '../seed.js';
import { extractiveAnswer } from './mock.js';
import { num, str } from './http.js';

const cache = new Map<string, BM25Index>();

function buildIndex(documents: DatasetDocument[], chunkSize: number) {
  const chunks: IndexedChunk[] = documents.flatMap((doc) =>
    chunkText(doc.content, chunkSize).map((content, i) => ({ id: `${doc.id}#${i}`, source: docFileName(doc), content })),
  );
  const titleOf = new Map(documents.map((d) => [docFileName(d), d.title]));
  return new BM25Index(chunks, (c) => `${titleOf.get(c.source) ?? ''}\n${c.content}`);
}

function indexFor(documents: DatasetDocument[] | undefined, key: string | undefined, chunkSize: number) {
  const docs = documents?.length ? documents : demoDocs;
  const cacheKey = `${documents?.length ? key ?? 'anon' : 'demo'}|${chunkSize}`;
  let idx = cache.get(cacheKey);
  if (!idx) {
    idx = buildIndex(docs, chunkSize);
    cache.set(cacheKey, idx);
    if (cache.size > 4) cache.delete(cache.keys().next().value!);
  }
  return idx;
}

export const localBm25Adapter: AdapterDefinition = {
  type: 'local-bm25',
  name: '本地检索基线（BM25）',
  description: '直接对测评集自带的文档集合建立 BM25 索引，无需部署任何服务，作为传统关键词检索的参考基线；测评集没有文档时使用内置演示文档。',
  capabilities: ['retrieval', 'answer'],
  fields: [
    { key: 'chunkSize', label: '切片长度（字符）', type: 'number', default: 400 },
    {
      key: 'answerMode',
      label: '答案生成',
      type: 'select',
      default: 'extractive',
      options: [
        { label: '抽取式答案（取最相关句子）', value: 'extractive' },
        { label: '仅检索（不返回答案）', value: 'none' },
      ],
    },
  ],
  resolveCapabilities: (config) => ({ retrieval: true, answer: str(config.answerMode, 'extractive') !== 'none' }),
  async query(config, question, { topK, documents, corpusKey }) {
    const idx = indexFor(documents, corpusKey, Math.max(100, num(config.chunkSize, 400)));
    const contexts: RetrievedContext[] = idx
      .search(question, topK)
      .filter((r) => r.score > 0)
      .map(({ chunk, score }) => ({ id: chunk.id, source: chunk.source, content: chunk.content, score: Number(score.toFixed(4)) }));
    const answer = str(config.answerMode, 'extractive') !== 'none' ? extractiveAnswer(question, contexts) : undefined;
    return { answer, contexts };
  },
};
