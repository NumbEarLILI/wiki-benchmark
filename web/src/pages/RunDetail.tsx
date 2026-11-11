import { Fragment, useEffect, useMemo, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { ArrowLeft, Check, ChevronDown, ChevronRight, Download, RotateCcw, Scale, Square, X } from 'lucide-react';
import { api } from '../api';
import { duration, fmtTime, METRICS, ms, pct, score, scoreTone, STATUS, useAsync, type Async } from '../lib';
import type { AggregateMetrics, DatasetItem, ItemMetrics, ItemResult, Run, ScoreWeights } from '../types';
import { Badge, Button, Card, ErrorBox, Field, Input, Modal, PageHeader, Progress, ScoreRing, Select, Tabs, cx } from '../components/ui';
import { LatencyBars, RadarCompare, ScoreBars } from '../components/charts';
import { TraceView } from '../components/Trace';

function itemAnswerScore(m: ItemMetrics): number | undefined {
  if (m.judgeCorrectness !== undefined) return m.judgeCorrectness;
  const parts = [m.answerCoverage, m.f1, m.rougeL].filter((v): v is number => v !== undefined);
  return parts.length ? parts.reduce((a, b) => a + b, 0) / parts.length : undefined;
}

export function ResultDetail({ result, item, docTitles }: { result: ItemResult; item?: DatasetItem; docTitles?: Record<string, string> }) {
  const shown = METRICS.filter((m) => result.metrics[m.key] !== undefined);
  return (
    <div className="space-y-4 text-sm">
      <div className="flex flex-wrap items-center gap-2">
        <Badge tone={result.status === 'ok' ? 'green' : 'red'}>{result.status === 'ok' ? '成功' : '失败'}</Badge>
        <span className="text-xs text-slate-500">耗时 {ms(result.latencyMs)}</span>
        {shown.map((m) => (
          <span key={m.key} title={m.desc} className="rounded-md bg-slate-100 px-1.5 py-0.5 text-xs text-slate-600">
            {m.label} <b className="text-slate-900">{m.key === 'mrr' || m.key === 'ndcg' ? result.metrics[m.key]!.toFixed(2) : pct(result.metrics[m.key], 0)}</b>
          </span>
        ))}
      </div>
      {result.error && <ErrorBox>{result.error}</ErrorBox>}
      <div className="grid gap-3 md:grid-cols-2">
        <div className="rounded-lg bg-indigo-50/50 p-3 ring-1 ring-indigo-100">
          <div className="mb-1 text-xs font-medium text-indigo-700">知识库答案</div>
          <div className="whitespace-pre-wrap text-slate-800">{result.answer ?? <span className="text-slate-400">（未返回答案）</span>}</div>
          {result.judgeReason && <div className="mt-2 border-t border-indigo-100 pt-2 text-xs text-slate-600"><b>裁判点评：</b>{result.judgeReason}</div>}
        </div>
        <div className="rounded-lg bg-emerald-50/50 p-3 ring-1 ring-emerald-100">
          <div className="mb-1 text-xs font-medium text-emerald-700">参考答案</div>
          <div className="whitespace-pre-wrap text-slate-800">{item?.referenceAnswer ?? <span className="text-slate-400">（未提供）</span>}</div>
          <div className="mt-2 flex flex-wrap gap-1">
            {item?.relevantDocs?.slice(0, 8).map((d) => <Badge key={d} tone="blue" className="max-w-64 truncate">{docTitles?.[d] ?? d}</Badge>)}
            {item?.keywords?.map((k) => <Badge key={k} tone="amber">{k}</Badge>)}
          </div>
        </div>
      </div>
      <div>
        <div className="mb-1.5 text-xs font-medium text-slate-500">召回片段（{result.contexts.length}）</div>
        <div className="space-y-1.5">
          {result.contexts.map((c, i) => {
            const rel = result.relevantFlags[i];
            return (
              <div key={i} className={cx('rounded-lg p-2.5 text-xs ring-1', rel ? 'bg-emerald-50/40 ring-emerald-200' : 'bg-white ring-slate-200')}>
                <div className="mb-1 flex items-center gap-2 text-slate-500">
                  <span className="font-mono">#{i + 1}</span>
                  {rel !== undefined && (rel ? <Badge tone="green"><Check className="size-3" />相关</Badge> : <Badge><X className="size-3" />不相关</Badge>)}
                  {c.source && <span className="font-medium text-slate-700">{c.source}</span>}
                  {c.score !== undefined && <span>score {Number(c.score).toFixed(3)}</span>}
                </div>
                <div className="whitespace-pre-wrap text-slate-700">{c.content}</div>
              </div>
            );
          })}
          {!result.contexts.length && <div className="text-xs text-slate-400">（未返回召回片段）</div>}
        </div>
      </div>
      <TraceView trace={result.trace} />
    </div>
  );
}

function WeightsModal({ open, onClose, initial, onApply }: { open: boolean; onClose: () => void; initial: ScoreWeights; onApply: (w: ScoreWeights) => Promise<void> }) {
  const [w, setW] = useState(initial);
  const [saving, setSaving] = useState(false);
  useEffect(() => setW(initial), [initial, open]);
  const keys: { k: keyof ScoreWeights; label: string }[] = [
    { k: 'retrieval', label: '检索权重' },
    { k: 'answer', label: '答案权重' },
    { k: 'performance', label: '性能权重' },
  ];
  return (
    <Modal open={open} onClose={onClose} title="调整评分权重" footer={<><Button onClick={onClose}>取消</Button><Button variant="primary" loading={saving} onClick={async () => { setSaving(true); await onApply(w); setSaving(false); onClose(); }}>重新计分</Button></>}>
      <p className="mb-4 text-xs text-slate-500">基于已有结果重新计算综合得分，不会重新请求知识库。权重会自动归一化；某维度缺失时（例如仅检索的知识库没有答案分），剩余维度按比例分摊。</p>
      <div className="grid grid-cols-3 gap-3">
        {keys.map(({ k, label }) => <Field key={k} label={label}><Input type="number" step="0.05" min={0} value={w[k]} onChange={(e) => setW({ ...w, [k]: Number(e.target.value) })} /></Field>)}
      </div>
    </Modal>
  );
}

interface MetricRow {
  key: string;
  label: string;
  desc?: string;
  get: (m: AggregateMetrics) => number | undefined;
  fmt: (v?: number) => string;
  lowerBetter?: boolean;
}

function fmtMetric(key: string, v?: number) {
  if (v === undefined) return '—';
  if (key === 'mrr' || key === 'ndcg') return v.toFixed(3);
  return pct(v);
}

export default function RunDetail() {
  const { id = '' } = useParams();
  const navigate = useNavigate();
  const run: Async<Run> = useAsync(() => api.run(id), [id], () => (run.data?.status === 'running' || run.data?.status === 'pending' ? 1200 : 0));
  const dataset = useAsync(() => (run.data ? api.dataset(run.data.datasetId).catch(() => undefined) : Promise.resolve(undefined)), [run.data?.datasetId]);
  const [expanded, setExpanded] = useState<string>();
  const [activeConn, setActiveConn] = useState<string>('');
  const [filter, setFilter] = useState<'all' | 'miss' | 'error'>('all');
  const [weightsOpen, setWeightsOpen] = useState(false);

  const r = run.data;
  const summaries = r?.summaries ?? [];
  const itemsById = useMemo(() => new Map((dataset.data?.items ?? []).map((i) => [i.id, i])), [dataset.data]);

  const byItem = useMemo(() => {
    const m = new Map<string, { question: string; results: Map<string, ItemResult> }>();
    for (const res of r?.results ?? []) {
      if (!m.has(res.itemId)) m.set(res.itemId, { question: res.question, results: new Map() });
      m.get(res.itemId)!.results.set(res.connectorId, res);
    }
    const order = dataset.data?.items.map((i) => i.id) ?? [];
    return [...m.entries()].sort((a, b) => order.indexOf(a[0]) - order.indexOf(b[0]));
  }, [r?.results, dataset.data]);

  const rows = byItem.filter(([, v]) => {
    const list = [...v.results.values()];
    if (filter === 'error') return list.some((x) => x.status === 'error');
    if (filter === 'miss') return list.some((x) => x.status === 'error' || x.metrics.hit === 0 || (itemAnswerScore(x.metrics) ?? 1) < 0.5);
    return true;
  });

  const series = summaries.filter((s) => s.metrics).map((s) => ({ name: s.connectorName, metrics: s.metrics! }));
  const allRows: MetricRow[] = [
    { key: 'overall', label: '综合得分', get: (m) => m.overallScore, fmt: score },
    { key: 'retrievalScore', label: '检索得分', get: (m) => m.retrievalScore, fmt: score },
    { key: 'answerScore', label: '答案得分', get: (m) => m.answerScore, fmt: score },
    { key: 'performanceScore', label: '性能得分', get: (m) => m.performanceScore, fmt: score },
    ...METRICS.map((d) => ({ key: d.key, label: d.label, desc: d.desc, get: (m: AggregateMetrics) => m[d.key], fmt: (v?: number) => fmtMetric(d.key, v) })),
    { key: 'successRate', label: '成功率', get: (m) => m.successRate, fmt: (v) => pct(v) },
    { key: 'latencyAvg', label: '平均延迟', get: (m) => m.latencyAvg, fmt: ms, lowerBetter: true },
    { key: 'latencyP50', label: 'P50 延迟', get: (m) => m.latencyP50, fmt: ms, lowerBetter: true },
    { key: 'latencyP95', label: 'P95 延迟', get: (m) => m.latencyP95, fmt: ms, lowerBetter: true },
  ];
  const metricRows = allRows.filter((row) => series.some((s) => row.get(s.metrics) !== undefined));

  if (run.error) return <ErrorBox>{run.error}</ErrorBox>;
  if (!r) return <div className="text-sm text-slate-500">加载中…</div>;

  const running = r.status === 'running' || r.status === 'pending';

  return (
    <>
      <Link to="/runs" className="mb-3 inline-flex items-center gap-1 text-xs font-medium text-slate-500 hover:text-slate-700"><ArrowLeft className="size-3.5" />返回任务列表</Link>
      <PageHeader
        title={r.name}
        desc={`${r.datasetName} · ${r.total} 题 · Top${r.params.topK} · 并发 ${r.params.concurrency}${r.params.useJudge ? ' · LLM 裁判' : ''} · 创建于 ${fmtTime(r.createdAt)} · 耗时 ${duration(r.startedAt, r.finishedAt)}`}
        actions={
          <>
            <Badge tone={STATUS[r.status].tone} className="mr-1">{STATUS[r.status].label}</Badge>
            {running && <Button variant="danger" onClick={() => api.cancelRun(r.id).then(run.reload)}><Square className="size-3.5" />停止</Button>}
            {!running && <Button onClick={() => setWeightsOpen(true)}><Scale className="size-4" />调整权重</Button>}
            {!running && <Button onClick={() => api.rerun(r.id).then((n) => navigate(`/runs/${n.id}`))}><RotateCcw className="size-4" />重跑</Button>}
            <a href={`/api/runs/${r.id}/export`}><Button><Download className="size-4" />导出 CSV</Button></a>
          </>
        }
      />
      {r.error && <div className="mb-4"><ErrorBox>{r.error}</ErrorBox></div>}

      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
        {[...summaries].sort((a, b) => (b.metrics?.overallScore ?? -1) - (a.metrics?.overallScore ?? -1)).map((s, rank) => (
          <div key={s.connectorId} className="rounded-xl bg-white p-5 ring-1 ring-slate-200/80 shadow-sm">
            <div className="flex items-start gap-4">
              <ScoreRing value={s.metrics?.overallScore} size={72} label="综合" />
              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-2">
                  {s.metrics && r.status === 'done' && rank === 0 && summaries.length > 1 && <Badge tone="amber">冠军</Badge>}
                  <span className="truncate font-semibold text-slate-900">{s.connectorName}</span>
                </div>
                <div className="mt-0.5 text-xs text-slate-500">{s.connectorType} · <span className={s.status === 'running' ? 'text-sky-600' : ''}>{STATUS[s.status].label}</span></div>
                <div className="mt-3 grid grid-cols-3 gap-2 text-center">
                  {[['检索', s.metrics?.retrievalScore], ['答案', s.metrics?.answerScore], ['性能', s.metrics?.performanceScore]].map(([l, v]) => (
                    <div key={l as string} className="rounded-md bg-slate-50 py-1.5">
                      <div className={cx('text-sm font-semibold tabular-nums', scoreTone(v as number | undefined))}>{score(v as number | undefined)}</div>
                      <div className="text-[10px] text-slate-500">{l}</div>
                    </div>
                  ))}
                </div>
              </div>
            </div>
            <div className="mt-4"><Progress value={s.completed / r.total} tone={s.status === 'done' ? 'emerald' : 'indigo'} /></div>
            <div className="mt-1 flex justify-between text-[11px] text-slate-500"><span>{s.completed} / {r.total}</span><span>P50 {ms(s.metrics?.latencyP50)} · 成功率 {pct(s.metrics?.successRate, 0)}</span></div>
          </div>
        ))}
      </div>

      {series.length > 0 && (
        <div className="mt-6 grid gap-6 lg:grid-cols-2">
          <Card title="分项得分"><ScoreBars series={series} /></Card>
          <Card title="能力雷达"><RadarCompare series={series} height={280} /></Card>
        </div>
      )}

      {series.length > 0 && (
        <Card className="mt-6" title="指标明细" bodyClass="p-0">
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-slate-100 text-left text-xs font-medium text-slate-500">
                  <th className="px-5 py-2.5">指标</th>
                  {series.map((s) => <th key={s.name} className="py-2.5 pr-5 text-right">{s.name}</th>)}
                </tr>
              </thead>
              <tbody>
                {metricRows.map((row) => {
                  const vals = series.map((s) => row.get(s.metrics));
                  const defined = vals.filter((v): v is number => v !== undefined);
                  const best = defined.length > 1 ? (row.lowerBetter ? Math.min(...defined) : Math.max(...defined)) : undefined;
                  return (
                    <tr key={row.key} className={cx('border-b border-slate-50 last:border-0', row.key === 'overall' && 'bg-slate-50/60 font-semibold')}>
                      <td className="px-5 py-2.5 text-slate-700" title={row.desc}>{row.label}{row.desc && <span className="ml-1 cursor-help text-slate-300">ⓘ</span>}</td>
                      {vals.map((v, i) => <td key={i} className={cx('py-2.5 pr-5 text-right tabular-nums', v !== undefined && v === best && 'text-emerald-600 font-semibold')}>{row.fmt(v)}</td>)}
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </Card>
      )}

      {series.length > 0 && <Card className="mt-6" title="响应延迟分布"><LatencyBars series={series} height={Math.max(150, series.length * 50)} /></Card>}

      <Card
        className="mt-6"
        title={`逐题结果（${rows.length}）`}
        actions={
          <Select value={filter} onChange={(e) => setFilter(e.target.value as typeof filter)} className="h-8 w-40 text-xs">
            <option value="all">全部题目</option>
            <option value="miss">存在未命中 / 低分</option>
            <option value="error">存在请求失败</option>
          </Select>
        }
        bodyClass="p-0"
      >
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-slate-100 text-left text-xs font-medium text-slate-500">
                <th className="w-8 px-3 py-2.5" />
                <th className="py-2.5 pr-3">问题</th>
                {summaries.map((s) => <th key={s.connectorId} className="py-2.5 pr-4 text-center whitespace-nowrap">{s.connectorName}</th>)}
              </tr>
            </thead>
            <tbody>
              {rows.map(([itemId, v]) => {
                const open = expanded === itemId;
                const conn = activeConn && v.results.has(activeConn) ? activeConn : summaries.find((s) => v.results.has(s.connectorId))?.connectorId ?? '';
                return (
                  <Fragment key={itemId}>
                    <tr className={cx('cursor-pointer border-b border-slate-50 hover:bg-slate-50/60', open && 'bg-slate-50/60')} onClick={() => setExpanded(open ? undefined : itemId)}>
                      <td className="px-3 py-3 text-slate-400">{open ? <ChevronDown className="size-4" /> : <ChevronRight className="size-4" />}</td>
                      <td className="py-3 pr-3 font-medium text-slate-800">{v.question}</td>
                      {summaries.map((s) => {
                        const res = v.results.get(s.connectorId);
                        if (!res) return <td key={s.connectorId} className="py-3 pr-4 text-center text-xs text-slate-300">…</td>;
                        if (res.status === 'error') return <td key={s.connectorId} className="py-3 pr-4 text-center"><Badge tone="red">失败</Badge></td>;
                        const a = itemAnswerScore(res.metrics);
                        return (
                          <td key={s.connectorId} className="py-3 pr-4 text-center">
                            <div className="inline-flex items-center gap-1.5">
                              {res.metrics.hit !== undefined && <span title={`命中 · MRR ${res.metrics.mrr?.toFixed(2)}`} className={cx('inline-flex size-5 items-center justify-center rounded-full', res.metrics.hit ? 'bg-emerald-100 text-emerald-600' : 'bg-rose-100 text-rose-500')}>{res.metrics.hit ? <Check className="size-3" /> : <X className="size-3" />}</span>}
                              {a !== undefined && <span title="答案得分" className={cx('w-10 rounded-md px-1 py-0.5 text-xs font-medium tabular-nums', a >= 0.8 ? 'bg-emerald-50 text-emerald-700' : a >= 0.5 ? 'bg-amber-50 text-amber-700' : 'bg-rose-50 text-rose-700')}>{(a * 100).toFixed(0)}</span>}
                              <span className="text-[11px] text-slate-400 tabular-nums">{ms(res.latencyMs)}</span>
                            </div>
                          </td>
                        );
                      })}
                    </tr>
                    {open && (
                      <tr className="border-b border-slate-100 bg-slate-50/40">
                        <td />
                        <td colSpan={summaries.length + 1} className="py-4 pr-5">
                          {summaries.length > 1 && (
                            <div className="mb-3">
                              <Tabs value={conn} onChange={setActiveConn} items={summaries.filter((s) => v.results.has(s.connectorId)).map((s) => ({ value: s.connectorId, label: s.connectorName }))} />
                            </div>
                          )}
                          {v.results.get(conn) && <ResultDetail result={v.results.get(conn)!} item={itemsById.get(itemId)} docTitles={dataset.data?.docTitles} />}
                        </td>
                      </tr>
                    )}
                  </Fragment>
                );
              })}
            </tbody>
          </table>
          {!rows.length && <div className="py-10 text-center text-xs text-slate-400">{running ? '评测进行中，结果将实时出现…' : '没有符合条件的题目'}</div>}
        </div>
      </Card>

      <WeightsModal open={weightsOpen} onClose={() => setWeightsOpen(false)} initial={r.params.weights} onApply={async (w) => run.setData(await api.rescore(r.id, w))} />
    </>
  );
}
