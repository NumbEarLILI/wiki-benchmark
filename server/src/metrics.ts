import type { AggregateMetrics, DatasetItem, ItemMetrics, ItemResult, RetrievedContext, ScoreWeights } from './types.js';
import { keywordCoverage, tokenF1, tokenize, rougeL } from './text.js';

const mean = (xs: number[]) => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : 0);

const ESCAPE = /[.*+?^${}()|[\]\\]/g;
const stripExt = (s: string) => s.replace(/\.[a-z0-9]{1,5}$/i, '');

/** 文件名词干：去掉 "#片段序号"、目录与扩展名 */
function stem(ident: string): string {
  const noFrag = ident.replace(/#[^#/]*$/, '');
  return stripExt(noFrag.slice(noFrag.lastIndexOf('/') + 1)).toLowerCase();
}

/**
 * 文档 ID 只做精确匹配：召回片段的 id / 来源词干等于该 ID，或以 "ID__" 开头
 * （导出 / 同步到知识库的文件名约定为 `{id}__{标题}.md`），避免 "1" 误中 "12"。
 */
export function matchesDocId(ctx: RetrievedContext, id: string): boolean {
  const target = id.toLowerCase();
  return [ctx.id, ctx.source].some((v) => {
    if (!v) return false;
    const st = stem(String(v));
    return st === target || st.startsWith(`${target}__`);
  });
}

/** 标题 / 文件名按完整词边界匹配，例如 "退款政策" 命中 "references/退款政策.md"，但 "退款" 不命中 */
export function matchesDocName(ctx: RetrievedContext, name: string): boolean {
  const n = stripExt(name.trim()).toLowerCase();
  if (!n) return false;
  const re = new RegExp(`(^|[^\\p{L}\\p{N}])${n.replace(ESCAPE, '\\$&')}([^\\p{L}\\p{N}]|$)`, 'u');
  return [ctx.id, ctx.source].some((v) => !!v && re.test(String(v).toLowerCase()));
}

export type DocAliases = Map<string, string[]>;

/** 召回片段能解析出测评集中某篇文档的 ID 时，只按 ID 判定，避免同名标题误判 */
function identifiedDoc(ctx: RetrievedContext, aliases: DocAliases): string | undefined {
  for (const v of [ctx.source, ctx.id]) {
    if (!v) continue;
    const st = stem(String(v));
    const head = st.includes('__') ? st.slice(0, st.indexOf('__')) : st;
    for (const cand of [head, st]) if (aliases.has(cand)) return cand;
  }
  return undefined;
}

function matchDoc(ctx: RetrievedContext, doc: string, aliases?: DocAliases): boolean {
  if (matchesDocId(ctx, doc)) return true;
  if (aliases) {
    const known = identifiedDoc(ctx, aliases);
    if (known !== undefined) return known === doc.toLowerCase();
  }
  const names = aliases?.get(doc.toLowerCase());
  if (names) return names.some((n) => matchesDocName(ctx, n));
  return matchesDocName(ctx, doc);
}

function referenceRecall(content: string, reference: string): number {
  const ref = new Set(tokenize(reference));
  if (!ref.size) return 0;
  const got = new Set(tokenize(content));
  let n = 0;
  for (const t of ref) if (got.has(t)) n++;
  return n / ref.size;
}

export interface RetrievalEval {
  flags: boolean[];
  metrics: Pick<ItemMetrics, 'hit' | 'recall' | 'precision' | 'mrr' | 'ndcg' | 'contextCoverage'>;
}

/**
 * 检索相关性判定优先级：
 * 1. relevantDocs：召回片段的 id / 来源命中标注文档（文档 ID 精确匹配，标题按词边界匹配）
 * 2. keywords：片段覆盖至少一半的关键要点
 * 3. referenceAnswer：片段覆盖参考答案 50% 以上的词元
 */
export function evaluateRetrieval(item: DatasetItem, contexts: RetrievedContext[], topK: number, aliases?: DocAliases): RetrievalEval | null {
  const docs = item.relevantDocs?.filter(Boolean) ?? [];
  const keywords = item.keywords?.filter(Boolean) ?? [];
  const reference = item.referenceAnswer?.trim() ?? '';
  if (!docs.length && !keywords.length && !reference) return null;

  const top = contexts.slice(0, topK);
  let flags: boolean[];
  let recall: number;
  let idealCount: number;

  if (docs.length) {
    const found = new Set<string>();
    flags = top.map((ctx) => {
      const matched = docs.filter((d) => matchDoc(ctx, d, aliases));
      matched.forEach((d) => found.add(d));
      return matched.length > 0;
    });
    recall = found.size / docs.length;
    idealCount = Math.min(docs.length, topK);
  } else if (keywords.length) {
    const threshold = keywords.length === 1 ? 1 : 0.5;
    flags = top.map((ctx) => keywordCoverage(ctx.content, keywords) >= threshold);
    recall = keywordCoverage(top.map((c) => c.content).join('\n'), keywords);
    idealCount = Math.max(1, flags.filter(Boolean).length);
  } else {
    flags = top.map((ctx) => referenceRecall(ctx.content, reference) >= 0.5);
    recall = referenceRecall(top.map((c) => c.content).join('\n'), reference);
    idealCount = Math.max(1, flags.filter(Boolean).length);
  }

  const firstRank = flags.indexOf(true);
  const dcg = flags.reduce((s, rel, i) => s + (rel ? 1 / Math.log2(i + 2) : 0), 0);
  let idcg = 0;
  for (let i = 0; i < idealCount; i++) idcg += 1 / Math.log2(i + 2);

  return {
    flags,
    metrics: {
      hit: firstRank >= 0 ? 1 : 0,
      recall,
      precision: top.length ? flags.filter(Boolean).length / top.length : 0,
      mrr: firstRank >= 0 ? 1 / (firstRank + 1) : 0,
      ndcg: idcg ? Math.min(1, dcg / idcg) : 0,
      contextCoverage: keywords.length ? keywordCoverage(top.map((c) => c.content).join('\n'), keywords) : undefined,
    },
  };
}

export function evaluateAnswer(item: DatasetItem, answer: string): Pick<ItemMetrics, 'answerCoverage' | 'f1' | 'rougeL'> {
  const out: Pick<ItemMetrics, 'answerCoverage' | 'f1' | 'rougeL'> = {};
  if (item.keywords?.length) out.answerCoverage = keywordCoverage(answer, item.keywords);
  if (item.referenceAnswer?.trim()) {
    out.f1 = tokenF1(answer, item.referenceAnswer);
    out.rougeL = rougeL(answer, item.referenceAnswer);
  }
  return out;
}

export function percentile(values: number[], p: number): number {
  if (!values.length) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const idx = Math.min(sorted.length - 1, Math.max(0, Math.ceil((p / 100) * sorted.length) - 1));
  return sorted[idx];
}

const METRIC_KEYS: (keyof ItemMetrics)[] = [
  'hit', 'recall', 'precision', 'mrr', 'ndcg', 'contextCoverage',
  'answerCoverage', 'f1', 'rougeL', 'judgeCorrectness', 'judgeFaithfulness',
];

export interface AggregateOptions {
  weights: ScoreWeights;
  latencyTargetMs: number;
  latencyMaxMs: number;
}

function latencyFactor(ms: number, target: number, max: number) {
  if (ms <= target) return 1;
  if (ms >= max) return 0;
  return 1 - (ms - target) / (max - target);
}

/** 失败的题目在其他题目出现过的所有指标上记 0 分，避免"只答对会答的"带来的虚高 */
export function aggregate(results: ItemResult[], opts: AggregateOptions): AggregateMetrics {
  const ok = results.filter((r) => r.status === 'ok');
  const present = METRIC_KEYS.filter((k) => ok.some((r) => r.metrics[k] !== undefined));
  const agg: AggregateMetrics = {
    total: results.length,
    success: ok.length,
    successRate: results.length ? ok.length / results.length : 0,
    latencyAvg: mean(ok.map((r) => r.latencyMs)),
    latencyP50: percentile(ok.map((r) => r.latencyMs), 50),
    latencyP95: percentile(ok.map((r) => r.latencyMs), 95),
    performanceScore: 0,
    overallScore: 0,
  };

  for (const key of present) {
    const vals = results
      .filter((r) => r.status === 'error' || r.metrics[key] !== undefined)
      .map((r) => (r.status === 'error' ? 0 : (r.metrics[key] as number)));
    agg[key] = mean(vals);
  }

  const retrievalParts = (['hit', 'recall', 'mrr', 'ndcg'] as const).map((k) => agg[k]).filter((v): v is number => v !== undefined);
  if (retrievalParts.length) agg.retrievalScore = mean(retrievalParts) * 100;

  const judgeParts = (['judgeCorrectness', 'judgeFaithfulness'] as const).map((k) => agg[k]).filter((v): v is number => v !== undefined);
  const lexicalParts = (['answerCoverage', 'f1', 'rougeL'] as const).map((k) => agg[k]).filter((v): v is number => v !== undefined);
  if (judgeParts.length) agg.answerScore = mean(judgeParts) * 100;
  else if (lexicalParts.length) agg.answerScore = mean(lexicalParts) * 100;

  const lf = ok.length
    ? (latencyFactor(agg.latencyP50, opts.latencyTargetMs, opts.latencyMaxMs) +
        latencyFactor(agg.latencyP95, opts.latencyTargetMs, opts.latencyMaxMs)) / 2
    : 0;
  agg.performanceScore = agg.successRate * lf * 100;

  const parts: [number | undefined, number][] = [
    [agg.retrievalScore, opts.weights.retrieval],
    [agg.answerScore, opts.weights.answer],
    [agg.performanceScore, opts.weights.performance],
  ];
  const usable = parts.filter(([v, w]) => v !== undefined && w > 0) as [number, number][];
  const wsum = usable.reduce((s, [, w]) => s + w, 0);
  agg.overallScore = wsum ? usable.reduce((s, [v, w]) => s + v * w, 0) / wsum : 0;
  return agg;
}
