import { useEffect, useMemo, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { ArrowLeft, Bug, ChevronDown, CloudUpload, Download, ExternalLink, Eye, FileText, Globe2, Pencil, Plus, Puzzle, Search, Trash2 } from 'lucide-react';
import { api } from '../api';
import { download, fmtNum, fmtTime, useAsync, useJob } from '../lib';
import type { Dataset, DatasetDocument, DatasetItem, ItemResult } from '../types';
import { Badge, Button, Card, Empty, ErrorBox, Field, Input, Modal, PageHeader, Progress, Select, Tabs, Textarea } from '../components/ui';
import { ResultDetail } from './RunDetail';

const join = (v?: string[]) => (v ?? []).join(' | ');
const split = (s: string) => s.split(/[|\n]/).map((x) => x.trim()).filter(Boolean);
const PAGE = 20;

function ItemModal({ item, onClose, onSave, hasDocs }: { item?: Partial<DatasetItem>; onClose: () => void; onSave: (i: Partial<DatasetItem>) => void; hasDocs: boolean }) {
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
        <Field label="相关文档" help={hasDocs ? '文档集合中的文档 ID 或标题，用 | 分隔；保存时标题会自动换成 ID' : '文档名或 ID，用 | 分隔；召回片段的来源 / ID 匹配该值即视为命中'}><Input value={form.relevantDocs} onChange={set('relevantDocs')} /></Field>
        <Field label="关键要点" help="用 | 分隔，用于评估召回与答案的要点覆盖率"><Input value={form.keywords} onChange={set('keywords')} /></Field>
        <Field label="标签"><Input value={form.tags} onChange={set('tags')} /></Field>
      </div>
    </Modal>
  );
}

function DebugModal({ item, datasetId, docTitles, onClose }: { item?: DatasetItem; datasetId: string; docTitles: Record<string, string>; onClose: () => void }) {
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
      setResult(await api.debugEvaluate(connectorId, item, 5, datasetId));
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
      {result && item && <div className="mt-4"><ResultDetail result={result} item={item} docTitles={docTitles} /></div>}
    </Modal>
  );
}

