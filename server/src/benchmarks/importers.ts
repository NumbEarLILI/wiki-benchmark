import type { DatasetDocument, DatasetItem, DatasetSource } from '../types.js';
import type { JobReporter } from '../jobs.js';
import { benchmarkCatalog, type BeirSpec, type BenchmarkEntry, type MultiHopSpec, type SquadSpec } from './catalog.js';
import { ParquetTable, cleanText, seededRandom, shortTitle, shuffle } from './hf.js';

export interface ImportOptions {
  queries: number;
  distractors: number;
  seed: number;
  split?: string;
}

export interface ImportedDataset {
  name: string;
  description: string;
  documents: DatasetDocument[];
  items: DatasetItem[];
  source: DatasetSource;
}

const MAX_QUERIES = 1000;
const MAX_DISTRACTORS = 10000;

function clampOpts(o: Partial<ImportOptions>, entry: BenchmarkEntry): ImportOptions {
  return {
    queries: Math.max(1, Math.min(MAX_QUERIES, Math.floor(Number(o.queries) || entry.defaults.queries))),
    distractors: Math.max(0, Math.min(MAX_DISTRACTORS, Math.floor(Number(o.distractors ?? entry.defaults.distractors)))),
    seed: Math.floor(Number(o.seed) || 42),
    split: o.split,
  };
}

/** 从 rows 中选出 count 个干扰行号：取若干段连续区间，减少需要读取的 Parquet 行组数 */
function pickDistractors(total: number, count: number, exclude: Set<number>, rand: () => number): number[] {
  const out = new Set<number>();
  const target = Math.min(count, total - exclude.size);
  const block = Math.max(1, Math.min(100, Math.ceil(target / 10)));
  let guard = 0;
  while (out.size < target && guard++ < target * 20 + 100) {
    const start = Math.floor(rand() * Math.max(1, total - block));
    for (let i = start; i < start + block && out.size < target; i++) if (!exclude.has(i)) out.add(i);
  }
  return [...out];
}

async function importBeir(entry: BenchmarkEntry, spec: BeirSpec, o: ImportOptions, report: JobReporter): Promise<Omit<ImportedDataset, 'source'>> {
  const f = spec.fields;
  const rand = seededRandom(o.seed);

  report(0.05, '读取相关性标注（qrels）…');
  const qrelsTable = await ParquetTable.open(spec.qrels);
  const qrels = new Map<string, Set<string>>();
  for (const r of await qrelsTable.readColumns<Record<string, unknown>>([f.qrelQuery, f.qrelDoc, f.qrelScore])) {
    if (Number(r[f.qrelScore]) <= 0) continue;
    const q = String(r[f.qrelQuery]);
    if (!qrels.has(q)) qrels.set(q, new Set());
    qrels.get(q)!.add(String(r[f.qrelDoc]));
  }

  report(0.2, '读取问题集合…');
  const queriesTable = await ParquetTable.open(spec.queries);
  const queryText = new Map<string, string>();
  for (const r of await queriesTable.readColumns<Record<string, unknown>>([f.queryId, f.queryText])) queryText.set(String(r[f.queryId]), cleanText(r[f.queryText]));
  const chosen = shuffle([...qrels.keys()].filter((q) => queryText.get(q)), rand).slice(0, o.queries);

  report(0.35, '读取文档 ID 索引…');
  const corpus = await ParquetTable.open(spec.corpus);
  const ids = (await corpus.readColumns<Record<string, unknown>>([f.docId])).map((r) => String(r[f.docId]));
  const rowOf = new Map(ids.map((id, i) => [id, i]));

  const relevantRows = new Set<number>();
  for (const q of chosen) for (const pid of qrels.get(q)!) if (rowOf.has(pid)) relevantRows.add(rowOf.get(pid)!);
  const distractorRows = pickDistractors(ids.length, o.distractors, relevantRows, rand);

  report(0.5, `抽取 ${relevantRows.size + distractorRows.length} 篇文档内容…`);
  const cols = [f.docId, f.docText, ...(f.docTitle ? [f.docTitle] : [])];
  const rows = await corpus.readRows<Record<string, unknown>>([...relevantRows, ...distractorRows], cols);

  const documents: DatasetDocument[] = [];
  for (const r of rows.values()) {
    const content = cleanText(r[f.docText]);
    if (!content) continue;
    const title = cleanText(f.docTitle ? r[f.docTitle] : '') || shortTitle(content);
    documents.push({ id: String(r[f.docId]), title, content });
  }
  const docIds = new Set(documents.map((d) => d.id));
  const items: DatasetItem[] = chosen
    .map((q) => ({ id: `q-${q}`, question: queryText.get(q)!, relevantDocs: [...qrels.get(q)!].filter((d) => docIds.has(d)), tags: [entry.name] }))
    .filter((it) => it.relevantDocs.length);
  return { name: entry.name, description: entry.description, documents: shuffle(documents, rand), items };
}

