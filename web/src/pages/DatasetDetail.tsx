import { useEffect, useMemo, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { ArrowLeft, Bug, Download, Pencil, Plus, Search, Trash2 } from 'lucide-react';
import { api } from '../api';
import { useAsync } from '../lib';
import type { DatasetItem, ItemResult } from '../types';
import { Badge, Button, Card, Empty, ErrorBox, Field, Input, Modal, PageHeader, Select, Textarea } from '../components/ui';
import { ResultDetail } from './RunDetail';

const join = (v?: string[]) => (v ?? []).join(' | ');
const split = (s: string) => s.split(/[|\n]/).map((x) => x.trim()).filter(Boolean);

function ItemModal({ item, onClose, onSave }: { item?: Partial<DatasetItem>; onClose: () => void; onSave: (i: Partial<DatasetItem>) => void }) {
  const [form, setForm] = useState({ question: '', referenceAnswer: '', relevantDocs: '', keywords: '', tags: '' });
  useEffect(() => {
    if (item) setForm({ question: item.question ?? '', referenceAnswer: item.referenceAnswer ?? '', relevantDocs: join(item.relevantDocs), keywords: join(item.keywords), tags: join(item.tags) });
  }, [item]);
  const set = (k: keyof typeof form) => (e: { target: { value: string } }) => setForm((f) => ({ ...f, [k]: e.target.value }));
  return (
    <Modal
      open={!!item}
      onClose={onClose}
      title={item?.id ? '编辑题目' : '添加题目'}
      footer={<><Button onClick={onClose}>取消</Button><Button variant="primary" disabled={!form.question.trim()} onClick={() => onSave({ ...item, question: form.question.trim(), referenceAnswer: form.referenceAnswer.trim() || undefined, relevantDocs: split(form.relevantDocs), keywords: split(form.keywords), tags: split(form.tags) })}>保存</Button></>}
    >
      <div className="space-y-4">
        <Field label="问题" required><Textarea className="font-sans text-sm" rows={2} value={form.question} onChange={set('question')} /></Field>
        <Field label="参考答案"><Textarea className="font-sans text-sm" rows={3} value={form.referenceAnswer} onChange={set('referenceAnswer')} /></Field>
        <Field label="相关文档" help="文档名或 ID，用 | 分隔；召回片段的来源/ID 包含该值即视为命中"><Input value={form.relevantDocs} onChange={set('relevantDocs')} /></Field>
        <Field label="关键要点" help="用 | 分隔，用于评估召回与答案的要点覆盖率"><Input value={form.keywords} onChange={set('keywords')} /></Field>
        <Field label="标签"><Input value={form.tags} onChange={set('tags')} /></Field>
      </div>
    </Modal>
  );
}

function DebugModal({ item, onClose }: { item?: DatasetItem; onClose: () => void }) {
  const connectors = useAsync(api.connectors);
  const [connectorId, setConnectorId] = useState('');
  const [result, setResult] = useState<ItemResult>();
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string>();
  useEffect(() => {
    setResult(undefined);
    setError(undefined);
  }, [item]);
  useEffect(() => {
    if (!connectorId && connectors.data?.[0]) setConnectorId(connectors.data[0].id);
  }, [connectors.data, connectorId]);
  const run = async () => {
    if (!item) return;
    setLoading(true);
    setError(undefined);
    try {
      setResult(await api.debugEvaluate(connectorId, item, 5));
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setLoading(false);
    }
  };
  return (
    <Modal open={!!item} onClose={onClose} wide title="单题调试">
      <div className="mb-3 text-sm font-medium text-slate-900">{item?.question}</div>
      <div className="flex gap-2">
        <Select value={connectorId} onChange={(e) => setConnectorId(e.target.value)}>
          {connectors.data?.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
        </Select>
        <Button variant="primary" loading={loading} onClick={run} disabled={!connectorId}>运行</Button>
      </div>
      {error && <div className="mt-3"><ErrorBox>{error}</ErrorBox></div>}
      {result && item && <div className="mt-4"><ResultDetail result={result} item={item} /></div>}
    </Modal>
  );
}

export default function DatasetDetail() {
  const { id = '' } = useParams();
  const ds = useAsync(() => api.dataset(id), [id]);
  const [editing, setEditing] = useState<Partial<DatasetItem>>();
  const [debug, setDebug] = useState<DatasetItem>();
  const [q, setQ] = useState('');
  const [error, setError] = useState<string>();

  const items = useMemo(() => (ds.data?.items ?? []).filter((i) => !q || i.question.includes(q) || i.tags?.some((t) => t.includes(q))), [ds.data, q]);

  const persist = async (next: DatasetItem[]) => {
    try {
      ds.setData(await api.updateDataset(id, { items: next }));
    } catch (e) {
      setError((e as Error).message);
    }
  };

  const save = async (it: Partial<DatasetItem>) => {
    const list = ds.data?.items ?? [];
    await persist(it.id ? list.map((x) => (x.id === it.id ? (it as DatasetItem) : x)) : [...list, it as DatasetItem]);
    setEditing(undefined);
  };

  const exportJson = () => {
    const blob = new Blob([JSON.stringify(ds.data?.items ?? [], null, 2)], { type: 'application/json' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = `${ds.data?.name ?? 'dataset'}.json`;
    a.click();
  };

  if (ds.error) return <ErrorBox>{ds.error}</ErrorBox>;

  return (
    <>
      <Link to="/datasets" className="mb-3 inline-flex items-center gap-1 text-xs font-medium text-slate-500 hover:text-slate-700"><ArrowLeft className="size-3.5" />返回测评集</Link>
      <PageHeader
        title={ds.data?.name ?? '加载中…'}
        desc={ds.data?.description}
        actions={<><Button onClick={exportJson}><Download className="size-4" />导出 JSON</Button><Button variant="primary" onClick={() => setEditing({})}><Plus className="size-4" />添加题目</Button></>}
      />
      {error && <div className="mb-4"><ErrorBox>{error}</ErrorBox></div>}
      <Card
        title={`共 ${ds.data?.items.length ?? 0} 题`}
        actions={<div className="relative"><Search className="absolute top-2.5 left-2.5 size-4 text-slate-400" /><Input className="w-56 pl-8" placeholder="搜索问题或标签" value={q} onChange={(e) => setQ(e.target.value)} /></div>}
        bodyClass="p-0"
      >
        {items.length ? (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-slate-100 text-left text-xs font-medium text-slate-500">
                  <th className="px-5 py-2.5 w-10">#</th>
                  <th className="py-2.5 pr-3">问题</th>
                  <th className="py-2.5 pr-3">参考答案</th>
                  <th className="py-2.5 pr-3">相关文档 / 要点</th>
                  <th className="py-2.5 pr-5 text-right">操作</th>
                </tr>
              </thead>
              <tbody>
                {items.map((it, i) => (
                  <tr key={it.id} className="border-b border-slate-50 align-top last:border-0 hover:bg-slate-50/60">
                    <td className="px-5 py-3 text-xs text-slate-400">{i + 1}</td>
                    <td className="py-3 pr-3">
                      <div className="font-medium text-slate-900">{it.question}</div>
                      <div className="mt-1 flex gap-1">{it.tags?.map((t) => <Badge key={t}>{t}</Badge>)}</div>
                    </td>
                    <td className="max-w-xs py-3 pr-3 text-xs text-slate-600">{it.referenceAnswer || <span className="text-slate-300">—</span>}</td>
                    <td className="py-3 pr-3">
                      <div className="flex max-w-xs flex-wrap gap-1">
                        {it.relevantDocs?.map((d) => <Badge key={d} tone="blue">{d}</Badge>)}
                        {it.keywords?.map((k) => <Badge key={k} tone="amber">{k}</Badge>)}
                      </div>
                    </td>
                    <td className="py-3 pr-5 text-right whitespace-nowrap">
                      <Button size="sm" variant="ghost" title="单题调试" onClick={() => setDebug(it)}><Bug className="size-3.5" /></Button>
                      <Button size="sm" variant="ghost" onClick={() => setEditing(it)}><Pencil className="size-3.5" /></Button>
                      <Button size="sm" variant="ghost" onClick={() => confirm('删除该题？') && persist((ds.data?.items ?? []).filter((x) => x.id !== it.id))}><Trash2 className="size-3.5 text-rose-500" /></Button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <Empty title={q ? '没有匹配的题目' : '测评集为空'} action={!q && <Button variant="primary" onClick={() => setEditing({})}>添加题目</Button>} />
        )}
      </Card>
      <ItemModal item={editing} onClose={() => setEditing(undefined)} onSave={save} />
      <DebugModal item={debug} onClose={() => setDebug(undefined)} />
    </>
  );
}
