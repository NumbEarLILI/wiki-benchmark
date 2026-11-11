import express, { type NextFunction, type Request, type Response } from 'express';
import cors from 'cors';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { adapters, capabilitiesOf, getAdapter } from './adapters/index.js';
import { DATA_DIR, db, isFreshDb, newId, now, save } from './store.js';
import { cancelRun, corpusOf, evaluateItem, executeRun, recomputeSummaries, recoverRuns } from './runner.js';
import { normalizeItem, parseDatasetText } from './dataset-io.js';
import { demoDatasetDocuments, demoDatasetItemsWithIds } from './seed.js';
import { benchmarkCatalog } from './benchmarks/catalog.js';
import { importBenchmark } from './benchmarks/importers.js';
import { importFiles, resolveRelevantDocs } from './benchmarks/files.js';
import { getJob, startJob } from './jobs.js';
import { docFileName, docMarkdown, skillFiles, writeSkillDir } from './corpus.js';
import { createZip } from './zip.js';

import { closeAllMcpClients, listMcpTools } from './adapters/mcp.js';
import { handleDemoMcp } from './demo/mcp-server.js';
import type { Connector, Dataset, DatasetDocument, DatasetItem, Run, ScoreWeights } from './types.js';

const app = express();
app.use(cors());
app.use(express.json({ limit: '100mb' }));

const wrap =
  (fn: (req: Request, res: Response) => unknown) =>
  (req: Request, res: Response, next: NextFunction) =>
    Promise.resolve(fn(req, res)).catch(next);

class ApiError extends Error {
  constructor(public status: number, message: string) {
    super(message);
  }
}

// ---------- 密钥脱敏 ----------
const MASK = '••••••';
function secretKeys(type: string) {
  return getAdapter(type).fields.filter((f) => f.type === 'password').map((f) => f.key);
}
function maskValue(v: unknown) {
  const s = String(v ?? '');
  return s ? `${MASK}${s.slice(-4)}` : '';
}
function maskConnector(c: Connector): Connector & { capabilities: { retrieval: boolean; answer: boolean } } {
  const config = { ...c.config };
  for (const k of secretKeys(c.type)) if (config[k]) config[k] = maskValue(config[k]);
  return { ...c, config, capabilities: capabilitiesOf(c.type, c.config) };
}
function unmask(type: string, incoming: Record<string, unknown>, existing?: Record<string, unknown>) {
  const out = { ...incoming };
  for (const k of secretKeys(type)) {
    if (typeof out[k] === 'string' && (out[k] as string).startsWith(MASK)) out[k] = existing?.[k] ?? '';
  }
  return out;
}

// ---------- 适配器 ----------
app.get('/api/adapters', (_req, res) => {
  res.json(adapters.map(({ query: _q, resolveCapabilities: _r, ingest, ...rest }) => ({ ...rest, ingest: !!ingest })));
});

// ---------- 知识库接入 ----------
app.get('/api/connectors', (_req, res) => res.json(db.connectors.map(maskConnector)));

app.post('/api/connectors', (req, res) => {
  const { name, type, description, config } = req.body ?? {};
  if (!name || !type) throw new ApiError(400, '名称与类型必填');
  getAdapter(type);
  const c: Connector = { id: newId('kb'), name, type, description, config: config ?? {}, createdAt: now(), updatedAt: now() };
  db.connectors.push(c);
  save();
  res.json(maskConnector(c));
});

app.put('/api/connectors/:id', (req, res) => {
  const c = db.connectors.find((x) => x.id === req.params.id);
  if (!c) throw new ApiError(404, '知识库不存在');
  const { name, type, description, config } = req.body ?? {};
  if (type) getAdapter(type);
  const nextType = type ?? c.type;
  Object.assign(c, {
    name: name ?? c.name,
    type: nextType,
    description: description ?? c.description,
    config: config ? unmask(nextType, config, nextType === c.type ? c.config : undefined) : c.config,
    updatedAt: now(),
  });
  save();
  res.json(maskConnector(c));
});