async function importSquad(entry: BenchmarkEntry, spec: SquadSpec, o: ImportOptions, report: JobReporter): Promise<Omit<ImportedDataset, 'source'>> {
  const rand = seededRandom(o.seed);
  const split = o.split && spec.splits.includes(o.split) ? o.split : spec.data.split;
  report(0.1, `读取 ${split} 划分…`);
  const table = await ParquetTable.open({ ...spec.data, split });
  const hasTitle = entry.id === 'squad';
  const rows = await table.readColumns<Record<string, any>>(['id', 'context', 'question', 'answers', ...(hasTitle ? ['title'] : [])]);

  report(0.6, '整理段落与问题…');
  const ctxId = new Map<string, string>();
  const docs = new Map<string, DatasetDocument>();
  const perTitle = new Map<string, number>();
  for (const r of rows) {
    const content = String(r.context ?? '').trim();
    if (!content || ctxId.has(content)) continue;
    const id = `p${String(ctxId.size + 1).padStart(5, '0')}`;
    ctxId.set(content, id);
    let title = shortTitle(content, 24);
    if (hasTitle && r.title) {
      const t = String(r.title).replace(/_/g, ' ');
      const n = (perTitle.get(t) ?? 0) + 1;
      perTitle.set(t, n);
      title = `${t} #${n}`;
    }
    docs.set(id, { id, title, content });
  }

  const valid = rows.filter((r) => r.question && (r.answers?.text?.length ?? 0) > 0);
  const chosen = shuffle(valid, rand).slice(0, o.queries);
  const relevant = new Set(chosen.map((r) => ctxId.get(String(r.context).trim())!));
  const others = shuffle([...docs.keys()].filter((id) => !relevant.has(id)), rand).slice(0, o.distractors);
  const keep = new Set([...relevant, ...others]);

  const items: DatasetItem[] = chosen.map((r) => {
    const answers = [...new Set<string>((r.answers.text as string[]).map((a) => String(a).trim()).filter(Boolean))];
    return {
      id: `q-${r.id}`,
      question: String(r.question).trim(),
      referenceAnswer: answers[0],
      relevantDocs: [ctxId.get(String(r.context).trim())!],
      keywords: answers.slice(0, 1),
      tags: [entry.name],
    };
  });
  return { name: entry.name, description: entry.description, documents: shuffle([...docs.values()].filter((d) => keep.has(d.id)), rand), items };
}

async function importMultiHop(entry: BenchmarkEntry, spec: MultiHopSpec, o: ImportOptions, report: JobReporter): Promise<Omit<ImportedDataset, 'source'>> {
  const rand = seededRandom(o.seed);
  report(0.1, '读取新闻语料…');
  const corpusRows = await (await ParquetTable.open(spec.corpus)).readColumns<Record<string, any>>(['title', 'body', 'url', 'source', 'published_at']);
  const all: DatasetDocument[] = corpusRows.map((r, i) => ({
    id: `news-${String(i + 1).padStart(4, '0')}`,
    title: String(r.title ?? '').trim() || `news ${i + 1}`,
    content: [r.source && `${r.source}${r.published_at ? ` · ${String(r.published_at).slice(0, 10)}` : ''}`, String(r.body ?? '').trim()].filter(Boolean).join('\n\n'),
    url: r.url ?? undefined,
  }));
  const byTitle = new Map(all.map((d) => [d.title.toLowerCase(), d.id]));

  report(0.5, '读取多跳问题…');
  const qRows = await (await ParquetTable.open(spec.queries)).readColumns<Record<string, any>>(['query', 'answer', 'question_type', 'evidence_list']);
  const candidates = qRows
    .filter((r) => r.question_type !== 'null_query')
    .map((r) => ({ r, docs: [...new Set<string>((r.evidence_list ?? []).map((e: any) => byTitle.get(String(e.title ?? '').trim().toLowerCase())).filter(Boolean))] }))
    .filter((c) => c.docs.length);
  const chosen = shuffle(candidates, rand).slice(0, o.queries);

  const relevant = new Set(chosen.flatMap((c) => c.docs));
  const others = shuffle(all.filter((d) => !relevant.has(d.id)), rand).slice(0, o.distractors);
  const items: DatasetItem[] = chosen.map(({ r, docs }, i) => {
    const answer = String(r.answer ?? '').trim();
    return {
      id: `q-${String(i + 1).padStart(4, '0')}`,
      question: String(r.query).trim(),
      referenceAnswer: answer,
      relevantDocs: docs,
      keywords: answer && answer.length <= 40 && !/^(yes|no)\.?$/i.test(answer) ? [answer] : undefined,
      tags: [String(r.question_type)],
    };
  });
  return { name: entry.name, description: entry.description, documents: shuffle([...all.filter((d) => relevant.has(d.id)), ...others], rand), items };
}

export async function importBenchmark(id: string, opts: Partial<ImportOptions>, report: JobReporter): Promise<ImportedDataset> {
  const entry = benchmarkCatalog.find((b) => b.id === id);
  if (!entry) throw new Error(`未知的社区评测集：${id}`);
  const o = clampOpts(opts, entry);
  const spec = entry.spec;
  const data =
    spec.format === 'beir' ? await importBeir(entry, spec, o, report) : spec.format === 'squad' ? await importSquad(entry, spec, o, report) : await importMultiHop(entry, spec, o, report);
  if (!data.items.length) throw new Error('抽样后没有可用的问题，请调整参数后重试');
  const split = spec.format === 'squad' ? o.split ?? spec.data.split : spec.format === 'beir' ? spec.qrels.split : spec.queries.split;
  return {
    ...data,
    name: `${entry.name}（${data.items.length} 题 / ${data.documents.length} 篇文档）`,
    source: {
      benchmarkId: entry.id,
      name: `${entry.org} · ${entry.name}`,
      url: entry.homepage,
      license: entry.license,
      split,
      sampling: { queries: o.queries, distractors: o.distractors, seed: o.seed },
    },
  };
}