function DocModal({ datasetId, docId, creating, onClose, onChanged }: { datasetId: string; docId?: string; creating: boolean; onClose: () => void; onChanged: () => void }) {
  const [doc, setDoc] = useState<DatasetDocument>();
  const [editing, setEditing] = useState(false);
  const [form, setForm] = useState({ id: '', title: '', content: '', url: '' });
  const [error, setError] = useState<string>();
  const [saving, setSaving] = useState(false);
  useEffect(() => {
    setError(undefined);
    setDoc(undefined);
    if (creating) {
      setEditing(true);
      setForm({ id: '', title: '', content: '', url: '' });
    } else if (docId) {
      setEditing(false);
      api.document(datasetId, docId).then(setDoc, (e) => setError(e.message));
    }
  }, [datasetId, docId, creating]);
  const startEdit = () => {
    if (!doc) return;
    setForm({ id: doc.id, title: doc.title, content: doc.content, url: doc.url ?? '' });
    setEditing(true);
  };
  const save = async () => {
    setSaving(true);
    setError(undefined);
    try {
      if (creating) await api.addDocument(datasetId, { id: form.id.trim() || undefined, title: form.title.trim(), content: form.content, url: form.url.trim() || undefined });
      else setDoc(await api.updateDocument(datasetId, doc!.id, { title: form.title, content: form.content, url: form.url }));
      onChanged();
      if (creating) onClose();
      else setEditing(false);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setSaving(false);
    }
  };
  const set = (k: keyof typeof form) => (e: { target: { value: string } }) => setForm((f) => ({ ...f, [k]: e.target.value }));
  return (
    <Modal
      open={creating || !!docId}
      onClose={onClose}
      wide
      title={creating ? '添加文档' : doc?.title ?? '文档'}
      footer={editing ? <><Button onClick={() => (creating ? onClose() : setEditing(false))}>取消</Button><Button variant="primary" loading={saving} disabled={!form.content.trim()} onClick={save}>保存</Button></> : <Button onClick={startEdit} disabled={!doc}><Pencil className="size-4" />编辑</Button>}
    >
      {error && <div className="mb-3"><ErrorBox>{error}</ErrorBox></div>}
      {editing ? (
        <div className="space-y-4">
          <div className="grid gap-4 sm:grid-cols-2">
            {creating && <Field label="文档 ID" help="留空自动生成"><Input value={form.id} onChange={set('id')} /></Field>}
            <Field label="标题"><Input value={form.title} onChange={set('title')} /></Field>
            <Field label="来源链接"><Input value={form.url} onChange={set('url')} /></Field>
          </div>
          <Field label="正文" required><Textarea className="font-sans text-sm leading-relaxed" rows={14} value={form.content} onChange={set('content')} /></Field>
        </div>
      ) : doc ? (
        <>
          <div className="mb-3 flex flex-wrap gap-2 text-xs text-slate-500">
            <Badge>ID：{doc.id}</Badge>
            <Badge>{fmtNum(doc.content.length)} 字符</Badge>
            {doc.url && <a href={doc.url} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 text-indigo-600 hover:underline"><ExternalLink className="size-3" />原文</a>}
          </div>
          <div className="whitespace-pre-wrap rounded-lg bg-slate-50 p-4 text-sm leading-relaxed text-slate-700">{doc.content}</div>
        </>
      ) : (
        !error && <div className="py-10 text-center text-sm text-slate-400">加载中…</div>
      )}
    </Modal>
  );
}

function SyncModal({ open, dataset, onClose, onDone }: { open: boolean; dataset: Dataset; onClose: () => void; onDone: () => void }) {
  const navigate = useNavigate();
  const connectors = useAsync(api.connectors);
  const adapters = useAsync(api.adapters);
  const [connectorId, setConnectorId] = useState('');
  const [error, setError] = useState<string>();
  const [skillMsg, setSkillMsg] = useState<string>();
  const [job, setJob] = useJob(() => onDone());
  const ingestable = useMemo(() => {
    const types = new Set((adapters.data ?? []).filter((a) => a.ingest).map((a) => a.type));
    return (connectors.data ?? []).filter((c) => types.has(c.type));
  }, [adapters.data, connectors.data]);
  useEffect(() => {
    if (open) {
      setJob(undefined);
      setError(undefined);
      setSkillMsg(undefined);
    }
  }, [open, setJob]);
  useEffect(() => {
    if (!connectorId && ingestable[0]) setConnectorId(ingestable[0].id);
  }, [ingestable, connectorId]);
  const running = job?.status === 'running';
  const start = async () => {
    setError(undefined);
    try {
      setJob(await api.syncDataset(dataset.id, connectorId));
    } catch (e) {
      setError((e as Error).message);
    }
  };
  const makeSkill = async () => {
    setError(undefined);
    try {
      const r = await api.createSkill(dataset.id, { createConnector: true });
      setSkillMsg(`已生成 Skill 目录 ${r.path}，并创建接入「${r.connector?.name}」`);
    } catch (e) {
      setError((e as Error).message);
    }
  };
  const result = job?.result as { uploaded: number; failed: number; errors: string[] } | undefined;
  return (
    <Modal open={open} onClose={running ? () => undefined : onClose} title="把文档集合接入被测知识库">
      <p className="text-sm leading-relaxed text-slate-600">
        测评前，被测知识库需要先导入本测评集的 <b>{fmtNum(dataset.documentCount)}</b> 篇文档。文档以 <code className="rounded bg-slate-100 px-1">{'{文档ID}__{标题}.md'}</code> 命名上传，评测时据此精确判定检索命中。
      </p>
      <div className="mt-5 space-y-3">
        <div className="rounded-xl p-4 ring-1 ring-slate-200">
          <div className="flex items-center gap-2 text-sm font-medium text-slate-900"><CloudUpload className="size-4 text-indigo-500" />自动上传到知识库服务</div>
          <p className="mt-1 text-xs text-slate-500">支持 Dify、RAGFlow、FastGPT，使用接入配置中的知识库 ID 与 API Key。上传后知识库需要一段时间完成解析与向量化。</p>
          {ingestable.length ? (
            <div className="mt-3 flex gap-2">
              <Select value={connectorId} onChange={(e) => setConnectorId(e.target.value)} disabled={running}>
                {ingestable.map((c) => <option key={c.id} value={c.id}>{c.name}（{c.type}）</option>)}
              </Select>
              <Button variant="primary" loading={running} disabled={!connectorId} onClick={start}>开始上传</Button>
            </div>
          ) : (
            <div className="mt-3 text-xs text-slate-400">暂无支持自动上传的接入，<Link to="/connectors" className="text-indigo-600 hover:underline">去添加 Dify / RAGFlow / FastGPT 接入</Link></div>
          )}
          {job && (
            <div className="mt-3 space-y-1.5">
              <div className="flex justify-between text-xs text-slate-600"><span>{job.status === 'done' ? `完成：成功 ${result?.uploaded} 篇，失败 ${result?.failed} 篇` : job.status === 'error' ? '上传失败' : job.message}</span><span>{Math.round(job.progress * 100)}%</span></div>
              <Progress value={job.progress} tone={job.status === 'done' ? 'emerald' : 'indigo'} />
              {result?.errors?.slice(0, 3).map((e) => <div key={e} className="text-xs text-rose-600">{e}</div>)}
            </div>
          )}
        </div>
        <div className="rounded-xl p-4 ring-1 ring-slate-200">
          <div className="flex items-center gap-2 text-sm font-medium text-slate-900"><Puzzle className="size-4 text-indigo-500" />生成 Skill 技能包</div>
          <p className="mt-1 text-xs text-slate-500">把文档打包为 SKILL.md + references/，并自动创建一个 Skill 接入，用于评测 Agent 读取技能包的效果。</p>
          <div className="mt-3 flex items-center gap-2">
            <Button size="sm" onClick={makeSkill}>生成并创建接入</Button>
            <Button size="sm" variant="ghost" onClick={() => download(api.exportUrl(dataset.id, 'skill-zip'))}><Download className="size-3.5" />下载 ZIP</Button>
          </div>
          {skillMsg && <div className="mt-2 text-xs text-emerald-600">{skillMsg} <button className="text-indigo-600 hover:underline" onClick={() => navigate('/connectors')}>查看</button></div>}
        </div>
        <div className="rounded-xl bg-slate-50 p-4 text-xs leading-relaxed text-slate-600">
          <b>其他方式：</b>「本地检索基线（BM25）」接入直接读取测评集文档，无需同步；MCP / 自定义 HTTP 等服务可下载「文档集合 ZIP」后自行导入。
        </div>
      </div>
      {error && <div className="mt-3"><ErrorBox>{error}</ErrorBox></div>}
    </Modal>
  );
}

function ExportMenu({ dataset }: { dataset: Dataset }) {
  const [open, setOpen] = useState(false);
  const opts: { format: 'json' | 'corpus-zip' | 'skill-zip'; label: string; desc: string; needDocs?: boolean }[] = [
    { format: 'json', label: '完整 JSON', desc: '文档集合 + 问题集合，可再次导入' },
    { format: 'corpus-zip', label: '文档集合 ZIP', desc: '每篇文档一个 Markdown，用于手动上传知识库', needDocs: true },
    { format: 'skill-zip', label: 'Skill 技能包 ZIP', desc: 'SKILL.md + references/', needDocs: true },
  ];
  return (
    <div className="relative">
      <Button onClick={() => setOpen((o) => !o)}><Download className="size-4" />导出<ChevronDown className="size-3.5" /></Button>
      {open && (
        <>
          <div className="fixed inset-0 z-10" onClick={() => setOpen(false)} />
          <div className="absolute right-0 z-20 mt-1 w-72 rounded-xl bg-white p-1.5 shadow-lg ring-1 ring-slate-200">
            {opts.map((o) => (
              <button
                key={o.format}
                disabled={o.needDocs && !dataset.documentCount}
                className="block w-full rounded-lg px-3 py-2 text-left hover:bg-slate-50 disabled:opacity-40"
                onClick={() => (download(api.exportUrl(dataset.id, o.format)), setOpen(false))}
              >
                <div className="text-sm font-medium text-slate-800">{o.label}</div>
                <div className="text-xs text-slate-500">{o.desc}</div>
              </button>
            ))}
          </div>
        </>
      )}
    </div>
  );
}

function DocumentsPanel({ dataset, onOpen, onCreate, version, onChanged }: { dataset: Dataset; onOpen: (id: string) => void; onCreate: () => void; version: number; onChanged: () => void }) {
  const [q, setQ] = useState('');
  const [query, setQuery] = useState('');
  const [page, setPage] = useState(0);
  useEffect(() => {
    const t = setTimeout(() => (setQuery(q), setPage(0)), 300);
    return () => clearTimeout(t);
  }, [q]);
  const docs = useAsync(() => api.documents(dataset.id, { q: query, offset: page * PAGE, limit: PAGE }), [dataset.id, query, page, version]);
  const total = docs.data?.total ?? 0;
  const remove = async (id: string) => {
    if (!confirm('删除该文档？引用它的问题将无法命中。')) return;
    await api.deleteDocument(dataset.id, id);
    onChanged();
  };
  return (
    <Card
      title={`文档集合 · ${fmtNum(total)} 篇${query ? '（筛选）' : ''}`}
      actions={
        <>
          <div className="relative"><Search className="absolute top-2.5 left-2.5 size-4 text-slate-400" /><Input className="w-56 pl-8" placeholder="搜索 ID、标题或正文" value={q} onChange={(e) => setQ(e.target.value)} /></div>
          <Button onClick={onCreate}><Plus className="size-4" />添加文档</Button>
        </>
      }
      bodyClass="p-0"
    >
      {docs.data?.documents.length ? (
        <>
          <div className="divide-y divide-slate-100">
            {docs.data.documents.map((d) => (
              <div key={d.id} className="group flex items-start gap-3 px-5 py-3 hover:bg-slate-50/60">
                <FileText className="mt-0.5 size-4 shrink-0 text-slate-400" />
                <button className="min-w-0 flex-1 text-left" onClick={() => onOpen(d.id)}>
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="font-medium text-slate-900">{d.title}</span>
                    <span className="font-mono text-[11px] text-slate-400">{d.id}</span>
                    {d.referenced && <Badge tone="blue">被问题引用</Badge>}
                  </div>
                  <div className="mt-0.5 line-clamp-2 text-xs text-slate-500">{d.preview}</div>
                </button>
                <span className="shrink-0 text-xs tabular-nums text-slate-400">{fmtNum(d.length)} 字</span>
                <div className="flex shrink-0 opacity-0 group-hover:opacity-100">
                  <Button size="sm" variant="ghost" onClick={() => onOpen(d.id)}><Eye className="size-3.5" /></Button>
                  <Button size="sm" variant="ghost" onClick={() => remove(d.id)}><Trash2 className="size-3.5 text-rose-500" /></Button>
                </div>
              </div>
            ))}
          </div>
          {total > PAGE && (
            <div className="flex items-center justify-between border-t border-slate-100 px-5 py-3 text-xs text-slate-500">
              <span>第 {page * PAGE + 1}–{Math.min(total, (page + 1) * PAGE)} 篇，共 {fmtNum(total)} 篇</span>
              <div className="flex gap-2">
                <Button size="sm" disabled={page === 0} onClick={() => setPage((p) => p - 1)}>上一页</Button>
                <Button size="sm" disabled={(page + 1) * PAGE >= total} onClick={() => setPage((p) => p + 1)}>下一页</Button>
              </div>
            </div>
          )}
        </>
      ) : (
        <Empty
          icon={<FileText className="size-5" />}
          title={query ? '没有匹配的文档' : '还没有文档集合'}
          desc={query ? undefined : '没有文档集合时，需要自行保证被测知识库已导入问题对应的文档。也可以从社区评测集导入带文档的测评集。'}
          action={!query && <Button variant="primary" onClick={onCreate}>添加文档</Button>}
        />
      )}
    </Card>
  );
}

export default function DatasetDetail() {
  const { id = '' } = useParams();
  const ds = useAsync(() => api.dataset(id), [id]);
  const [tab, setTab] = useState<'items' | 'docs'>('items');
  const [editing, setEditing] = useState<Partial<DatasetItem>>();
  const [debug, setDebug] = useState<DatasetItem>();
  const [openDoc, setOpenDoc] = useState<string>();
  const [creatingDoc, setCreatingDoc] = useState(false);
  const [syncOpen, setSyncOpen] = useState(false);
  const [docVersion, setDocVersion] = useState(0);
  const [q, setQ] = useState('');
  const [error, setError] = useState<string>();
  const [limit, setLimit] = useState(100);

  const d = ds.data;
  const titles = d?.docTitles ?? {};
  const items = useMemo(() => (d?.items ?? []).filter((i) => !q || i.question.includes(q) || i.tags?.some((t) => t.includes(q))), [d, q]);

  const persist = async (next: DatasetItem[]) => {
    try {
      ds.setData(await api.updateDataset(id, { items: next }));
    } catch (e) {
      setError((e as Error).message);
    }
  };

  const save = async (it: Partial<DatasetItem>) => {
    const list = d?.items ?? [];
    await persist(it.id ? list.map((x) => (x.id === it.id ? (it as DatasetItem) : x)) : [...list, it as DatasetItem]);
    setEditing(undefined);
  };

  const docsChanged = () => {
    setDocVersion((v) => v + 1);
    void ds.reload();
  };

  if (ds.error) return <ErrorBox>{ds.error}</ErrorBox>;

  return (
    <>
      <Link to="/datasets" className="mb-3 inline-flex items-center gap-1 text-xs font-medium text-slate-500 hover:text-slate-700"><ArrowLeft className="size-3.5" />返回测评集</Link>
      <PageHeader
        title={d?.name ?? '加载中…'}
        desc={d?.description}
        actions={d && <><ExportMenu dataset={d} /><Button onClick={() => setSyncOpen(true)} disabled={!d.documentCount}><CloudUpload className="size-4" />接入知识库</Button><Button variant="primary" onClick={() => setEditing({})}><Plus className="size-4" />添加题目</Button></>}
      />
      {error && <div className="mb-4"><ErrorBox>{error}</ErrorBox></div>}

      {d && (
        <div className="mb-5 grid items-start gap-4 lg:grid-cols-3">
          <Card className="lg:col-span-2" bodyClass="grid grid-cols-2 gap-4 p-5 sm:grid-cols-4">
            {[
              ['问题', d.items.length],
              ['文档', d.documentCount],
              ['带参考答案', d.items.filter((i) => i.referenceAnswer).length],
              ['带相关文档标注', d.items.filter((i) => i.relevantDocs?.length).length],
            ].map(([label, v]) => (
              <div key={label as string}>
                <div className="text-2xl font-semibold tabular-nums text-slate-900">{fmtNum(v as number)}</div>
                <div className="text-xs text-slate-500">{label}</div>
              </div>
            ))}
          </Card>
          <Card bodyClass="p-5 text-xs leading-relaxed text-slate-600">
            {d.source ? (
              <>
                <div className="flex items-center gap-1.5 text-sm font-medium text-slate-900"><Globe2 className="size-4 text-indigo-500" />{d.source.name}</div>
                <div className="mt-2 space-y-0.5">
                  {d.source.split && <div>数据划分：{d.source.split}</div>}
                  {d.source.sampling && <div>抽样：{d.source.sampling.queries} 题 + {d.source.sampling.distractors} 篇干扰文档，种子 {d.source.sampling.seed}</div>}
                  {d.source.license && <div>许可：{d.source.license}</div>}
                  {d.source.url && <a className="inline-flex items-center gap-1 text-indigo-600 hover:underline" href={d.source.url} target="_blank" rel="noreferrer"><ExternalLink className="size-3" />数据集主页</a>}
                </div>
              </>
            ) : (
              <div className="text-sm font-medium text-slate-900">自建测评集</div>
            )}
            <div className="mt-3 border-t border-slate-100 pt-2">
              <div className="font-medium text-slate-700">已接入的知识库</div>
              {d.syncs?.length ? (
                d.syncs.map((s) => <div key={s.connectorId}>{s.connectorName} · {fmtTime(s.at)} · {s.uploaded} 篇{s.failed ? `（失败 ${s.failed}）` : ''}</div>)
              ) : (
                <div className="text-slate-400">{d.documentCount ? '尚未同步，点击右上角「接入知识库」' : '—'}</div>
              )}
            </div>
          </Card>
        </div>
      )}

      <div className="mb-3"><Tabs value={tab} onChange={setTab} items={[{ value: 'items', label: `问题集合 (${d?.items.length ?? 0})` }, { value: 'docs', label: `文档集合 (${d?.documentCount ?? 0})` }]} /></div>

      {tab === 'docs' && d ? (
        <DocumentsPanel dataset={d} version={docVersion} onOpen={setOpenDoc} onCreate={() => setCreatingDoc(true)} onChanged={docsChanged} />
      ) : (
        <Card
          title={`共 ${d?.items.length ?? 0} 题`}
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
                  {items.slice(0, limit).map((it, i) => (
                    <tr key={it.id} className="border-b border-slate-50 align-top last:border-0 hover:bg-slate-50/60">
                      <td className="px-5 py-3 text-xs text-slate-400">{i + 1}</td>
                      <td className="py-3 pr-3">
                        <div className="font-medium text-slate-900">{it.question}</div>
                        <div className="mt-1 flex gap-1">{it.tags?.map((t) => <Badge key={t}>{t}</Badge>)}</div>
                      </td>
                      <td className="max-w-xs py-3 pr-3 text-xs text-slate-600"><span className="line-clamp-4">{it.referenceAnswer || <span className="text-slate-300">—</span>}</span></td>
                      <td className="py-3 pr-3">
                        <div className="flex max-w-xs flex-wrap gap-1">
                          {it.relevantDocs?.slice(0, 6).map((r) =>
                            titles[r] ? (
                              <button key={r} onClick={() => setOpenDoc(r)} title={r}><Badge tone="blue" className="max-w-56 truncate hover:ring-sky-300"><FileText className="size-3 shrink-0" /><span className="truncate">{titles[r]}</span></Badge></button>
                            ) : (
                              <Badge key={r} tone="blue">{r}</Badge>
                            ),
                          )}
                          {(it.relevantDocs?.length ?? 0) > 6 && <Badge>+{it.relevantDocs!.length - 6}</Badge>}
                          {it.keywords?.map((k) => <Badge key={k} tone="amber">{k}</Badge>)}
                        </div>
                      </td>
                      <td className="py-3 pr-5 text-right whitespace-nowrap">
                        <Button size="sm" variant="ghost" title="单题调试" onClick={() => setDebug(it)}><Bug className="size-3.5" /></Button>
                        <Button size="sm" variant="ghost" onClick={() => setEditing(it)}><Pencil className="size-3.5" /></Button>
                        <Button size="sm" variant="ghost" onClick={() => confirm('删除该题？') && persist((d?.items ?? []).filter((x) => x.id !== it.id))}><Trash2 className="size-3.5 text-rose-500" /></Button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
              {items.length > limit && <div className="border-t border-slate-100 py-3 text-center"><Button size="sm" onClick={() => setLimit((l) => l + 200)}>显示更多（剩余 {items.length - limit} 题）</Button></div>}
            </div>
          ) : (
            <Empty title={q ? '没有匹配的题目' : '测评集为空'} action={!q && <Button variant="primary" onClick={() => setEditing({})}>添加题目</Button>} />
          )}
        </Card>
      )}
      <ItemModal item={editing} onClose={() => setEditing(undefined)} onSave={save} hasDocs={!!d?.documentCount} />
      <DebugModal item={debug} datasetId={id} docTitles={titles} onClose={() => setDebug(undefined)} />
      <DocModal datasetId={id} docId={openDoc} creating={creatingDoc} onClose={() => (setOpenDoc(undefined), setCreatingDoc(false))} onChanged={docsChanged} />
      {d && <SyncModal open={syncOpen} dataset={d} onClose={() => setSyncOpen(false)} onDone={() => ds.reload()} />}
    </>
  );
}
