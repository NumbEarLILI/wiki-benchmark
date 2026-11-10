import type { AdapterDefinition, RetrievedContext } from '../types.js';
import { demoDocs } from '../seed.js';
import { tokenize } from '../text.js';
import { num, str } from './http.js';

interface Chunk {
  id: string;
  source: string;
  content: string;
  terms: string[];
}

function terms(text: string): string[] {
  const t = tokenize(text);
  const out = [...t];
  for (let i = 0; i < t.length - 1; i++) out.push(t[i] + t[i + 1]);
  return out;
}

function splitSentences(text: string): string[] {
  return text.split(/(?<=[。！？；])/).map((s) => s.trim()).filter(Boolean);
}

const chunks: Chunk[] = demoDocs.flatMap((doc) => {
  const sents = splitSentences(doc.content);
  const out: Chunk[] = [];
  for (let i = 0; i < sents.length; i += 2) {
    const content = sents.slice(i, i + 2).join('');
    out.push({ id: `${doc.id}#${i / 2}`, source: doc.title, content, terms: terms(doc.title.replace(/\.md$/, '') + content) });
  }
  return out;
});

const avgLen = chunks.reduce((s, c) => s + c.terms.length, 0) / chunks.length;
const df = new Map<string, number>();
for (const c of chunks) for (const t of new Set(c.terms)) df.set(t, (df.get(t) ?? 0) + 1);

function bm25(query: string): { chunk: Chunk; score: number }[] {
  const q = [...new Set(terms(query))];
  const k1 = 1.2;
  const b = 0.75;
  return chunks
    .map((chunk) => {
      const tf = new Map<string, number>();
      for (const t of chunk.terms) tf.set(t, (tf.get(t) ?? 0) + 1);
      let score = 0;
      for (const t of q) {
        const f = tf.get(t);
        if (!f) continue;
        const idf = Math.log(1 + (chunks.length - (df.get(t) ?? 0) + 0.5) / ((df.get(t) ?? 0) + 0.5));
        score += (idf * f * (k1 + 1)) / (f + k1 * (1 - b + (b * chunk.terms.length) / avgLen));
      }
      return { chunk, score };
    })
    .sort((a, b) => b.score - a.score);
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

    const ranked = bm25(question);
    const picked: Chunk[] = [];
    for (const { chunk } of ranked) {
      if (picked.length >= topK) break;
      if (rand() < noise) {
        const r = chunks[Math.floor(rand() * chunks.length)];
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

    let answer: string | undefined;
    if (str(config.answerMode, 'extractive') !== 'none') {
      const qTerms = new Set(terms(question));
      const sentences = contexts.slice(0, 2).flatMap((c) => splitSentences(c.content));
      const best = sentences
        .map((s) => ({ s, score: terms(s).filter((t) => qTerms.has(t)).length }))
        .sort((a, b) => b.score - a.score)[0];
      answer = best?.s ?? '抱歉，知识库中没有找到相关信息。';
    }
    return { answer, contexts };
  },
};
