import express, { type NextFunction, type Request, type Response } from 'express';
import cors from 'cors';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { adapters, capabilitiesOf, getAdapter } from './adapters/index.js';
import { db, isFreshDb, newId, now, save } from './store.js';
import { cancelRun, evaluateItem, executeRun, recomputeSummaries, recoverRuns } from './runner.js';
import { normalizeItem, parseDatasetText } from './dataset-io.js';
import { demoDatasetItems } from './seed.js';
import type { Connector, Dataset, DatasetItem, Run, ScoreWeights } from './types.js';

const app = express();
app.use(cors());
app.use(express.json({ limit: '20mb' }));

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
  res.json(adapters.map(({ query: _q, resolveCapabilities: _r, ...rest }) => rest));
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

// ---------- 测评集 ----------
const datasetSummary = ({ items, ...d }: Dataset) => ({
  ...d,
  itemCount: items.length,
  withAnswer: items.filter((i) => i.referenceAnswer).length,
  withDocs: items.filter((i) => i.relevantDocs?.length).length,
  withKeywords: items.filter((i) => i.keywords?.length).length,
});

function cleanItems(items: unknown): DatasetItem[] {
  if (!Array.isArray(items)) return [];
  return items.map((i) => normalizeItem(i as Record<string, unknown>)).filter((x): x is DatasetItem => x !== null);
}

app.get('/api/datasets', (_req, res) => res.json(db.datasets.map(datasetSummary)));

app.get('/api/datasets/:id', (req, res) => {
  const d = db.datasets.find((x) => x.id === req.params.id);
  if (!d) throw new ApiError(404, '测评集不存在');
  res.json(d);
});

app.post('/api/datasets', (req, res) => {
  const { name, description, items } = req.body ?? {};
  if (!name) throw new ApiError(400, '名称必填');
  const d: Dataset = { id: newId('ds'), name, description, items: cleanItems(items), createdAt: now(), updatedAt: now() };
  db.datasets.push(d);
  save();
  res.json(d);
});

app.post('/api/datasets/parse', (req, res) => {
  try {
    res.json({ items: parseDatasetText(String(req.body?.content ?? '')) });
  } catch (e) {
    throw new ApiError(400, `解析失败：${(e as Error).message}`);
  }
});

app.put('/api/datasets/:id', (req, res) => {
  const d = db.datasets.find((x) => x.id === req.params.id);
  if (!d) throw new ApiError(404, '测评集不存在');
  const { name, description, items } = req.body ?? {};
  if (name !== undefined) d.name = name;
  if (description !== undefined) d.description = description;
  if (items !== undefined) d.items = cleanItems(items);
  d.updatedAt = now();
  save();
  res.json(d);
});

app.delete('/api/datasets/:id', (req, res) => {
  db.datasets = db.datasets.filter((x) => x.id !== req.params.id);
  save();
  res.json({ ok: true });
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
    const { connectorId, item, topK } = req.body ?? {};
    const c = db.connectors.find((x) => x.id === connectorId);
    if (!c) throw new ApiError(404, '知识库不存在');
    const it = normalizeItem(item ?? {});
    if (!it) throw new ApiError(400, '问题不能为空');
    const params = { topK: Number(topK) || 5, concurrency: 1, timeoutMs: 60000, useJudge: true, weights: db.settings.weights };
    res.json(await evaluateItem(c, it, { params }, new AbortController().signal));
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
    runs: db.runs.length,
    running: db.runs.filter((r) => r.status === 'running').length,
  });
});

// ---------- 设置 ----------
app.get('/api/settings', (_req, res) => {
  res.json({ ...db.settings, judge: { ...db.settings.judge, apiKey: maskValue(db.settings.judge.apiKey) } });
});

app.put('/api/settings', (req, res) => {
  const body = req.body ?? {};
  if (body.judge) {
    const apiKey = typeof body.judge.apiKey === 'string' && body.judge.apiKey.startsWith(MASK) ? db.settings.judge.apiKey : body.judge.apiKey;
    db.settings.judge = { ...db.settings.judge, ...body.judge, apiKey: apiKey ?? db.settings.judge.apiKey };
  }
  if (body.weights) db.settings.weights = { ...db.settings.weights, ...body.weights };
  if (body.latencyTargetMs !== undefined) db.settings.latencyTargetMs = Number(body.latencyTargetMs);
  if (body.latencyMaxMs !== undefined) db.settings.latencyMaxMs = Number(body.latencyMaxMs);
  save();
  res.json({ ...db.settings, judge: { ...db.settings.judge, apiKey: maskValue(db.settings.judge.apiKey) } });
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
function seed() {
  const ds: Dataset = {
    id: newId('ds'),
    name: '星云云产品问答（演示）',
    description: '内置演示测评集，与「内置演示知识库」配套，覆盖计费、产品规格、安全、SLA 等场景。',
    items: demoDatasetItems.map((i) => ({ ...i, id: newId('q') })),
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
  db.connectors.push(...kbs);
  save(true);
  createRun({ datasetId: ds.id, connectorIds: kbs.map((k) => k.id), topK: 5, concurrency: 6, name: '演示评测：三个演示知识库对比' });
}

recoverRuns();
if (isFreshDb && process.env.NO_SEED !== '1') seed();

const port = Number(process.env.PORT) || 8787;
app.listen(port, () => console.log(`[kb-benchmark] API listening on http://localhost:${port}`));
