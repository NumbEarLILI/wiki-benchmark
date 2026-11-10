import { useEffect, useState } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import { FlaskConical, Plus, Trash2 } from 'lucide-react';
import { api } from '../api';
import { duration, fmtTime, STATUS, useAsync, type Async } from '../lib';
import type { Run } from '../types';
import { Badge, Button, Card, Empty, ErrorBox, Field, Input, Modal, PageHeader, Progress, Select, cx } from '../components/ui';

function NewRunModal({ open, onClose }: { open: boolean; onClose: () => void }) {
  const navigate = useNavigate();
  const datasets = useAsync(api.datasets, [open]);
  const connectors = useAsync(api.connectors, [open]);
  const settings = useAsync(api.settings, [open]);
  const [name, setName] = useState('');
  const [datasetId, setDatasetId] = useState('');
  const [selected, setSelected] = useState<string[]>([]);
  const [topK, setTopK] = useState(5);
  const [concurrency, setConcurrency] = useState(4);
  const [timeoutSec, setTimeoutSec] = useState(60);
  const [useJudge, setUseJudge] = useState(false);
  const [error, setError] = useState<string>();
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!datasetId && datasets.data?.[0]) setDatasetId(datasets.data[0].id);
  }, [datasets.data, datasetId]);
  useEffect(() => {
    if (settings.data) setUseJudge(settings.data.judge.enabled);
  }, [settings.data]);

  const toggle = (id: string) => setSelected((s) => (s.includes(id) ? s.filter((x) => x !== id) : [...s, id]));

  const submit = async () => {
    setSaving(true);
    setError(undefined);
    try {
      const run = await api.createRun({ name: name.trim() || undefined, datasetId, connectorIds: selected, topK, concurrency, timeoutMs: timeoutSec * 1000, useJudge });
      navigate(`/runs/${run.id}`);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setSaving(false);
    }
  };

  const judgeReady = settings.data?.judge.enabled && settings.data.judge.model;
  const ds = datasets.data?.find((d) => d.id === datasetId);

  return (
    <Modal open={open} onClose={onClose} wide title="新建评测任务" footer={<><Button onClick={onClose}>取消</Button><Button variant="primary" loading={saving} disabled={!datasetId || !selected.length} onClick={submit}>开始评测</Button></>}>
      <div className="grid gap-4 sm:grid-cols-2">
        <Field label="任务名称"><Input value={name} onChange={(e) => setName(e.target.value)} placeholder="留空自动生成" /></Field>
        <Field label="测评集" required help={ds ? `${ds.itemCount} 题 · 带参考答案 ${ds.withAnswer} · 带相关文档 ${ds.withDocs}` : undefined}>
          <Select value={datasetId} onChange={(e) => setDatasetId(e.target.value)}>
            {datasets.data?.map((d) => <option key={d.id} value={d.id}>{d.name}（{d.itemCount} 题）</option>)}
          </Select>
        </Field>
      </div>

      <div className="mt-5">
        <div className="mb-2 flex items-center justify-between">
          <span className="text-xs font-medium text-slate-700">参评知识库<span className="ml-0.5 text-rose-500">*</span><span className="ml-2 font-normal text-slate-400">已选 {selected.length}</span></span>
          <button className="text-xs font-medium text-indigo-600" onClick={() => setSelected(selected.length === connectors.data?.length ? [] : connectors.data?.map((c) => c.id) ?? [])}>
            {selected.length === connectors.data?.length ? '取消全选' : '全选'}
          </button>
        </div>
        {connectors.data?.length ? (
          <div className="grid gap-2 sm:grid-cols-2">
            {connectors.data.map((c) => (
              <label key={c.id} className={cx('flex cursor-pointer items-center gap-3 rounded-lg p-3 ring-1 transition', selected.includes(c.id) ? 'bg-indigo-50/60 ring-indigo-400' : 'ring-slate-200 hover:ring-slate-300')}>
                <input type="checkbox" className="size-4 accent-indigo-600" checked={selected.includes(c.id)} onChange={() => toggle(c.id)} />
                <div className="min-w-0">
                  <div className="truncate text-sm font-medium text-slate-900">{c.name}</div>
                  <div className="text-[11px] text-slate-500">{c.type}{c.capabilities.retrieval ? ' · 检索' : ''}{c.capabilities.answer ? ' · 问答' : ''}</div>
                </div>
              </label>
            ))}
          </div>
        ) : (
          <div className="rounded-lg bg-slate-50 p-4 text-center text-xs text-slate-500">还没有接入知识库，<Link to="/connectors" className="text-indigo-600">去接入</Link></div>
        )}
      </div>

      <div className="mt-5 grid gap-4 sm:grid-cols-3">
        <Field label="Top K" help="每题评估前 K 条召回"><Input type="number" min={1} max={50} value={topK} onChange={(e) => setTopK(Number(e.target.value))} /></Field>
        <Field label="并发数" help="单个知识库的并发请求数"><Input type="number" min={1} max={32} value={concurrency} onChange={(e) => setConcurrency(Number(e.target.value))} /></Field>
        <Field label="超时 (秒)"><Input type="number" min={1} value={timeoutSec} onChange={(e) => setTimeoutSec(Number(e.target.value))} /></Field>
      </div>

      <label className={cx('mt-5 flex items-start gap-3 rounded-lg p-3 ring-1 ring-slate-200', !judgeReady && 'opacity-60')}>
        <input type="checkbox" className="mt-0.5 size-4 accent-indigo-600" disabled={!judgeReady} checked={useJudge && !!judgeReady} onChange={(e) => setUseJudge(e.target.checked)} />
        <div>
          <div className="text-sm font-medium text-slate-900">启用 LLM 裁判评分</div>
          <div className="text-xs text-slate-500">{judgeReady ? `使用 ${settings.data?.judge.model} 评估答案正确性与忠实度，答案得分将以裁判分为准。` : <>尚未配置裁判模型，<Link to="/settings" className="text-indigo-600">前往设置</Link>。未启用时使用 F1 / ROUGE-L / 要点覆盖率评估答案。</>}</div>
        </div>
      </label>
      {error && <div className="mt-4"><ErrorBox>{error}</ErrorBox></div>}
    </Modal>
  );
}

