import { describe, expect, it } from 'vitest';
import { tokenize, tokenF1, rougeL, keywordCoverage } from '../src/text.js';
import { aggregate, evaluateAnswer, evaluateRetrieval, percentile } from '../src/metrics.js';
import { getPath, renderTemplate } from '../src/adapters/http.js';
import { parseDatasetText } from '../src/dataset-io.js';
import { mockAdapter } from '../src/adapters/mock.js';
import { extractContexts } from '../src/adapters/custom.js';
import type { ItemResult } from '../src/types.js';

describe('text', () => {
  it('tokenizes mixed CJK and latin', () => {
    expect(tokenize('部署Redis用M7规格!')).toEqual(['部', '署', 'redis', '用', 'm7', '规', '格']);
  });
  it('computes F1 and ROUGE-L', () => {
    expect(tokenF1('7天内退款', '7天内退款')).toBe(1);
    expect(tokenF1('abc', '退款')).toBe(0);
    expect(rougeL('默认保留7天', '默认保留7天最长730天')).toBeGreaterThan(0.5);
  });
  it('keyword coverage ignores punctuation and case', () => {
    expect(keywordCoverage('可用性为 99.99 %', ['99.99%', '赔偿'])).toBe(0.5);
  });
});

describe('retrieval metrics', () => {
  const ctx = (source: string, content = '') => ({ source, content });
  it('scores by relevantDocs', () => {
    const r = evaluateRetrieval({ id: '1', question: 'q', relevantDocs: ['退款政策'] }, [ctx('发票.md'), ctx('退款政策.md')], 5)!;
    expect(r.flags).toEqual([false, true]);
    expect(r.metrics.hit).toBe(1);
    expect(r.metrics.mrr).toBe(0.5);
    expect(r.metrics.recall).toBe(1);
    expect(r.metrics.precision).toBe(0.5);
    expect(r.metrics.ndcg).toBeCloseTo(1 / Math.log2(3));
  });
  it('falls back to keywords', () => {
    const r = evaluateRetrieval({ id: '1', question: 'q', keywords: ['7天', '730天'] }, [ctx('x', '保留7天，最长730天')], 5)!;
    expect(r.metrics.hit).toBe(1);
    expect(r.metrics.contextCoverage).toBe(1);
  });
  it('returns null without any ground truth', () => {
    expect(evaluateRetrieval({ id: '1', question: 'q' }, [], 5)).toBeNull();
  });
  it('respects topK', () => {
    const r = evaluateRetrieval({ id: '1', question: 'q', relevantDocs: ['b'] }, [ctx('a'), ctx('b')], 1)!;
    expect(r.metrics.hit).toBe(0);
  });
});

describe('answer metrics & aggregate', () => {
  it('evaluates answer', () => {
    const m = evaluateAnswer({ id: '1', question: 'q', referenceAnswer: '保留7天', keywords: ['7天'] }, '保留7天');
    expect(m).toMatchObject({ answerCoverage: 1, f1: 1, rougeL: 1 });
  });
  it('counts errored items as zero and renormalizes weights', () => {
    const base = { connectorId: 'c', question: 'q', contexts: [], relevantFlags: [] };
    const results: ItemResult[] = [
      { ...base, itemId: '1', status: 'ok', latencyMs: 100, metrics: { hit: 1, recall: 1, mrr: 1, ndcg: 1 } },
      { ...base, itemId: '2', status: 'error', latencyMs: 100, metrics: {} },
    ];
    const agg = aggregate(results, { weights: { retrieval: 0.5, answer: 0.3, performance: 0.2 }, latencyTargetMs: 1000, latencyMaxMs: 5000 });
    expect(agg.hit).toBe(0.5);
    expect(agg.retrievalScore).toBe(50);
    expect(agg.answerScore).toBeUndefined();
    expect(agg.performanceScore).toBe(50);
    expect(agg.overallScore).toBeCloseTo((50 * 0.5 + 50 * 0.2) / 0.7);
  });
  it('percentile', () => {
    expect(percentile([1, 2, 3, 4, 5, 6, 7, 8, 9, 10], 95)).toBe(10);
    expect(percentile([1, 2, 3, 4], 50)).toBe(2);
  });
});

describe('adapter helpers', () => {
  const raw = { data: { chunks: [{ c: 'a', meta: { doc: 'd1' } }, { c: 'b', meta: { doc: 'd2' } }] } };
  it('getPath supports wildcard', () => {
    expect(getPath(raw, 'data.chunks[*].meta.doc')).toEqual(['d1', 'd2']);
    expect(getPath(raw, 'data.chunks[1].c')).toBe('b');
  });
  it('extracts contexts with field mapping', () => {
    expect(extractContexts(raw, { contextsPath: 'data.chunks', contentField: 'c', sourceField: 'meta.doc' })).toEqual([
      { content: 'a', source: 'd1', id: undefined, score: undefined },
      { content: 'b', source: 'd2', id: undefined, score: undefined },
    ]);
  });
  it('renders template with JSON escaping', () => {
    expect(JSON.parse(renderTemplate('{"q": "{{question}}", "k": {{topK}}}', { question: '他说"你好"\n', topK: 3 }))).toEqual({ q: '他说"你好"\n', k: 3 });
  });
});

describe('dataset import', () => {
  it('parses CSV with aliases and quoted cells', () => {
    const items = parseDatasetText('问题,参考答案,相关文档,关键词\n"退款, 多久",7天,退款政策|FAQ,7天;全额\n');
    expect(items).toHaveLength(1);
    expect(items[0]).toMatchObject({ question: '退款, 多久', referenceAnswer: '7天', relevantDocs: ['退款政策', 'FAQ'], keywords: ['7天', '全额'] });
  });
  it('parses JSONL and JSON array', () => {
    expect(parseDatasetText('{"query":"a"}\n{"query":"b","answer":"x"}')).toHaveLength(2);
    expect(parseDatasetText('[{"question":"a","keywords":["k"]}]')[0].keywords).toEqual(['k']);
  });
});

describe('mock adapter', () => {
  it('retrieves the relevant doc first with zero noise', async () => {
    const res = await mockAdapter.query({ noise: 0, latencyMs: 0 }, 'AccessKey 多久需要轮换一次？', { topK: 3 });
    expect(res.contexts[0].source).toBe('账号安全最佳实践.md');
    expect(res.answer).toContain('90天');
  });
});