app.delete('/api/connectors/:id', (req, res) => {
  db.connectors = db.connectors.filter((x) => x.id !== req.params.id);
  for (const d of db.datasets) if (d.syncs) d.syncs = d.syncs.filter((s) => s.connectorId !== req.params.id);
  save();
  res.json({ ok: true });
});

/** 连通性测试：用一个问题直接调用知识库，返回原始结果便于调试字段映射 */
app.post(
  '/api/connectors/test',
  wrap(async (req, res) => {
    const { id, type, config, question } = req.body ?? {};
    const existing = id ? db.connectors.find((x) => x.id === id) : undefined;
    const t = type ?? existing?.type;
    if (!t) throw new ApiError(400, '缺少知识库类型');
    const cfg = config ? unmask(t, config, existing?.type === t ? existing?.config : undefined) : existing?.config ?? {};
    const adapter = getAdapter(t);
    const started = performance.now();
    try {
      const out = await adapter.query(cfg, question || '你好', { topK: 5, signal: AbortSignal.timeout(30000) });
      res.json({ ok: true, latencyMs: Math.round(performance.now() - started), ...out });
    } catch (e) {
      res.json({ ok: false, latencyMs: Math.round(performance.now() - started), error: (e as Error).message });
    }
  }),
);

/** 获取 MCP 服务的工具列表及推荐参数模板 */
app.post(
  '/api/connectors/mcp-tools',
  wrap(async (req, res) => {
    const { id, config } = req.body ?? {};
    const existing = id ? db.connectors.find((x) => x.id === id) : undefined;
    const cfg = config ? unmask('mcp', config, existing?.type === 'mcp' ? existing?.config : undefined) : existing?.config ?? {};
    try {
      res.json({ ok: true, tools: await listMcpTools(cfg, 0) });
    } catch (e) {
      res.json({ ok: false, error: (e as Error).message, tools: [] });
    }
  }),
);

/** 内置演示 MCP 知识库（Streamable HTTP） */
app.all('/demo/mcp', wrap(handleDemoMcp));

// ---------- 测评集 ----------
const datasetSummary = ({ items, documents, ...d }: Dataset) => ({
  ...d,
  itemCount: items.length,
  documentCount: documents?.length ?? 0,
  withAnswer: items.filter((i) => i.referenceAnswer).length,
  withDocs: items.filter((i) => i.relevantDocs?.length).length,
  withKeywords: items.filter((i) => i.keywords?.length).length,
});

function cleanItems(items: unknown): DatasetItem[] {
  if (!Array.isArray(items)) return [];
  return items.map((i) => normalizeItem(i as Record<string, unknown>)).filter((x): x is DatasetItem => x !== null);
}

function cleanDocs(docs: unknown): DatasetDocument[] {
  if (!Array.isArray(docs)) return [];
  const seen = new Set<string>();
  const out: DatasetDocument[] = [];
  for (const d of docs as any[]) {
    const content = String(d?.content ?? '').trim();
    if (!content) continue;
    let id = String(d.id ?? '').trim() || newId('doc');
    while (seen.has(id)) id = `${id}-${out.length}`;
    seen.add(id);
    out.push({ id, title: String(d.title ?? '').trim() || id, content, url: d.url ? String(d.url) : undefined });
  }
  return out;
}

function findDataset(id: string) {
  const d = db.datasets.find((x) => x.id === id);
  if (!d) throw new ApiError(404, '测评集不存在');
  return d;
}

/** 详情不返回文档正文，只附带问题所引用文档的标题，文档集合分页获取 */
function datasetDetail(d: Dataset) {
  const { documents, ...rest } = d;
  const docTitles: Record<string, string> = {};
  if (documents?.length) {
    const titles = new Map(documents.map((doc) => [doc.id, doc.title]));
    for (const it of d.items) for (const r of it.relevantDocs ?? []) if (titles.has(r)) docTitles[r] = titles.get(r)!;
  }
  return { ...rest, documentCount: documents?.length ?? 0, docTitles };
}

