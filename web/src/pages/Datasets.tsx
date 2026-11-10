import { useState } from 'react';
import { Link } from 'react-router-dom';
import { FileUp, Library, Plus, Trash2 } from 'lucide-react';
import { api } from '../api';
import { fmtTime, useAsync } from '../lib';
import type { DatasetItem } from '../types';
import { Badge, Button, Card, Empty, ErrorBox, Field, Input, Modal, PageHeader, Textarea } from '../components/ui';

const SAMPLE = `[
  {
    "question": "包年包月资源多久内可以无理由退款？",
    "referenceAnswer": "购买后 7 天内可申请无理由全额退款。",
    "relevantDocs": ["退款政策.md"],
    "keywords": ["7天", "全额退款"],
    "tags": ["计费"]
  }
]`;

function ImportModal({ open, onClose, onDone }: { open: boolean; onClose: () => void; onDone: () => void }) {
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [content, setContent] = useState('');
  const [preview, setPreview] = useState<DatasetItem[]>();
  const [error, setError] = useState<string>();
  const [saving, setSaving] = useState(false);

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

  const onFile = async (f?: File) => {
    if (!f) return;
    if (!name) setName(f.name.replace(/\.(json|jsonl|csv)$/i, ''));
    await parse(await f.text());
  };

  const submit = async () => {
    if (!name.trim()) return setError('请填写名称');
    setSaving(true);
    try {
      await api.createDataset({ name: name.trim(), description, items: preview ?? [] });
      onDone();
      onClose();
      setName('');
      setDescription('');
      setContent('');
      setPreview(undefined);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setSaving(false);
    }
  };

  return (
    <Modal open={open} onClose={onClose} wide title="新建测评集" footer={<><Button onClick={onClose}>取消</Button><Button variant="primary" loading={saving} onClick={submit}>创建{preview ? `（${preview.length} 题）` : ''}</Button></>}>
      <div className="grid gap-4 sm:grid-cols-2">
        <Field label="名称" required><Input value={name} onChange={(e) => setName(e.target.value)} placeholder="例如：客服 FAQ 测评集 v1" /></Field>
        <Field label="描述"><Input value={description} onChange={(e) => setDescription(e.target.value)} /></Field>
      </div>
      <div className="mt-5">
        <div className="mb-1.5 flex items-center justify-between">
          <span className="text-xs font-medium text-slate-700">导入题目（可选，也可创建后逐条添加）</span>
          <div className="flex gap-2">
            <button className="text-xs font-medium text-indigo-600" onClick={() => parse(SAMPLE)}>填入示例</button>
            <label className="cursor-pointer text-xs font-medium text-indigo-600">
              <FileUp className="mr-0.5 inline size-3.5" />上传文件
              <input type="file" accept=".json,.jsonl,.csv" className="hidden" onChange={(e) => onFile(e.target.files?.[0])} />
            </label>
          </div>
        </div>
        <Textarea rows={9} value={content} onChange={(e) => parse(e.target.value)} placeholder="粘贴 JSON 数组 / JSONL / CSV 内容" />
        <div className="mt-2 rounded-lg bg-slate-50 p-3 text-xs leading-relaxed text-slate-600">
          <b>字段说明：</b><code>question</code>（必填，问题）、<code>referenceAnswer</code>（参考答案，用于 F1 / ROUGE-L / LLM 裁判）、
          <code>relevantDocs</code>（相关文档名或 ID，用于检索命中判定）、<code>keywords</code>（关键要点，用于覆盖率）、<code>tags</code>（分类标签）。
          CSV 首行为表头，支持中文表头（问题 / 参考答案 / 相关文档 / 关键词 / 标签），多值用 <code>|</code> 或 <code>;</code> 分隔。
        </div>
      </div>
      {preview && (
        <div className="mt-4 text-xs text-slate-600">
          解析成功 <b>{preview.length}</b> 题：带参考答案 {preview.filter((p) => p.referenceAnswer).length}，带相关文档 {preview.filter((p) => p.relevantDocs?.length).length}，带关键要点 {preview.filter((p) => p.keywords?.length).length}
        </div>
      )}
      {error && <div className="mt-3"><ErrorBox>{error}</ErrorBox></div>}
    </Modal>
  );
}

export default function Datasets() {
  const datasets = useAsync(api.datasets);
  const [open, setOpen] = useState(false);

  const remove = async (id: string, name: string) => {
    if (!confirm(`确定删除测评集「${name}」？`)) return;
    await api.deleteDataset(id);
    datasets.reload();
  };

  return (
    <>
      <PageHeader title="测评集" desc="测评集是统一的考题，包含问题、参考答案、相关文档与关键要点。同一测评集上的得分才具备可比性。" actions={<Button variant="primary" onClick={() => setOpen(true)}><Plus className="size-4" />新建测评集</Button>} />
      {datasets.data && !datasets.data.length && <Card><Empty icon={<Library className="size-5" />} title="还没有测评集" action={<Button variant="primary" onClick={() => setOpen(true)}>新建测评集</Button>} /></Card>}
      <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
        {datasets.data?.map((d) => (
          <div key={d.id} className="group relative rounded-xl bg-white p-5 ring-1 ring-slate-200/80 shadow-sm transition hover:shadow-md">
            <Link to={`/datasets/${d.id}`} className="absolute inset-0" />
            <div className="flex items-start justify-between">
              <div className="font-semibold text-slate-900">{d.name}</div>
              <button className="relative z-10 rounded p-1 text-slate-400 opacity-0 hover:text-rose-500 group-hover:opacity-100" onClick={() => remove(d.id, d.name)}><Trash2 className="size-4" /></button>
            </div>
            <p className="mt-1 line-clamp-2 min-h-8 text-xs text-slate-500">{d.description || '—'}</p>
            <div className="mt-4 flex items-end justify-between">
              <div>
                <div className="text-2xl font-semibold tabular-nums text-slate-900">{d.itemCount}</div>
                <div className="text-xs text-slate-500">道题目</div>
              </div>
              <div className="flex flex-wrap justify-end gap-1">
                <Badge tone="green">答案 {d.withAnswer}</Badge>
                <Badge tone="blue">文档 {d.withDocs}</Badge>
                <Badge tone="amber">要点 {d.withKeywords}</Badge>
              </div>
            </div>
            <div className="mt-3 text-[11px] text-slate-400">更新于 {fmtTime(d.updatedAt)}</div>
          </div>
        ))}
      </div>
      <ImportModal open={open} onClose={() => setOpen(false)} onDone={datasets.reload} />
    </>
  );
}
