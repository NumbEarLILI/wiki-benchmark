import { useEffect, useState } from 'react';
import { CheckCircle2, Database, ListTree, Pencil, Plug, Plus, Trash2, XCircle } from 'lucide-react';
import { api } from '../api';
import { ms, useAsync } from '../lib';
import type { AdapterInfo, Connector, FieldDef, McpToolInfo, TestResult } from '../types';
import { TraceView } from '../components/Trace';
import { Badge, Button, Card, Empty, ErrorBox, Field, Input, Modal, PageHeader, Select, Textarea, cx } from '../components/ui';

function defaultsFor(adapter?: AdapterInfo) {
  const cfg: Record<string, unknown> = {};
  adapter?.fields.forEach((f) => {
    if (f.default !== undefined) cfg[f.key] = f.default;
  });
  return cfg;
}

export function isFieldVisible(field: FieldDef, adapter: AdapterInfo | undefined, config: Record<string, unknown>) {
  if (!field.showIf) return true;
  const dep = adapter?.fields.find((f) => f.key === field.showIf!.key);
  const v = config[field.showIf.key] ?? dep?.default ?? '';
  return field.showIf.values.includes(String(v));
}

function connectorSummary(c: Connector): string {
  const cfg = c.config;
  if (c.type === 'mock') return `noise=${cfg.noise} latency=${cfg.latencyMs}ms`;
  if (c.type === 'mcp') {
    const target = cfg.transport === 'stdio' ? `${cfg.command ?? ''} ${cfg.args ?? ''}`.trim() : String(cfg.url ?? '');
    return `${cfg.transport ?? 'streamable-http'} · ${cfg.mode === 'agent' ? 'agent' : String(cfg.toolName ?? '')} · ${target}`;
  }
  if (c.type === 'skill') return `${cfg.mode === 'retrieval' ? '检索' : 'Agent'} · ${String(cfg.skillPath ?? '')}`;
  return String(cfg.baseUrl ?? cfg.url ?? '—');
}

function McpToolsPanel({ connectorId, config, onPick }: { connectorId?: string; config: Record<string, unknown>; onPick: (t: McpToolInfo) => void }) {
  const [tools, setTools] = useState<McpToolInfo[]>();
  const [error, setError] = useState<string>();
  const [loading, setLoading] = useState(false);
  const agent = config.mode === 'agent';
  const load = async () => {
    setLoading(true);
    setError(undefined);
    try {
      const r = await api.mcpTools({ id: connectorId, config });
      setTools(r.tools);
      if (!r.ok) setError(r.error);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setLoading(false);
    }
  };
  return (
    <div className="mt-6 border-t border-slate-100 pt-5">
      <div className="mb-2 flex items-center justify-between">
        <span className="text-xs font-medium text-slate-700">MCP 工具{agent ? '（Agent 将从中自主选择）' : '（点击选择要评测的工具）'}</span>
        <Button size="sm" onClick={load} loading={loading}><ListTree className="size-3.5" />获取工具列表</Button>
      </div>
      {error && <ErrorBox>{error}</ErrorBox>}
      {tools && !tools.length && !error && <div className="text-xs text-slate-500">该服务没有暴露工具</div>}
      <div className="grid gap-2 sm:grid-cols-2">
        {tools?.map((t) => {
          const active = !agent && config.toolName === t.name;
          return (
            <button
              key={t.name}
              disabled={agent}
              onClick={() => onPick(t)}
              className={cx('rounded-lg p-2.5 text-left ring-1 transition', active ? 'bg-indigo-50 ring-2 ring-indigo-500' : 'ring-slate-200', !agent && 'hover:ring-slate-300')}
            >
              <div className="font-mono text-xs font-semibold text-slate-900">{t.name}</div>
              <div className="mt-0.5 line-clamp-2 text-[11px] text-slate-500">{t.description || '—'}</div>
              <div className="mt-1 truncate font-mono text-[10px] text-slate-400">{Object.keys((t.inputSchema?.properties as object) ?? {}).join(', ') || '无参数'}</div>
            </button>
          );
        })}
      </div>
    </div>
  );
}