function addDataset(data: Pick<Dataset, 'name' | 'description' | 'items' | 'documents' | 'source'>): Dataset {
  const d: Dataset = { id: newId('ds'), ...data, documents: data.documents?.length ? data.documents : undefined, createdAt: now(), updatedAt: now() };
  db.datasets.push(d);
  save();
  return d;
}

app.get('/api/datasets', (_req, res) => res.json(db.datasets.map(datasetSummary)));

app.get('/api/datasets/:id', (req, res) => res.json(datasetDetail(findDataset(req.params.id))));

app.post('/api/datasets', (req, res) => {
  const { name, description, items, documents } = req.body ?? {};
  if (!name) throw new ApiError(400, '名称必填');
  const docs = cleanDocs(documents);
  res.json(datasetDetail(addDataset({ name, description, documents: docs, items: resolveRelevantDocs(cleanItems(items), docs) })));
});

app.post('/api/datasets/parse', (req, res) => {
  try {
    res.json({ items: parseDatasetText(String(req.body?.content ?? '')) });
  } catch (e) {
    throw new ApiError(400, `解析失败：${(e as Error).message}`);
  }
});

/** 上传文件导入：preview 为 true 时只返回解析结果 */
app.post('/api/datasets/import-files', (req, res) => {
  const { name, description, files, preview } = req.body ?? {};
  if (!Array.isArray(files) || !files.length) throw new ApiError(400, '请选择要导入的文件');
  const parsed = importFiles(files.map((f: any) => ({ name: String(f.name ?? ''), content: String(f.content ?? '') })));
  if (preview) {
    const ids = new Set(parsed.documents.map((d) => d.id));
    const linked = parsed.items.filter((i) => i.relevantDocs?.some((r) => ids.has(r))).length;
    res.json({ documents: parsed.documents.length, items: parsed.items.length, linked, warnings: parsed.warnings, sampleItems: parsed.items.slice(0, 5), sampleDocuments: parsed.documents.slice(0, 5).map((d) => ({ id: d.id, title: d.title, length: d.content.length })) });
    return;
  }
  if (!name) throw new ApiError(400, '名称必填');
  if (!parsed.items.length) throw new ApiError(400, '没有解析到问题，请检查文件格式');
  res.json(datasetDetail(addDataset({ name, description, documents: parsed.documents, items: parsed.items })));
});

app.put('/api/datasets/:id', (req, res) => {
  const d = findDataset(req.params.id);
  const { name, description, items } = req.body ?? {};
  if (name !== undefined) d.name = name;
  if (description !== undefined) d.description = description;
  if (items !== undefined) d.items = resolveRelevantDocs(cleanItems(items), d.documents ?? []);
  d.updatedAt = now();
  save();
  res.json(datasetDetail(d));
});

app.delete('/api/datasets/:id', (req, res) => {
  db.datasets = db.datasets.filter((x) => x.id !== req.params.id);
  save();
  res.json({ ok: true });
});

// ---------- 测评集文档集合 ----------
app.get('/api/datasets/:id/documents', (req, res) => {
  const d = findDataset(req.params.id);
  const q = String(req.query.q ?? '').trim().toLowerCase();
  const offset = Math.max(0, Number(req.query.offset) || 0);
  const limit = Math.max(1, Math.min(200, Number(req.query.limit) || 20));
  const referenced = new Set(d.items.flatMap((i) => i.relevantDocs ?? []));
  let docs = d.documents ?? [];
  if (q) docs = docs.filter((doc) => doc.id.toLowerCase().includes(q) || doc.title.toLowerCase().includes(q) || doc.content.toLowerCase().includes(q));
  res.json({
    total: docs.length,
    documents: docs.slice(offset, offset + limit).map((doc) => ({
      id: doc.id,
      title: doc.title,
      url: doc.url,
      length: doc.content.length,
      preview: doc.content.slice(0, 160),
      referenced: referenced.has(doc.id),
    })),
  });
});

