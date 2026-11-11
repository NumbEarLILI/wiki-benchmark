import { useEffect, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { BookOpen, Database, ExternalLink, FileText, FileUp, FolderUp, Globe2, Library, Plus, Trash2 } from 'lucide-react';
import { api } from '../api';
import { fmtNum, fmtTime, readFiles, useAsync, useJob } from '../lib';
import type { Benchmark, DatasetItem, FileImportPreview } from '../types';
import { Badge, Button, Card, Empty, ErrorBox, Field, Input, Modal, PageHeader, Progress, Select, Tabs, Textarea } from '../components/ui';

const SAMPLE = `[
  {
    "question": "包年包月资源多久内可以无理由退款？",
    "referenceAnswer": "购买后 7 天内可申请无理由全额退款。",
    "relevantDocs": ["退款政策.md"],
    "keywords": ["7天", "全额退款"],
    "tags": ["计费"]
  }
]`;

const FORMAT_LABEL: Record<Benchmark['format'], string> = { beir: 'BEIR 格式', squad: 'SQuAD 格式', 'multihop-rag': 'MultiHop-RAG' };

function BenchmarkImportModal({ benchmark, onClose }: { benchmark?: Benchmark; onClose: () => void }) {
  const navigate = useNavigate();
  const [form, setForm] = useState({ queries: 100, distractors: 900, seed: 42, split: '', name: '' });
  const [error, setError] = useState<string>();
  const [job, setJob] = useJob((j) => {
    if (j.status === 'done' && j.result?.datasetId) navigate(`/datasets/${j.result.datasetId}`);
  });
  useEffect(() => {
    if (!benchmark) return;
    setForm({ queries: benchmark.defaults.queries, distractors: benchmark.defaults.distractors, seed: 42, split: benchmark.splits?.[0] ?? '', name: '' });
    setJob(undefined);
    setError(undefined);
  }, [benchmark, setJob]);
  if (!benchmark) return null;
  const running = job?.status === 'running';
  const queries = Math.min(form.queries, benchmark.stats.questions);
  const set = (k: keyof typeof form) => (e: { target: { value: string } }) => setForm((f) => ({ ...f, [k]: k === 'split' || k === 'name' ? e.target.value : Number(e.target.value) }));

  const start = async () => {
    setError(undefined);
    try {
      setJob(await api.importBenchmark({ benchmarkId: benchmark.id, ...form, split: form.split || undefined, name: form.name || undefined }));
    } catch (e) {
      setError((e as Error).message);
    }
  };

  return (
    <Modal
      open
      onClose={running ? () => undefined : onClose}
      title={`导入社区评测集 · ${benchmark.name}`}
      footer={<><Button onClick={onClose} disabled={running}>取消</Button><Button variant="primary" loading={running} onClick={start}>开始导入</Button></>}
    >
      <p className="text-sm leading-relaxed text-slate-600">{benchmark.description}</p>
      <div className="mt-3 flex flex-wrap gap-1.5 text-xs">
        <Badge tone="indigo">{benchmark.org}</Badge>
        <Badge>{benchmark.task}</Badge>
        <Badge>{FORMAT_LABEL[benchmark.format]}</Badge>
        <Badge tone="blue">原始规模：文档 {fmtNum(benchmark.stats.documents)} · 问题 {fmtNum(benchmark.stats.questions)}</Badge>
      </div>
      <div className="mt-5 grid gap-4 sm:grid-cols-3">
        <Field label="抽样问题数" help={`最多 1000，原始 ${fmtNum(benchmark.stats.questions)}`}><Input type="number" min={1} max={1000} value={form.queries} onChange={set('queries')} /></Field>
        <Field label="干扰文档数" help="与问题无关的随机文档，增加检索难度"><Input type="number" min={0} max={10000} value={form.distractors} onChange={set('distractors')} /></Field>
        <Field label="随机种子" help="相同种子得到相同子集，便于复现"><Input type="number" value={form.seed} onChange={set('seed')} /></Field>
      </div>
      <div className="mt-4 grid gap-4 sm:grid-cols-2">
        {benchmark.splits && (
          <Field label="数据划分">
            <Select value={form.split} onChange={set('split')}>{benchmark.splits.map((s) => <option key={s} value={s}>{s}</option>)}</Select>
          </Field>
        )}
        <Field label="测评集名称" help="留空自动生成"><Input value={form.name} onChange={set('name')} placeholder={`${benchmark.name}（${queries} 题）`} /></Field>
      </div>
      <div className="mt-4 rounded-lg bg-slate-50 p-3 text-xs leading-relaxed text-slate-600">
        文档集合 = 抽样问题的<b>全部标注相关文档</b> + <b>{fmtNum(Math.min(form.distractors, benchmark.stats.documents))}</b> 篇随机干扰文档，预计约{' '}
        <b>{fmtNum(Math.min(benchmark.stats.documents, queries * (benchmark.format === 'beir' ? 2 : 1) + form.distractors))}</b> 篇。数据通过 Hugging Face 按需读取
        Parquet 列与行，无需下载完整数据集。导入后可一键同步到被测知识库，或直接用「本地 BM25 基线」跑分。
      </div>
      {job && (
        <div className="mt-4 space-y-1.5">
          <div className="flex justify-between text-xs text-slate-600"><span>{job.status === 'error' ? '导入失败' : job.message}</span><span>{Math.round(job.progress * 100)}%</span></div>
          <Progress value={job.progress} tone={job.status === 'done' ? 'emerald' : 'indigo'} />
        </div>
      )}
      {(error || job?.error) && <div className="mt-3"><ErrorBox>{error || job?.error}</ErrorBox></div>}
    </Modal>
  );
}

function BenchmarkCard({ b, onImport }: { b: Benchmark; onImport: () => void }) {
  return (
    <div className="flex flex-col rounded-xl bg-white p-4 ring-1 ring-slate-200/80 shadow-sm">
      <div className="flex items-start justify-between gap-2">
        <div>
          <div className="font-semibold text-slate-900">{b.name}</div>
          <div className="mt-0.5 text-xs text-slate-500">{b.org} · {b.domain}</div>
        </div>
        <Badge tone={b.lang === 'zh' ? 'red' : 'blue'}>{b.lang === 'zh' ? '中文' : '英文'}</Badge>
      </div>
      <p className="mt-2 line-clamp-3 flex-1 text-xs leading-relaxed text-slate-600">{b.description}</p>
      <div className="mt-3 flex flex-wrap gap-1">
        <Badge>{b.task}</Badge>
        {b.hasAnswers && <Badge tone="green">含参考答案</Badge>}
        <Badge tone="slate">文档 {fmtNum(b.stats.documents)}</Badge>
        <Badge tone="slate">问题 {fmtNum(b.stats.questions)}</Badge>
      </div>
      <div className="mt-2 truncate text-[11px] text-slate-400" title={b.license}>许可：{b.license}</div>
      <div className="mt-3 flex items-center justify-between gap-2 border-t border-slate-100 pt-3">
        <a href={b.homepage} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 text-xs text-slate-500 hover:text-indigo-600">
          <ExternalLink className="size-3.5" />{b.hfDataset}
        </a>
        <div className="flex items-center gap-2">
          {b.imported.length > 0 && <Link to={`/datasets/${b.imported[0].id}`} className="text-xs text-emerald-600 hover:underline">已导入 {b.imported.length}</Link>}
          <Button size="sm" variant="primary" onClick={onImport}>导入</Button>
        </div>
      </div>
    </div>
  );
}

function CreateModal({ open, onClose, onDone }: { open: boolean; onClose: () => void; onDone: (id: string) => void }) {
  const [tab, setTab] = useState<'files' | 'paste'>('files');
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [files, setFiles] = useState<{ name: string; content: string }[]>([]);
  const [filePreview, setFilePreview] = useState<FileImportPreview>();
  const [content, setContent] = useState('');
  const [preview, setPreview] = useState<DatasetItem[]>();
  const [error, setError] = useState<string>();
  const [saving, setSaving] = useState(false);

  const reset = () => {
    setName('');
    setDescription('');
    setFiles([]);
    setFilePreview(undefined);
    setContent('');
    setPreview(undefined);
    setError(undefined);
  };

  const pickFiles = async (list?: FileList | null) => {
    if (!list?.length) return;
    setError(undefined);
    const read = await readFiles(list);
    const merged = [...files.filter((f) => !read.some((r) => r.name === f.name)), ...read];
    setFiles(merged);
    if (!name) setName(read[0].name.split('/')[0].replace(/\.[^.]+$/, ''));
    try {
      setFilePreview(await api.previewFiles(merged));
    } catch (e) {
      setFilePreview(undefined);
      setError((e as Error).message);
    }
  };

  const parse = async (text: string) => {
    setContent(text);
    setError(undefined);
    if (!text.trim()) return setPreview(undefined);
    try {
      setPreview((await api.parseDataset(text)).items);
    } catch (e) {
      setPreview(undefined);
      setError((e as Error).message);
    }
  };

  const submit = async () => {
    if (!name.trim()) return setError('请填写名称');
    setSaving(true);
    try {
      const d = tab === 'files' ? await api.importFiles({ name: name.trim(), description, files }) : await api.createDataset({ name: name.trim(), description, items: preview ?? [] });
      reset();
      onClose();
      onDone(d.id);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setSaving(false);
    }
  };

  const count = tab === 'files' ? filePreview && `${filePreview.items} 题 / ${filePreview.documents} 篇文档` : preview && `${preview.length} 题`;

  return (
    <Modal open={open} onClose={onClose} wide title="新建测评集" footer={<><Button onClick={onClose}>取消</Button><Button variant="primary" loading={saving} disabled={tab === 'files' && !filePreview?.items} onClick={submit}>创建{count ? `（${count}）` : ''}</Button></>}>
      <div className="grid gap-4 sm:grid-cols-2">
        <Field label="名称" required><Input value={name} onChange={(e) => setName(e.target.value)} placeholder="例如：客服 FAQ 测评集 v1" /></Field>
        <Field label="描述"><Input value={description} onChange={(e) => setDescription(e.target.value)} /></Field>
      </div>
      <div className="mt-5 mb-3"><Tabs value={tab} onChange={setTab} items={[{ value: 'files', label: '上传文档 + 问题文件' }, { value: 'paste', label: '仅粘贴问题' }]} /></div>
      {tab === 'files' ? (
        <>
          <div className="grid gap-3 sm:grid-cols-2">
            <label className="flex cursor-pointer flex-col items-center justify-center rounded-xl border-2 border-dashed border-slate-200 p-5 text-center hover:border-indigo-300 hover:bg-indigo-50/30">
              <FileUp className="size-6 text-indigo-500" />
              <span className="mt-2 text-sm font-medium text-slate-700">选择文件（可多选）</span>
              <span className="mt-1 text-xs text-slate-500">.md .txt .html .json .jsonl .csv .tsv</span>
              <input type="file" multiple accept=".md,.markdown,.txt,.html,.htm,.json,.jsonl,.csv,.tsv,.trec" className="hidden" onChange={(e) => pickFiles(e.target.files)} />
            </label>
            <label className="flex cursor-pointer flex-col items-center justify-center rounded-xl border-2 border-dashed border-slate-200 p-5 text-center hover:border-indigo-300 hover:bg-indigo-50/30">
              <FolderUp className="size-6 text-indigo-500" />
              <span className="mt-2 text-sm font-medium text-slate-700">选择整个目录</span>
              <span className="mt-1 text-xs text-slate-500">如 BEIR 数据目录、文档文件夹</span>
              <input type="file" multiple className="hidden" {...({ webkitdirectory: '' } as object)} onChange={(e) => pickFiles(e.target.files)} />
            </label>
          </div>
          <div className="mt-3 rounded-lg bg-slate-50 p-3 text-xs leading-relaxed text-slate-600">
            <b>支持的格式：</b>
            <ul className="mt-1 list-disc space-y-0.5 pl-4">
              <li><b>BEIR</b>：<code>corpus.jsonl</code>（_id / title / text）+ <code>queries.jsonl</code> + <code>qrels/*.tsv</code>（MTEB / C-MTEB 同格式）</li>
              <li><b>SQuAD / CMRC</b>：<code>data[].paragraphs[].qas[]</code> 结构的 JSON，段落作为文档</li>
              <li><b>文档 + 问题</b>：每个 Markdown / TXT / HTML 文件一篇文档（文件名作为 ID），问题用 CSV / JSON，<code>relevantDocs</code> 可填文件名或标题</li>
              <li><b>本平台导出的 JSON</b>：<code>{'{ documents, items }'}</code></li>
            </ul>
          </div>
          {files.length > 0 && (
            <div className="mt-3 flex flex-wrap items-center gap-1.5 text-xs">
              <span className="text-slate-500">已选 {files.length} 个文件：</span>
              {files.slice(0, 8).map((f) => <Badge key={f.name}>{f.name}</Badge>)}
              {files.length > 8 && <span className="text-slate-400">等</span>}
              <button className="ml-1 text-rose-500" onClick={() => (setFiles([]), setFilePreview(undefined))}>清空</button>
            </div>
          )}
          {filePreview && (
            <div className="mt-3 rounded-lg ring-1 ring-slate-200">
              <div className="flex flex-wrap gap-4 border-b border-slate-100 px-4 py-2.5 text-xs text-slate-600">
                <span>文档 <b className="text-slate-900">{filePreview.documents}</b> 篇</span>
                <span>问题 <b className="text-slate-900">{filePreview.items}</b> 道</span>
                <span>已关联文档的问题 <b className="text-slate-900">{filePreview.linked}</b> 道</span>
              </div>
              {filePreview.warnings.map((w) => <div key={w} className="border-b border-slate-100 bg-amber-50 px-4 py-1.5 text-xs text-amber-700">{w}</div>)}
              <div className="divide-y divide-slate-100 text-xs">
                {filePreview.sampleItems.map((it) => (
                  <div key={it.id} className="flex justify-between gap-3 px-4 py-2"><span className="text-slate-800">{it.question}</span><span className="shrink-0 text-slate-400">{it.relevantDocs?.join(', ')}</span></div>
                ))}
              </div>
            </div>
          )}
        </>
      ) : (
        <>
          <div className="mb-1.5 flex items-center justify-end gap-3">
            <button className="text-xs font-medium text-indigo-600" onClick={() => parse(SAMPLE)}>填入示例</button>
          </div>
          <Textarea rows={9} value={content} onChange={(e) => parse(e.target.value)} placeholder="粘贴 JSON 数组 / JSONL / CSV 内容" />
          <div className="mt-2 rounded-lg bg-slate-50 p-3 text-xs leading-relaxed text-slate-600">
            <b>字段说明：</b><code>question</code>（必填，问题）、<code>referenceAnswer</code>（参考答案，用于 F1 / ROUGE-L / LLM 裁判）、
            <code>relevantDocs</code>（相关文档名或 ID，用于检索命中判定）、<code>keywords</code>（关键要点，用于覆盖率）、<code>tags</code>（分类标签）。
            CSV 首行为表头，支持中文表头（问题 / 参考答案 / 相关文档 / 关键词 / 标签），多值用 <code>|</code> 或 <code>;</code> 分隔。仅有问题没有文档时，需要自行保证被测知识库已导入对应文档。
          </div>
          {preview && (
            <div className="mt-4 text-xs text-slate-600">
              解析成功 <b>{preview.length}</b> 题：带参考答案 {preview.filter((p) => p.referenceAnswer).length}，带相关文档 {preview.filter((p) => p.relevantDocs?.length).length}，带关键要点 {preview.filter((p) => p.keywords?.length).length}
            </div>
          )}
        </>
      )}
      {error && <div className="mt-3"><ErrorBox>{error}</ErrorBox></div>}
    </Modal>
  );
}

export default function Datasets() {
  const navigate = useNavigate();
  const datasets = useAsync(api.datasets);
  const benchmarks = useAsync(api.benchmarks);
  const [open, setOpen] = useState(false);
  const [importing, setImporting] = useState<Benchmark>();
  const [lang, setLang] = useState<'all' | 'zh' | 'en'>('all');

  const remove = async (id: string, name: string) => {
    if (!confirm(`确定删除测评集「${name}」？`)) return;
    await api.deleteDataset(id);
    datasets.reload();
    benchmarks.reload();
  };

  const catalog = (benchmarks.data ?? []).filter((b) => lang === 'all' || b.lang === lang);

  return (
    <>
      <PageHeader
        title="测评集"
        desc="测评集 = 知识库文档集合 + 问题集合（参考答案、相关文档标注）。可直接导入社区开源的专业评测集，把文档同步到各家知识库后统一跑分。"
        actions={<Button variant="primary" onClick={() => setOpen(true)}><Plus className="size-4" />新建测评集</Button>}
      />
      {datasets.data && !datasets.data.length && <Card className="mb-6"><Empty icon={<Library className="size-5" />} title="还没有测评集" desc="从下方社区评测集导入，或上传自己的文档与问题" /></Card>}
      <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
        {datasets.data?.map((d) => (
          <div key={d.id} className="group relative rounded-xl bg-white p-5 ring-1 ring-slate-200/80 shadow-sm transition hover:shadow-md">
            <Link to={`/datasets/${d.id}`} className="absolute inset-0" />
            <div className="flex items-start justify-between gap-2">
              <div className="font-semibold text-slate-900">{d.name}</div>
              <button className="relative z-10 rounded p-1 text-slate-400 opacity-0 hover:text-rose-500 group-hover:opacity-100" onClick={() => remove(d.id, d.name)}><Trash2 className="size-4" /></button>
            </div>
            <p className="mt-1 line-clamp-2 min-h-8 text-xs text-slate-500">{d.description || '—'}</p>
            <div className="mt-4 flex items-end justify-between">
              <div className="flex gap-6">
                <div>
                  <div className="text-2xl font-semibold tabular-nums text-slate-900">{fmtNum(d.itemCount)}</div>
                  <div className="text-xs text-slate-500">道问题</div>
                </div>
                <div>
                  <div className="text-2xl font-semibold tabular-nums text-slate-900">{fmtNum(d.documentCount)}</div>
                  <div className="text-xs text-slate-500">篇文档</div>
                </div>
              </div>
              <div className="flex flex-wrap justify-end gap-1">
                <Badge tone="green">答案 {d.withAnswer}</Badge>
                <Badge tone="blue">标注 {d.withDocs}</Badge>
                {d.withKeywords > 0 && <Badge tone="amber">要点 {d.withKeywords}</Badge>}
              </div>
            </div>
            <div className="mt-3 flex items-center justify-between gap-2 text-[11px] text-slate-400">
              <span className="truncate">{d.source ? <><Globe2 className="mr-1 inline size-3" />{d.source.name}</> : '自建'}</span>
              <span className="shrink-0">更新于 {fmtTime(d.updatedAt)}</span>
            </div>
          </div>
        ))}
      </div>

      <div className="mt-10 mb-4 flex flex-wrap items-end justify-between gap-3">
        <div>
          <h2 className="flex items-center gap-2 text-base font-semibold text-slate-900"><BookOpen className="size-4.5 text-indigo-500" />社区开源评测集</h2>
          <p className="mt-1 text-sm text-slate-500">收录 C-MTEB、BEIR、CMRC 2018、SQuAD、MultiHop-RAG 等学术界与工业界常用基准，按需抽样导入文档集合与问题集合。</p>
        </div>
        <Tabs value={lang} onChange={setLang} items={[{ value: 'all', label: '全部' }, { value: 'zh', label: '中文' }, { value: 'en', label: '英文' }]} />
      </div>
      {benchmarks.error && <ErrorBox>{benchmarks.error}</ErrorBox>}
      <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
        {catalog.map((b) => <BenchmarkCard key={b.id} b={b} onImport={() => setImporting(b)} />)}
      </div>
      <div className="mt-4 flex items-start gap-2 rounded-lg bg-slate-50 px-4 py-3 text-xs leading-relaxed text-slate-500">
        <Database className="mt-0.5 size-3.5 shrink-0" />
        <span>
          数据从 Hugging Face 实时读取，若网络无法访问可在「评分设置」中改用镜像（如 hf-mirror.com）。各数据集的许可以原始发布方为准，仅限评测研究用途。
          也可以把 MTEB / BEIR 格式的本地数据通过「新建测评集 → 上传文档 + 问题文件」导入。<FileText className="ml-1 inline size-3" />
        </span>
      </div>

      <CreateModal open={open} onClose={() => setOpen(false)} onDone={(id) => navigate(`/datasets/${id}`)} />
      <BenchmarkImportModal benchmark={importing} onClose={() => setImporting(undefined)} />
    </>
  );
}