function ConfigField({ field, value, onChange }: { field: FieldDef; value: unknown; onChange: (v: unknown) => void }) {
  const v = value === undefined || value === null ? '' : typeof value === 'object' ? JSON.stringify(value) : String(value);
  let control;
  if (field.type === 'select') {
    control = (
      <Select value={v} onChange={(e) => onChange(e.target.value)}>
        {field.options?.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
      </Select>
    );
  } else if (field.type === 'textarea' || field.type === 'json') {
    control = <Textarea rows={field.type === 'json' ? 3 : 4} value={v} placeholder={field.placeholder} onChange={(e) => onChange(e.target.value)} />;
  } else {
    control = (
      <Input
        type={field.type === 'password' ? 'password' : field.type === 'number' ? 'number' : 'text'}
        step="any"
        value={v}
        placeholder={field.placeholder}
        autoComplete="off"
        onChange={(e) => onChange(field.type === 'number' && e.target.value !== '' ? Number(e.target.value) : e.target.value)}
      />
    );
  }
  return <Field label={field.label} help={field.help} required={field.required}>{control}</Field>;
}

export function TestPanel({ result }: { result?: TestResult }) {
  const [showRaw, setShowRaw] = useState(false);
  if (!result) return null;
  return (
    <div className="mt-4 rounded-xl bg-slate-50 p-4 ring-1 ring-slate-200">
      <div className="flex items-center gap-2 text-sm font-medium">
        {result.ok ? <CheckCircle2 className="size-4 text-emerald-500" /> : <XCircle className="size-4 text-rose-500" />}
        {result.ok ? '调用成功' : '调用失败'}
        <span className="text-xs font-normal text-slate-500">耗时 {ms(result.latencyMs)}</span>
      </div>
      {result.error && <div className="mt-2 break-all text-xs text-rose-600">{result.error}</div>}
      {result.ok && (
        <>
          <div className="mt-3 text-xs font-medium text-slate-500">答案</div>
          <div className="mt-1 whitespace-pre-wrap text-sm text-slate-800">{result.answer ?? <span className="text-slate-400">（未返回答案）</span>}</div>
          <div className="mt-3 text-xs font-medium text-slate-500">召回片段（{result.contexts?.length ?? 0}）</div>
          <div className="mt-1 space-y-1.5">
            {result.contexts?.map((c, i) => (
              <div key={i} className="rounded-lg bg-white p-2.5 text-xs ring-1 ring-slate-200">
                <div className="mb-1 flex gap-2 text-slate-500">
                  <span>#{i + 1}</span>
                  {c.source && <span className="font-medium text-slate-700">{c.source}</span>}
                  {c.score !== undefined && <span>score {Number(c.score).toFixed(3)}</span>}
                </div>
                <div className="line-clamp-3 text-slate-700">{c.content}</div>
              </div>
            ))}
          </div>
          {result.trace && <div className="mt-3"><TraceView trace={result.trace} /></div>}
          <button className="mt-3 text-xs font-medium text-indigo-600" onClick={() => setShowRaw(!showRaw)}>{showRaw ? '收起' : '查看'}原始响应</button>
          {showRaw && <pre className="mt-2 max-h-64 overflow-auto rounded-lg bg-slate-900 p-3 text-[11px] text-slate-100 scrollbar-thin">{JSON.stringify(result.raw, null, 2)}</pre>}
        </>
      )}
    </div>
  );
}

function ConnectorModal({ open, onClose, adapters, editing, onSaved }: { open: boolean; onClose: () => void; adapters: AdapterInfo[]; editing?: Connector; onSaved: () => void }) {
  const [type, setType] = useState('');
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [config, setConfig] = useState<Record<string, unknown>>({});
  const [question, setQuestion] = useState('AccessKey 多久需要轮换一次？');
  const [test, setTest] = useState<TestResult>();
  const [testing, setTesting] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string>();

  useEffect(() => {
    if (!open) return;
    const t = editing?.type ?? adapters[0]?.type ?? '';
    setType(t);
    setName(editing?.name ?? '');
    setDescription(editing?.description ?? '');
    setConfig(editing ? { ...editing.config } : defaultsFor(adapters.find((a) => a.type === t)));
    setTest(undefined);
    setError(undefined);
  }, [open, editing, adapters]);

  const adapter = adapters.find((a) => a.type === type);

  const switchType = (t: string) => {
    setType(t);
    setConfig(defaultsFor(adapters.find((a) => a.type === t)));
    setTest(undefined);
  };

  const runTest = async () => {
    setTesting(true);
    try {
      setTest(await api.testConnector({ id: editing?.id, type, config, question }));
    } catch (e) {
      setTest({ ok: false, latencyMs: 0, error: (e as Error).message });
    } finally {
      setTesting(false);
    }
  };

  const submit = async () => {
    const missing = adapter?.fields.filter((f) => f.required && isFieldVisible(f, adapter, config) && (config[f.key] === undefined || config[f.key] === ''));
    if (!name.trim()) return setError('请填写名称');
    if (missing?.length) return setError(`请填写：${missing.map((f) => f.label).join('、')}`);
    setSaving(true);
    try {
      const body = { name: name.trim(), type, description, config };
      if (editing) await api.updateConnector(editing.id, body);
      else await api.createConnector(body);
      onSaved();
      onClose();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setSaving(false);
    }
  };

  return (
    <Modal
      open={open}
      onClose={onClose}
      wide
      title={editing ? '编辑知识库' : '接入知识库'}
      footer={
        <>
          <Button onClick={onClose}>取消</Button>
          <Button variant="primary" loading={saving} onClick={submit}>保存</Button>
        </>
      }
    >
      <div className="mb-5 grid grid-cols-2 gap-2 sm:grid-cols-4">
        {adapters.map((a) => (
          <button
            key={a.type}
            onClick={() => switchType(a.type)}
            className={cx('rounded-xl p-3 text-left ring-1 transition', type === a.type ? 'bg-indigo-50 ring-2 ring-indigo-500' : 'ring-slate-200 hover:ring-slate-300')}
          >
            <div className="text-sm font-semibold text-slate-900">{a.name}</div>
            <div className="mt-1 line-clamp-2 text-[11px] leading-snug text-slate-500">{a.description}</div>
          </button>
        ))}
      </div>
      <div className="grid gap-4 sm:grid-cols-2">
        <Field label="名称" required><Input value={name} onChange={(e) => setName(e.target.value)} placeholder="例如：客服知识库 · Dify 生产环境" /></Field>
        <Field label="备注"><Input value={description} onChange={(e) => setDescription(e.target.value)} placeholder="版本、模型、切片策略等" /></Field>
        {adapter?.fields.filter((f) => isFieldVisible(f, adapter, config)).map((f) => (
          <div key={f.key} className={f.type === 'textarea' || f.type === 'json' ? 'sm:col-span-2' : ''}>
            <ConfigField field={f} value={config[f.key]} onChange={(v) => setConfig((c) => ({ ...c, [f.key]: v }))} />
          </div>
        ))}
      </div>
      {type === 'mcp' && (
        <McpToolsPanel connectorId={editing?.id} config={config} onPick={(t) => setConfig((c) => ({ ...c, toolName: t.name, argsTemplate: t.suggestedArgs }))} />
      )}
      <div className="mt-6 border-t border-slate-100 pt-5">
        <div className="mb-2 text-xs font-medium text-slate-700">连通性测试</div>
        <div className="flex gap-2">
          <Input value={question} onChange={(e) => setQuestion(e.target.value)} placeholder="输入测试问题" />
          <Button onClick={runTest} loading={testing}><Plug className="size-4" />测试</Button>
        </div>
        <TestPanel result={test} />
      </div>
      {error && <div className="mt-4"><ErrorBox>{error}</ErrorBox></div>}
    </Modal>
  );
}

export default function Connectors() {
  const adapters = useAsync(api.adapters);
  const connectors = useAsync(api.connectors);
  const [modal, setModal] = useState<{ open: boolean; editing?: Connector }>({ open: false });
  const adapterName = (t: string) => adapters.data?.find((a) => a.type === t)?.name ?? t;

  const remove = async (c: Connector) => {
    if (!confirm(`确定删除「${c.name}」？历史评测结果会保留。`)) return;
    await api.deleteConnector(c.id);
    connectors.reload();
  };

  return (
    <>
      <PageHeader
        title="知识库接入"
        desc="配置待评测的知识库服务。每个接入实例可视为一个参赛选手，可以是不同产品，也可以是同一产品的不同配置。"
        actions={<Button variant="primary" onClick={() => setModal({ open: true })}><Plus className="size-4" />接入知识库</Button>}
      />
      {connectors.error && <ErrorBox>{connectors.error}</ErrorBox>}
      {connectors.data && !connectors.data.length && (
        <Card><Empty icon={<Database className="size-5" />} title="还没有接入知识库" action={<Button variant="primary" onClick={() => setModal({ open: true })}>接入第一个知识库</Button>} /></Card>
      )}
      <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
        {connectors.data?.map((c) => (
          <div key={c.id} className="group flex flex-col rounded-xl bg-white p-5 ring-1 ring-slate-200/80 shadow-sm">
            <div className="flex items-start justify-between gap-3">
              <div className="min-w-0">
                <div className="truncate font-semibold text-slate-900">{c.name}</div>
                <div className="mt-1 flex flex-wrap gap-1.5">
                  <Badge tone="indigo">{adapterName(c.type)}</Badge>
                  {c.capabilities.retrieval && <Badge tone="blue">检索</Badge>}
                  {c.capabilities.answer && <Badge tone="green">问答</Badge>}
                </div>
              </div>
              <div className="flex gap-1 opacity-60 transition group-hover:opacity-100">
                <Button size="sm" variant="ghost" onClick={() => setModal({ open: true, editing: c })}><Pencil className="size-3.5" /></Button>
                <Button size="sm" variant="ghost" onClick={() => remove(c)}><Trash2 className="size-3.5 text-rose-500" /></Button>
              </div>
            </div>
            <p className="mt-3 line-clamp-2 min-h-8 text-xs text-slate-500">{c.description || '—'}</p>
            <div className="mt-3 truncate rounded-md bg-slate-50 px-2 py-1.5 font-mono text-[11px] text-slate-500">
              {connectorSummary(c)}
            </div>
          </div>
        ))}
      </div>
      <ConnectorModal open={modal.open} editing={modal.editing} adapters={adapters.data ?? []} onClose={() => setModal({ open: false })} onSaved={connectors.reload} />
    </>
  );
}
