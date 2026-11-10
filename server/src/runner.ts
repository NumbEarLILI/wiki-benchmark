import { capabilitiesOf, getAdapter } from './adapters/index.js';
import { aggregate, evaluateAnswer, evaluateRetrieval } from './metrics.js';
import { judgeAnswer } from './judge.js';
import { db, now, save } from './store.js';
import type { Connector, DatasetItem, ItemResult, Run } from './types.js';

const controllers = new Map<string, AbortController>();

async function pool<T>(items: T[], concurrency: number, worker: (item: T) => Promise<void>, signal: AbortSignal) {
  let idx = 0;
  const runners = Array.from({ length: Math.max(1, Math.min(concurrency, items.length)) }, async () => {
    while (idx < items.length && !signal.aborted) {
      const item = items[idx++];
      await worker(item);
    }
  });
  await Promise.all(runners);
}

function withTimeout(parent: AbortSignal, ms: number) {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(new Error(`请求超时 (${ms}ms)`)), ms);
  const onAbort = () => ctrl.abort(new Error('任务已取消'));
  parent.addEventListener('abort', onAbort);
  return {
    signal: ctrl.signal,
    done: () => {
      clearTimeout(t);
      parent.removeEventListener('abort', onAbort);
    },
  };
}

export async function evaluateItem(
  connector: Connector,
  item: DatasetItem,
  run: Pick<Run, 'params'>,
  signal: AbortSignal,
): Promise<ItemResult> {
  const adapter = getAdapter(connector.type);
  const caps = capabilitiesOf(connector.type, connector.config);
  const base: ItemResult = {
    itemId: item.id,
    connectorId: connector.id,
    question: item.question,
    status: 'ok',
    latencyMs: 0,
    contexts: [],
    relevantFlags: [],
    metrics: {},
  };
  const t = withTimeout(signal, run.params.timeoutMs);
  const started = performance.now();
  try {
    const res = await adapter.query(connector.config, item.question, { topK: run.params.topK, signal: t.signal });
    base.latencyMs = Math.round(performance.now() - started);
    base.answer = res.answer;
    if (res.trace?.length) base.trace = res.trace;
    base.contexts = (res.contexts ?? []).map((c) => ({ ...c, content: String(c.content ?? '').slice(0, 4000) }));
  } catch (e) {
    base.latencyMs = Math.round(performance.now() - started);
    const reason = t.signal.reason instanceof Error ? t.signal.reason.message : undefined;
    return { ...base, status: 'error', error: reason ?? (e as Error).message };
  } finally {
    t.done();
  }

  if (caps.retrieval) {
    const r = evaluateRetrieval(item, base.contexts, run.params.topK);
    if (r) {
      base.relevantFlags = r.flags;
      Object.assign(base.metrics, r.metrics);
    }
  }
  if (caps.answer && base.answer !== undefined) {
    Object.assign(base.metrics, evaluateAnswer(item, base.answer));
    const judge = db.settings.judge;
    if (run.params.useJudge && judge.enabled && judge.model) {
      try {
        const j = await judgeAnswer(judge, item, base.answer, base.contexts, signal);
        base.metrics.judgeCorrectness = j.correctness;
        if (j.faithfulness !== undefined) base.metrics.judgeFaithfulness = j.faithfulness;
        base.judgeReason = j.reason;
      } catch (e) {
        base.judgeReason = `裁判调用失败：${(e as Error).message}`;
      }
    }
  }
  for (const k of Object.keys(base.metrics) as (keyof typeof base.metrics)[]) {
    if (base.metrics[k] === undefined) delete base.metrics[k];
  }
  return base;
}

function aggOpts(run: Run) {
  return { weights: run.params.weights, latencyTargetMs: db.settings.latencyTargetMs, latencyMaxMs: db.settings.latencyMaxMs };
}

export function recomputeSummaries(run: Run) {
  for (const s of run.summaries) {
    const rs = run.results.filter((r) => r.connectorId === s.connectorId);
    s.completed = rs.length;
    if (rs.length) s.metrics = aggregate(rs, aggOpts(run));
  }
}

export async function executeRun(run: Run) {
  const dataset = db.datasets.find((d) => d.id === run.datasetId);
  if (!dataset) {
    run.status = 'error';
    run.error = '测评集不存在';
    save();
    return;
  }
  const ctrl = new AbortController();
  controllers.set(run.id, ctrl);
  run.status = 'running';
  run.startedAt = now();
  save();

  try {
    // 各知识库串行执行，避免相互抢占带宽影响延迟指标；单个知识库内部按并发数并行
    for (const summary of run.summaries) {
      if (ctrl.signal.aborted) break;
      const connector = db.connectors.find((c) => c.id === summary.connectorId);
      if (!connector) {
        summary.status = 'error';
        continue;
      }
      summary.status = 'running';
      save();
      await pool(
        dataset.items,
        run.params.concurrency,
        async (item) => {
          const res = await evaluateItem(connector, item, run, ctrl.signal);
          if (ctrl.signal.aborted) return;
          run.results.push(res);
          const rs = run.results.filter((r) => r.connectorId === summary.connectorId);
          summary.completed = rs.length;
          summary.metrics = aggregate(rs, aggOpts(run));
          save();
        },
        ctrl.signal,
      );
      summary.status = ctrl.signal.aborted ? 'cancelled' : 'done';
    }
    run.status = ctrl.signal.aborted ? 'cancelled' : 'done';
  } catch (e) {
    run.status = 'error';
    run.error = (e as Error).message;
  } finally {
    for (const s of run.summaries) if (s.status === 'pending' || s.status === 'running') s.status = run.status === 'done' ? 'done' : 'cancelled';
    run.finishedAt = now();
    controllers.delete(run.id);
    save(true);
  }
}

export function cancelRun(id: string) {
  controllers.get(id)?.abort();
}

/** 服务重启后，将中断的任务标记为已取消 */
export function recoverRuns() {
  for (const run of db.runs) {
    if (run.status === 'running' || run.status === 'pending') {
      run.status = 'cancelled';
      run.error = '服务重启导致任务中断';
      for (const s of run.summaries) if (s.status === 'running' || s.status === 'pending') s.status = 'cancelled';
    }
  }
}