export default function Runs() {
  const [params, setParams] = useSearchParams();
  const runs: Async<Run[]> = useAsync(api.runs, [], () => (runs.data?.some((r) => r.status === 'running' || r.status === 'pending') ? 1500 : 0));
  const open = params.get('new') === '1';

  const remove = async (id: string) => {
    if (!confirm('删除该评测任务及其结果？')) return;
    await api.deleteRun(id);
    runs.reload();
  };

  return (
    <>
      <PageHeader title="评测任务" desc="选择测评集与多个知识库，在同一组题目上并行跑分。" actions={<Button variant="primary" onClick={() => setParams({ new: '1' })}><Plus className="size-4" />新建评测</Button>} />
      <Card bodyClass="p-0">
        {runs.data?.length ? (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-slate-100 text-left text-xs font-medium text-slate-500">
                  <th className="px-5 py-2.5">任务</th>
                  <th className="py-2.5 pr-3">参评知识库</th>
                  <th className="py-2.5 pr-3 w-44">进度</th>
                  <th className="py-2.5 pr-3">状态</th>
                  <th className="py-2.5 pr-3">最佳得分</th>
                  <th className="py-2.5 pr-3">耗时</th>
                  <th className="py-2.5 pr-5" />
                </tr>
              </thead>
              <tbody>
                {runs.data.map((r) => {
                  const done = r.summaries.reduce((s, x) => s + x.completed, 0);
                  const total = r.total * r.summaries.length;
                  const best = [...r.summaries].filter((s) => s.metrics).sort((a, b) => b.metrics!.overallScore - a.metrics!.overallScore)[0];
                  return (
                    <tr key={r.id} className="border-b border-slate-50 last:border-0 hover:bg-slate-50/60">
                      <td className="px-5 py-3">
                        <Link to={`/runs/${r.id}`} className="font-medium text-slate-900 hover:text-indigo-600">{r.name}</Link>
                        <div className="mt-0.5 text-xs text-slate-500">{r.datasetName} · Top{r.params.topK} · {fmtTime(r.createdAt)}</div>
                      </td>
                      <td className="py-3 pr-3"><div className="flex max-w-xs flex-wrap gap-1">{r.summaries.map((s) => <Badge key={s.connectorId}>{s.connectorName}</Badge>)}</div></td>
                      <td className="py-3 pr-3"><Progress value={total ? done / total : 0} tone={r.status === 'done' ? 'emerald' : 'indigo'} /><div className="mt-1 text-[11px] text-slate-500">{done} / {total}</div></td>
                      <td className="py-3 pr-3"><Badge tone={STATUS[r.status].tone}>{STATUS[r.status].label}</Badge></td>
                      <td className="py-3 pr-3 text-xs">{best ? <><b className="text-sm text-slate-900">{best.metrics!.overallScore.toFixed(1)}</b> <span className="text-slate-500">{best.connectorName}</span></> : '—'}</td>
                      <td className="py-3 pr-3 text-xs text-slate-500">{duration(r.startedAt, r.finishedAt)}</td>
                      <td className="py-3 pr-5 text-right"><Button size="sm" variant="ghost" onClick={() => remove(r.id)}><Trash2 className="size-3.5 text-rose-500" /></Button></td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        ) : (
          <Empty icon={<FlaskConical className="size-5" />} title="暂无评测任务" action={<Button variant="primary" onClick={() => setParams({ new: '1' })}>新建评测</Button>} />
        )}
      </Card>
      <NewRunModal open={open} onClose={() => { setParams({}); runs.reload(); }} />
    </>
  );
}