app.get('/api/datasets/:id/documents/:docId', (req, res) => {
  const doc = findDataset(req.params.id).documents?.find((x) => x.id === req.params.docId);
  if (!doc) throw new ApiError(404, '文档不存在');
  res.json(doc);
});

app.post('/api/datasets/:id/documents', (req, res) => {
  const d = findDataset(req.params.id);
  const incoming = cleanDocs(Array.isArray(req.body?.documents) ? req.body.documents : [req.body]);
  if (!incoming.length) throw new ApiError(400, '文档内容不能为空');
  const existing = new Set((d.documents ?? []).map((x) => x.id));
  for (const doc of incoming) if (existing.has(doc.id)) throw new ApiError(400, `文档 ID 已存在：${doc.id}`);
  d.documents = [...(d.documents ?? []), ...incoming];
  d.updatedAt = now();
  save();
  res.json({ added: incoming.length, documentCount: d.documents.length });
});

app.put('/api/datasets/:id/documents/:docId', (req, res) => {
  const d = findDataset(req.params.id);
  const doc = d.documents?.find((x) => x.id === req.params.docId);
  if (!doc) throw new ApiError(404, '文档不存在');
  const { title, content, url } = req.body ?? {};
  if (title !== undefined) doc.title = String(title).trim() || doc.id;
  if (content !== undefined) {
    if (!String(content).trim()) throw new ApiError(400, '文档内容不能为空');
    doc.content = String(content);
  }
  if (url !== undefined) doc.url = url || undefined;
  d.updatedAt = now();
  save();
  res.json(doc);
});

app.delete('/api/datasets/:id/documents/:docId', (req, res) => {
  const d = findDataset(req.params.id);
  d.documents = (d.documents ?? []).filter((x) => x.id !== req.params.docId);
  d.updatedAt = now();
  save();
  res.json({ ok: true, documentCount: d.documents.length });
});

function sendDownload(res: Response, filename: string, type: string, body: Buffer | string) {
  res.setHeader('Content-Type', type);
  res.setHeader('Content-Disposition', `attachment; filename="download"; filename*=UTF-8''${encodeURIComponent(filename)}`);
  res.send(body);
}

