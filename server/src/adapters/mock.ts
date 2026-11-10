import type { AdapterDefinition, RetrievedContext } from '../types.js';
import { demoDocs } from '../seed.js';
import { BM25Index, bm25Terms, splitSentences, type IndexedChunk } from '../bm25.js';
import { num, str } from './http.js';

export const demoChunks: IndexedChunk[] = demoDocs.flatMap((doc) => {
  const sents = splitSentences(doc.content);
  const out: IndexedChunk[] = [];
  for (let i = 0; i < sents.length; i += 2) {
    out.push({ id: `${doc.id}#${i / 2}`, source: doc.title, content: sents.slice(i, i + 2).join('') });
  }
  return out;
});

export const demoIndex = new BM25Index(demoChunks, (c) => c.source.replace(/\.md$/, '') + c.content);

export function extractiveAnswer(question: string, contexts: { content: string }[]): string {
  const qTerms = new Set(bm25Terms(question));
  const best = contexts
    .slice(0, 2)
    .flatMap((c) => splitSentences(c.content))
    .map((s) => ({ s, score: bm25Terms(s).filter((t) => qTerms.has(t)).length }))
    .sort((a, b) => b.score - a.score)[0];
  return best?.s ?? '抱歉，知识库中没有找到相关信息。';
}

function seededRandom(seed: string) {
  let h = 2166136261;
  for (const ch of seed) h = Math.imul(h ^ ch.charCodeAt(0), 16777619);
  return () => {
    h = Math.imul(h ^ (h >>> 15), 2246822507);
    h = Math.imul(h ^ (h >>> 13), 3266489909);
    return ((h ^= h >>> 16) >>> 0) / 4294967296;
  };
}

const sleep = (ms: number, signal?: AbortSignal) =>
  new Promise<void>((resolve, reject) => {
    const t = setTimeout(resolve, ms);
    signal?.addEventListener('abort', () => {
      clearTimeout(t);
      reject(new Error('aborted'));
    });
  });

export const mockAdapter: AdapterDefinition = {
  type: 'mock',
  name: '内置演示知识库',
  description: '基于 BM25 的本地演示知识库（星云云产品文档），可调节噪声与延迟，用于体验测评流程或作为基线。',
  capabilities: ['retrieval', 'answer'],
  fields: [
    { key: 'noise', label: '检索噪声 (0-1)', type: 'number', default: 0, help: '每条召回结果被随机替换的概率，用于模拟不同质量的知识库' },
    { key: 'latencyMs', label: '模拟延迟 (ms)', type: 'number', default: 200 },
    {
      key: 'answerMode',
      label: '答案生成',
      type: 'select',
      default: 'extractive',
      options: [
        { label: '抽取式答案', value: 'extractive' },
        { label: '仅检索（不返回答案）', value: 'none' },
      ],
    },
  ],
  async query(config, question, { topK, signal }) {
    const noise = Math.min(1, Math.max(0, num(config.noise, 0)));
    const latency = num(config.latencyMs, 200);
    const rand = seededRandom(`${question}|${noise}`);
    await sleep(latency * (0.6 + rand() * 0.8), signal);

    const ranked = demoIndex.search(question);
    const picked: IndexedChunk[] = [];
    for (const { chunk } of ranked) {
      if (picked.length >= topK) break;
      if (rand() < noise) {
        const r = demoChunks[Math.floor(rand() * demoChunks.length)];
        if (!picked.includes(r)) picked.push(r);
      } else if (!picked.includes(chunk)) {
        picked.push(chunk);
      }
    }
    const scoreOf = new Map(ranked.map((r) => [r.chunk, r.score]));
    const contexts: RetrievedContext[] = picked.map((c) => ({
      id: c.id,
      source: c.source,
      content: c.content,
      score: Number((scoreOf.get(c) ?? 0).toFixed(4)),
    }));

    const answer = str(config.answerMode, 'extractive') !== 'none' ? extractiveAnswer(question, contexts) : undefined;
    return { answer, contexts };
  },
};