app.get('/api/datasets/:id/export', (req, res) => {
  const d = findDataset(req.params.id);
  const format = String(req.query.format ?? 'json');
  const base = d.name.replace(/[\\/:*?"<>|]+/g, ' ').trim() || d.id;
  if (format === 'json') {
    const { id: _i, createdAt: _c, updatedAt: _u, syncs: _s, ...data } = d;
    return sendDownload(res, `${base}.json`, 'application/json; charset=utf-8', JSON.stringify(data, null, 2));
  }
  if (format === 'corpus-zip') {
    if (!d.documents?.length) throw new ApiError(400, '该测评集没有文档集合');
    return sendDownload(res, `${base}-文档集合.zip`, 'application/zip', createZip(d.documents.map((doc) => ({ name: docFileName(doc), content: docMarkdown(doc) }))));
  }
  if (format === 'skill-zip') {
    if (!d.documents?.length) throw new ApiError(400, '该测评集没有文档集合');
    const files = skillFiles(d);
    const root = files[0].content.match(/^name: (.+)$/m)?.[1] ?? 'kb-skill';
    return sendDownload(res, `${root}.zip`, 'application/zip', createZip(files.map((f) => ({ name: `${root}/${f.name}`, content: f.content }))));
  }
  throw new ApiError(400, `不支持的导出格式：${format}`);
});

/** 把文档集合生成为本地 Skill 目录，并可直接创建 Skill 接入 */
app.post('/api/datasets/:id/skill', (req, res) => {
  const d = findDataset(req.params.id);
  if (!d.documents?.length) throw new ApiError(400, '该测评集没有文档集合');
  const dir = writeSkillDir(d, path.join(DATA_DIR, 'skills'));
  let connector: Connector | undefined;
  if (req.body?.createConnector) {
    connector = {
      id: newId('kb'),
      name: `${d.source?.name.split(' · ').pop() ?? d.name} · Skill`,
      type: 'skill',
      description: `由测评集「${d.name}」的文档集合生成的 Skill 技能包`,
      config: { skillPath: dir, mode: req.body?.mode === 'agent' ? 'agent' : 'retrieval', allowScripts: 'no', maxSteps: 6 },
      createdAt: now(),
      updatedAt: now(),
    };
    db.connectors.push(connector);
    save();
  }
  res.json({ path: dir, connector: connector && maskConnector(connector) });
});

/** 把文档集合导入到被测知识库，保证各家知识库基于同一份语料评测 */
app.post('/api/datasets/:id/sync', (req, res) => {
  const d = findDataset(req.params.id);
  const c = db.connectors.find((x) => x.id === req.body?.connectorId);
  if (!c) throw new ApiError(404, '知识库不存在');
  const adapter = getAdapter(c.type);
  if (!adapter.ingest) throw new ApiError(400, `${adapter.name} 不支持自动导入文档，请导出文档集合后手动上传`);
  if (!d.documents?.length) throw new ApiError(400, '该测评集没有文档集合');
  const docs = d.documents;
  const job = startJob('sync', `同步「${d.name}」到「${c.name}」`, async (report) => {
    report(0, `准备上传 ${docs.length} 篇文档…`);
    const r = await adapter.ingest!(c.config, docs, { onProgress: (done, total) => report(done / total, `已上传 ${done} / ${total}`) });
    d.syncs = [...(d.syncs ?? []).filter((s) => s.connectorId !== c.id), { connectorId: c.id, connectorName: c.name, at: now(), uploaded: r.uploaded, failed: r.failed }];
    save();
    if (!r.uploaded && r.failed) throw new Error(r.errors[0] ?? '全部上传失败');
    return { ...r };
  });
  res.json(job);
});

// ---------- 社区评测集 ----------
app.get('/api/benchmarks', (_req, res) => {
  res.json(
    benchmarkCatalog.map(({ spec, ...b }) => ({
      ...b,
      format: spec.format,
      hfDataset: spec.format === 'beir' ? spec.corpus.dataset : spec.format === 'squad' ? spec.data.dataset : spec.corpus.dataset,
      splits: spec.format === 'squad' ? spec.splits : undefined,
      imported: db.datasets.filter((d) => d.source?.benchmarkId === b.id).map((d) => ({ id: d.id, name: d.name })),
    })),
  );
});

app.post('/api/benchmarks/import', (req, res) => {
  const { benchmarkId, queries, distractors, seed, split, name } = req.body ?? {};
  const entry = benchmarkCatalog.find((b) => b.id === benchmarkId);
  if (!entry) throw new ApiError(404, '未知的社区评测集');
  const job = startJob('benchmark-import', `导入 ${entry.name}`, async (report) => {
    const data = await importBenchmark(entry.id, { queries, distractors, seed, split }, report);
    report(0.95, '保存测评集…');
    const d = addDataset({ ...data, name: String(name || '').trim() || data.name });
    return { datasetId: d.id, documents: data.documents.length, items: data.items.length };
  });
  res.json(job);
});

app.get('/api/jobs/:id', (req, res) => {
  const job = getJob(req.params.id);
  if (!job) throw new ApiError(404, '任务不存在或已过期');
  res.json(job);
});

// ---------- 评测任务 ----------
const runSummary = ({ results: _r, ...run }: Run) => run;

app.get('/api/runs', (_req, res) => {
  res.json([...db.runs].sort((a, b) => b.createdAt.localeCompare(a.createdAt)).map(runSummary));
});

app.get('/api/runs/:id', (req, res) => {
  const run = db.runs.find((x) => x.id === req.params.id);
  if (!run) throw new ApiError(404, '任务不存在');
  res.json(run);
});

function createRun(body: any): Run {
  const dataset = db.datasets.find((d) => d.id === body.datasetId);
  if (!dataset) throw new ApiError(400, '请选择测评集');
  if (!dataset.items.length) throw new ApiError(400, '测评集为空');
  const connectorIds: string[] = (body.connectorIds ?? []).filter((id: string) => db.connectors.some((c) => c.id === id));
  if (!connectorIds.length) throw new ApiError(400, '请至少选择一个知识库');
  const weights: ScoreWeights = { ...db.settings.weights, ...(body.weights ?? {}) };
  const run: Run = {
    id: newId('run'),
    name: body.name || `${dataset.name} · ${new Date().toLocaleString('zh-CN', { hour12: false })}`,
    datasetId: dataset.id,
    datasetName: dataset.name,
    connectorIds,
    params: {
      topK: Math.max(1, Math.min(50, Number(body.topK) || 5)),
      concurrency: Math.max(1, Math.min(32, Number(body.concurrency) || 4)),
      timeoutMs: Math.max(1000, Number(body.timeoutMs) || 60000),
      useJudge: !!body.useJudge,
      weights,
    },
    status: 'pending',
    total: dataset.items.length,
    summaries: connectorIds.map((id) => {
      const c = db.connectors.find((x) => x.id === id)!;
      return { connectorId: id, connectorName: c.name, connectorType: c.type, status: 'pending', completed: 0 };
    }),
    results: [],
    createdAt: now(),
  };
  db.runs.push(run);
  save();
  void executeRun(run);
  return run;
}

app.post('/api/runs', (req, res) => res.json(runSummary(createRun(req.body ?? {}))));

app.post('/api/runs/:id/cancel', (req, res) => {
  cancelRun(req.params.id);
  res.json({ ok: true });
});

app.post('/api/runs/:id/rerun', (req, res) => {
  const old = db.runs.find((x) => x.id === req.params.id);
  if (!old) throw new ApiError(404, '任务不存在');
  res.json(runSummary(createRun({ ...old.params, datasetId: old.datasetId, connectorIds: old.connectorIds, name: `${old.name}（重跑）` })));
});

/** 按新的权重重新计算综合得分，不重新请求知识库 */
app.post('/api/runs/:id/rescore', (req, res) => {
  const run = db.runs.find((x) => x.id === req.params.id);
  if (!run) throw new ApiError(404, '任务不存在');
  run.params.weights = { ...run.params.weights, ...(req.body?.weights ?? {}) };
  recomputeSummaries(run);
  save();
  res.json(run);
});

app.delete('/api/runs/:id', (req, res) => {
  cancelRun(req.params.id);
  db.runs = db.runs.filter((x) => x.id !== req.params.id);
  save();
  res.json({ ok: true });
});

app.get('/api/runs/:id/export', (req, res) => {
  const run = db.runs.find((x) => x.id === req.params.id);
  if (!run) throw new ApiError(404, '任务不存在');
  const names = new Map(run.summaries.map((s) => [s.connectorId, s.connectorName]));
  const cols = ['knowledgeBase', 'question', 'status', 'latencyMs', 'hit', 'recall', 'precision', 'mrr', 'ndcg', 'answerCoverage', 'f1', 'rougeL', 'judgeCorrectness', 'judgeFaithfulness', 'answer', 'error'];
  const esc = (v: unknown) => {
    const s = v === undefined || v === null ? '' : typeof v === 'number' ? String(Number(v.toFixed(4))) : String(v);
    return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };
  const lines = [cols.join(',')];
  for (const r of run.results) {
    const row: Record<string, unknown> = { knowledgeBase: names.get(r.connectorId), question: r.question, status: r.status, latencyMs: r.latencyMs, answer: r.answer, error: r.error, ...r.metrics };
    lines.push(cols.map((c) => esc(row[c])).join(','));
  }
  res.setHeader('Content-Type', 'text/csv; charset=utf-8');
  res.setHeader('Content-Disposition', `attachment; filename="${run.id}.csv"`);
  res.send('\uFEFF' + lines.join('\n'));
});

/** 单题调试：对某个知识库单独跑一道题 */
app.post(
  '/api/debug/evaluate',
  wrap(async (req, res) => {
    const { connectorId, item, topK, datasetId } = req.body ?? {};
    const c = db.connectors.find((x) => x.id === connectorId);
    if (!c) throw new ApiError(404, '知识库不存在');
    const it = normalizeItem(item ?? {});
    if (!it) throw new ApiError(400, '问题不能为空');
    const params = { topK: Number(topK) || 5, concurrency: 1, timeoutMs: 60000, useJudge: true, weights: db.settings.weights };
    const ds = datasetId ? db.datasets.find((x) => x.id === datasetId) : undefined;
    res.json(await evaluateItem(c, it, { params }, new AbortController().signal, corpusOf(ds)));
  }),
);

// ---------- 排行榜 ----------
app.get('/api/leaderboard', (req, res) => {
  const datasetId = String(req.query.datasetId ?? '');
  const runs = db.runs
    .filter((r) => r.status === 'done' && (!datasetId || r.datasetId === datasetId))
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  const latest = new Map<string, any>();
  for (const run of runs) {
    for (const s of run.summaries) {
      const key = `${run.datasetId}:${s.connectorId}`;
      if (latest.has(key) || !s.metrics) continue;
      const c = db.connectors.find((x) => x.id === s.connectorId);
      latest.set(key, {
        connectorId: s.connectorId,
        connectorName: c?.name ?? s.connectorName,
        connectorType: s.connectorType,
        datasetId: run.datasetId,
        datasetName: run.datasetName,
        runId: run.id,
        runAt: run.createdAt,
        topK: run.params.topK,
        metrics: s.metrics,
      });
    }
  }
  res.json([...latest.values()].sort((a, b) => b.metrics.overallScore - a.metrics.overallScore));
});

app.get('/api/stats', (_req, res) => {
  res.json({
    connectors: db.connectors.length,
    datasets: db.datasets.length,
    questions: db.datasets.reduce((s, d) => s + d.items.length, 0),
    documents: db.datasets.reduce((s, d) => s + (d.documents?.length ?? 0), 0),
    runs: db.runs.length,
    running: db.runs.filter((r) => r.status === 'running').length,
  });
});

// ---------- 设置 ----------
const publicSettings = () => ({
  ...db.settings,
  judge: { ...db.settings.judge, apiKey: maskValue(db.settings.judge.apiKey) },
  agent: { ...db.settings.agent, apiKey: maskValue(db.settings.agent.apiKey) },
  hfToken: maskValue(db.settings.hfToken),
});

app.get('/api/settings', (_req, res) => res.json(publicSettings()));

app.put('/api/settings', (req, res) => {
  const body = req.body ?? {};
  if (body.judge) {
    const apiKey = typeof body.judge.apiKey === 'string' && body.judge.apiKey.startsWith(MASK) ? db.settings.judge.apiKey : body.judge.apiKey;
    db.settings.judge = { ...db.settings.judge, ...body.judge, apiKey: apiKey ?? db.settings.judge.apiKey };
  }
  if (body.agent) {
    const apiKey = typeof body.agent.apiKey === 'string' && body.agent.apiKey.startsWith(MASK) ? db.settings.agent.apiKey : body.agent.apiKey;
    db.settings.agent = { ...db.settings.agent, ...body.agent, apiKey: apiKey ?? db.settings.agent.apiKey };
  }
  if (body.weights) db.settings.weights = { ...db.settings.weights, ...body.weights };
  if (body.latencyTargetMs !== undefined) db.settings.latencyTargetMs = Number(body.latencyTargetMs);
  if (body.latencyMaxMs !== undefined) db.settings.latencyMaxMs = Number(body.latencyMaxMs);
  if (body.hfEndpoint !== undefined) db.settings.hfEndpoint = String(body.hfEndpoint).trim() || 'https://huggingface.co';
  if (typeof body.hfToken === 'string' && !body.hfToken.startsWith(MASK)) db.settings.hfToken = body.hfToken.trim();
  save();
  res.json(publicSettings());
});

// ---------- 静态资源（生产模式） ----------
const webDist = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../web/dist');
if (fs.existsSync(webDist)) {
  app.use(express.static(webDist));
  app.get(/^(?!\/api).*/, (_req, res) => res.sendFile(path.join(webDist, 'index.html')));
}

app.use((err: Error, _req: Request, res: Response, _next: NextFunction) => {
  const status = err instanceof ApiError ? err.status : 500;
  res.status(status).json({ error: err.message });
});

// ---------- 初始化演示数据 ----------
const port = Number(process.env.PORT) || 8787;
const DEMO_SKILL_DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../demo/skills/star-cloud-docs');

function seed() {
  const ds: Dataset = {
    id: newId('ds'),
    name: '星云云产品问答（演示）',
    description: '内置演示测评集，与「内置演示知识库」配套，覆盖计费、产品规格、安全、SLA 等场景。',
    items: demoDatasetItemsWithIds.map((i) => ({ ...i, id: newId('q') })),
    documents: demoDatasetDocuments,
    createdAt: now(),
    updatedAt: now(),
  };
  db.datasets.push(ds);
  const mk = (name: string, description: string, config: Record<string, unknown>): Connector => ({
    id: newId('kb'), name, type: 'mock', description, config, createdAt: now(), updatedAt: now(),
  });
  const kbs = [
    mk('演示库 A · 精准检索', '无噪声 BM25，低延迟', { noise: 0, latencyMs: 300, answerMode: 'extractive' }),
    mk('演示库 B · 中等质量', '30% 召回噪声', { noise: 0.3, latencyMs: 900, answerMode: 'extractive' }),
    mk('演示库 C · 低质量', '60% 召回噪声、高延迟', { noise: 0.6, latencyMs: 2500, answerMode: 'extractive' }),
  ];
  const mcp: Connector = {
    id: newId('kb'), name: '演示 MCP 知识库', type: 'mcp', description: '内置演示 MCP 服务（Streamable HTTP），直连 search_knowledge_base 工具',
    config: { transport: 'streamable-http', url: `http://127.0.0.1:${port}/demo/mcp`, mode: 'direct', toolName: 'search_knowledge_base', argsTemplate: '{"query": "{{question}}", "top_k": {{topK}}}', resultAs: 'contexts' },
    createdAt: now(), updatedAt: now(),
  };
  const skill: Connector = {
    id: newId('kb'), name: '演示 Skill 技能包', type: 'skill', description: '内置演示技能（SKILL.md + references），检索模式无需 LLM；配置 Agent 模型后可切换为 Agent 模式',
    config: { skillPath: DEMO_SKILL_DIR, mode: 'retrieval', allowScripts: 'no', maxSteps: 6 },
    createdAt: now(), updatedAt: now(),
  };
  const bm25: Connector = {
    id: newId('kb'), name: '本地 BM25 基线', type: 'local-bm25', description: '直接对测评集文档集合建立 BM25 索引，作为传统关键词检索基线',
    config: { chunkSize: 400, answerMode: 'extractive' },
    createdAt: now(), updatedAt: now(),
  };
  db.connectors.push(...kbs, bm25, mcp, skill);
  save(true);
  createRun({ datasetId: ds.id, connectorIds: [...kbs, bm25, mcp, skill].map((k) => k.id), topK: 5, concurrency: 6, name: '演示评测：多种接入形式对比' });
}

recoverRuns();

const httpServer = app.listen(port, () => {
  console.log(`[kb-benchmark] API listening on http://localhost:${port}`);
  if (isFreshDb && process.env.NO_SEED !== '1') seed();
});

for (const sig of ['SIGINT', 'SIGTERM'] as const) {
  process.once(sig, async () => {
    save(true);
    await closeAllMcpClients();
    httpServer.close();
    process.exit(0);
  });
}
