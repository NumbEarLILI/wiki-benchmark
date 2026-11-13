import { useEffect, useMemo, useState, type ReactNode } from 'react';
import { Link } from 'react-router-dom';
import { Bot, CheckCircle2, CloudUpload, Download, FlaskConical, FolderOpen, Puzzle, Sparkles, Wand2, XCircle } from 'lucide-react';
import { api } from '../api';
import { download, fmtNum, fmtTime, useAsync, useJob } from '../lib';
import type { Connector, IngestPlan, PrepareMethod, PrepareTestResult, SkillTree } from '../types';
import { PathPicker } from './PathPicker';
import { Badge, Button, ErrorBox, Field, Input, Modal, Progress, Select, Textarea, cx } from './ui';

export const PREPARE_LABEL: Record<PrepareMethod, string> = {
  api: '上传接口',
  llm: '大模型解析接口',
  dir: '选择目录写入',
  none: '无需准备',
  builtin: '内置语料',
  manual: '需手动导入',
};

const SOURCE_LABEL: Record<IngestPlan['source'], { label: string; tone: 'indigo' | 'amber' | 'slate' }> = {
  llm: { label: '大模型解析', tone: 'indigo' },
  heuristic: { label: '规则识别', tone: 'amber' },
  manual: { label: '手动修改', tone: 'slate' },
};

const pretty = (s?: string) => {
  try {
    return JSON.stringify(JSON.parse(s || ''), null, 2);
  } catch {
    return s ?? '';
  }
};

function parseSaved(c?: Connector): IngestPlan | undefined {
  try {
    const raw = c?.config.ingestPlan;
    return raw ? (typeof raw === 'string' ? JSON.parse(raw) : (raw as IngestPlan)) : undefined;
  } catch {
    return undefined;
  }
}

function Step({ n, title, done, active, children }: { n: number; title: string; done?: boolean; active?: boolean; children: ReactNode }) {
  return (
    <div className="relative pl-9">
      <div className={cx('absolute top-0 left-0 flex size-6 items-center justify-center rounded-full text-xs font-semibold', done ? 'bg-emerald-500 text-white' : active ? 'bg-indigo-600 text-white' : 'bg-slate-100 text-slate-500')}>
        {done ? <CheckCircle2 className="size-4" /> : n}
      </div>
      <div className="text-sm font-medium text-slate-900">{title}</div>
      <div className="mt-2">{children}</div>
    </div>
  );
}

function PlanEditor({ plan, onChange }: { plan: IngestPlan; onChange: (p: IngestPlan) => void }) {
  const set = (patch: Partial<IngestPlan>) => onChange({ ...plan, ...patch, source: 'manual' });
  const src = SOURCE_LABEL[plan.source];
  return (
    <div className="rounded-xl bg-slate-50 p-4 ring-1 ring-slate-200">
      <div className="mb-3 flex flex-wrap items-center gap-2 text-xs">
        <Badge tone={src.tone}>{plan.source === 'llm' ? <Sparkles className="size-3" /> : null}{src.label}</Badge>
        <Badge>调用 MCP 工具</Badge>
        {plan.reasoning && <span className="text-slate-500">{plan.reasoning}</span>}
      </div>
      <div className="grid gap-3">
        <Field label="上传工具"><Input value={plan.toolName} onChange={(e) => set({ toolName: e.target.value })} /></Field>
        <Field label="参数模板 (JSON)" help="占位符：{{id}} {{title}} {{fileName}} {{content}} {{markdown}} {{url}}，每篇文档调用一次">
          <Textarea rows={5} value={pretty(plan.argsTemplate)} onChange={(e) => set({ argsTemplate: e.target.value })} />
        </Field>
        {plan.finalize && <div className="text-xs text-slate-500">全部上传后调用一次：<code className="rounded bg-white px-1">{plan.finalize.toolName}</code> {plan.finalize.argsTemplate}</div>}
      </div>
    </div>
  );
}

/** 选择写入目录：路径来自服务端目录浏览器，也可直接粘贴 */
function DirField({ value, onChange, disabled }: { value: string; onChange: (v: string) => void; disabled?: boolean }) {
  const [browsing, setBrowsing] = useState(false);
  return (
    <div className="flex gap-2">
      <Input value={value} onChange={(e) => onChange(e.target.value)} placeholder="点击右侧「选择目录」" className="font-mono text-xs" disabled={disabled} />
      <Button variant="primary" onClick={() => setBrowsing(true)} disabled={disabled}><FolderOpen className="size-4" />选择目录</Button>
      <PathPicker open={browsing} onClose={() => setBrowsing(false)} initial={value} onPick={onChange} />
    </div>
  );
}

const isInside = (root: string, p: string) => {
  const norm = (x: string) => x.replace(/\\/g, '/').replace(/\/+$/, '');
  return norm(p) === norm(root) || norm(p).startsWith(`${norm(root)}/`);
};

/**
 * 准备知识库：把测评集的文档集合导入被测知识库。
 * Dify / RAGFlow / FastGPT 直接调用上传接口；MCP 先由大模型阅读工具说明生成上传方案，确认并试传后批量执行；
 * Skill 及其它没有上传接口的知识库，选择一个目录后直接把文档写进去。
 */
export function PrepareModal({ open, onClose, datasetId, connectorId, onDone }: { open: boolean; onClose: () => void; datasetId?: string; connectorId?: string; onDone?: () => void }) {
  const datasets = useAsync(api.datasets, [open]);
  const connectors = useAsync(api.connectors, [open]);
  const adapters = useAsync(api.adapters);
  const [dsId, setDsId] = useState('');
  const [kbId, setKbId] = useState('');
  const [plan, setPlan] = useState<IngestPlan>();
  const [note, setNote] = useState<string>();
  const [planning, setPlanning] = useState(false);
  const [testing, setTesting] = useState(false);
  const [test, setTest] = useState<PrepareTestResult & { plan: string }>();
  const [error, setError] = useState<string>();
  const [skillMsg, setSkillMsg] = useState<string>();
  const [dir, setDir] = useState('');
  const [skill, setSkill] = useState<SkillTree>();
  const [job, setJob] = useJob(() => {
    datasets.reload();
    connectors.reload();
    onDone?.();
  });

  useEffect(() => {
    if (!open) return;
    setDsId(datasetId ?? '');
    setKbId(connectorId ?? '');
    setJob(undefined);
    setError(undefined);
    setSkillMsg(undefined);
  }, [open, datasetId, connectorId, setJob]);

  const dsList = (datasets.data ?? []).filter((d) => d.documentCount > 0);
  useEffect(() => {
    if (open && !dsId && dsList[0]) setDsId(dsList[0].id);
  }, [open, dsId, dsList]);
  useEffect(() => {
    if (open && !kbId && connectors.data?.length) {
      const methods = new Map((adapters.data ?? []).map((a) => [a.type, a.prepare]));
      const first = connectors.data.find((c) => ['api', 'llm'].includes(methods.get(c.type) ?? '')) ?? connectors.data[0];
      setKbId(first.id);
    }
  }, [open, kbId, connectors.data, adapters.data]);

  const ds = datasets.data?.find((d) => d.id === dsId);
  const kb = connectors.data?.find((c) => c.id === kbId);
  const method: PrepareMethod = (adapters.data?.find((a) => a.type === kb?.type)?.prepare ?? 'manual') as PrepareMethod;
  const record = ds?.syncs?.find((s) => s.connectorId === kbId);
  const savedPlan = useMemo(() => parseSaved(kb), [kb]);

  useEffect(() => {
    setPlan(savedPlan);
    setNote(undefined);
    setTest(undefined);
  }, [kbId, savedPlan]);

  const savedDir = typeof kb?.config.ingestDir === 'string' ? kb.config.ingestDir : '';
  useEffect(() => {
    setSkill(undefined);
    setDir(savedDir);
    if (!open || kb?.type !== 'skill') return;
    api.skillTree(kb.id).then(
      (t) => {
        setSkill(t);
        setDir((d) => d || t.ingestDir);
      },
      (e: Error) => setError(e.message),
    );
  }, [open, kb?.id, kb?.type, savedDir]);

  const running = job?.status === 'running';
  const planKey = JSON.stringify(plan ?? null);
  const testedOk = test?.ok && test.plan === planKey;

  const runPlan = async () => {
    setPlanning(true);
    setError(undefined);
    setTest(undefined);
    try {
      const r = await api.preparePlan(kbId, dsId || undefined);
      setPlan(r.plan);
      setNote(r.note);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setPlanning(false);
    }
  };

  const runTest = async () => {
    if (!plan) return;
    setTesting(true);
    setError(undefined);
    try {
      setTest({ ...(await api.prepareTest(kbId, dsId, plan)), plan: planKey });
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setTesting(false);
    }
  };

  const start = async () => {
    setError(undefined);
    try {
      if (method === 'dir' || method === 'manual') {
        if (!dir.trim()) throw new Error('请先选择写入目录');
        setJob(await api.syncDataset(dsId, { connectorId: kbId, dir: dir.trim() }));
        return;
      }
      const skip = testedOk ? [test!.docId] : undefined;
      setJob(await api.syncDataset(dsId, { connectorId: kbId, plan: method === 'llm' ? plan : undefined, skip }));
    } catch (e) {
      setError((e as Error).message);
    }
  };

  const makeSkill = async () => {
    setError(undefined);
    try {
      const r = await api.createSkill(dsId, { createConnector: true });
      setSkillMsg(`已生成 Skill 技能包并创建接入「${r.connector?.name}」，可直接参与评测`);
      connectors.reload();
    } catch (e) {
      setError((e as Error).message);
    }
  };

  const result = job?.result as { uploaded: number; failed: number; skipped?: number; errors: string[] } | undefined;
  const canStart = !!dsId && !!kbId && (method === 'api' || (method === 'llm' && !!plan) || (method === 'dir' && !!dir.trim())) && !running;
  const skipped = testedOk && method === 'llm' ? 1 : 0;
  const progress = job ? (
    <div className="space-y-1.5">
      <div className="flex justify-between text-xs text-slate-600">
        <span>{job.status === 'done' ? `完成：成功 ${result?.uploaded} 篇${result?.skipped ? `（含试传 ${result.skipped} 篇）` : ''}，失败 ${result?.failed} 篇` : job.status === 'error' ? '导入失败' : job.message}</span>
        <span>{Math.round(job.progress * 100)}%</span>
      </div>
      <Progress value={job.progress} tone={job.status === 'done' ? 'emerald' : 'indigo'} />
      {result?.errors?.slice(0, 3).map((e) => <div key={e} className="text-xs text-rose-600">{e}</div>)}
      {job.error && <ErrorBox>{job.error}</ErrorBox>}
    </div>
  ) : null;

  return (
    <Modal
      open={open}
      onClose={running ? () => undefined : onClose}
      wide
      title="准备知识库"
      footer={
        <>
          <Button onClick={onClose} disabled={running}>{job?.status === 'done' ? '完成' : '关闭'}</Button>
          {(method === 'api' || method === 'llm' || method === 'dir') && (
            <Button variant="primary" loading={running} disabled={!canStart} onClick={start}>
              <CloudUpload className="size-4" />{method === 'dir' ? '写入' : '开始导入'}{ds ? ` ${fmtNum(ds.documentCount - skipped)} 篇文档` : ''}
            </Button>
          )}
        </>
      }
    >
      <p className="mb-5 text-sm leading-relaxed text-slate-600">
        评测前需要把测评集的文档集合导入被测知识库。文档统一以 <code className="rounded bg-slate-100 px-1">{'{文档ID}__{标题}.md'}</code> 命名，评测时据此判定检索命中。
      </p>
      <div className="space-y-6">
        <Step n={1} title="选择测评集与知识库" done={!!dsId && !!kbId} active>
          <div className="grid gap-3 sm:grid-cols-2">
            <Select value={dsId} onChange={(e) => setDsId(e.target.value)} disabled={!!datasetId || running}>
              {!dsList.length && <option value="">没有带文档集合的测评集</option>}
              {dsList.map((d) => <option key={d.id} value={d.id}>{d.name}</option>)}
            </Select>
            <Select value={kbId} onChange={(e) => setKbId(e.target.value)} disabled={!!connectorId || running}>
              {connectors.data?.map((c) => {
                const m = adapters.data?.find((a) => a.type === c.type)?.prepare ?? 'manual';
                return <option key={c.id} value={c.id}>{c.name}（{PREPARE_LABEL[m as PrepareMethod]}）</option>;
              })}
            </Select>
          </div>
          {record && (
            <div className="mt-2 text-xs text-emerald-700">
              <CheckCircle2 className="mr-1 inline size-3.5" />{fmtTime(record.at)} 已准备：成功 {record.uploaded} 篇{record.failed ? `，失败 ${record.failed} 篇` : ''}{record.detail ? ` · ${record.detail}` : ''}。重新导入可能产生重复文档。
            </div>
          )}
        </Step>

        {method === 'llm' && (
          <Step n={2} title="大模型解析 MCP 工具，生成上传方案" done={!!plan} active={!!kbId}>
            <p className="mb-3 text-xs leading-relaxed text-slate-500">
              读取 MCP 服务的工具列表及参数定义，由大模型找出写入文档的工具并生成参数模板。使用接入配置中的模型，未配置时使用「评分设置 → 默认 Agent 模型」；大模型不可用时自动改用规则识别。方案只解析一次，之后按模板逐篇执行。
            </p>
            <Button onClick={runPlan} loading={planning} disabled={!kbId || running}><Bot className="size-4" />{plan ? '重新解析' : '解析上传接口'}</Button>
            {savedPlan && plan === savedPlan && <span className="ml-3 text-xs text-slate-500">已加载上次保存的方案</span>}
            {note && <div className="mt-3 rounded-lg bg-amber-50 px-3 py-2 text-xs text-amber-700 ring-1 ring-amber-200">{note}</div>}
            {plan && <div className="mt-3"><PlanEditor plan={plan} onChange={setPlan} /></div>}
          </Step>
        )}

        {method === 'dir' && (
          <Step n={2} title="选择文档写入的目录" done={!!dir.trim()} active={!!kbId}>
            <DirField value={dir} onChange={setDir} disabled={running} />
            <p className="mt-2 text-xs leading-relaxed text-slate-500">
              文档以 <code className="rounded bg-slate-100 px-1">{'{文档ID}__{标题}.md'}</code> 直接写入该目录，目录不存在时自动创建。再次导入会先删除上一次写入的文件，目录里原有的其它文件不受影响。
              {skill && <> 默认是技能的 <code className="rounded bg-slate-100 px-1">references/</code> 目录。</>}
            </p>
            {skill && dir.trim() && !isInside(skill.root, dir.trim()) && (
              <div className="mt-2 rounded-lg bg-amber-50 px-3 py-2 text-xs text-amber-700 ring-1 ring-amber-200">该目录不在技能目录（{skill.root}）内，Skill 检索不到写入的文档。</div>
            )}
          </Step>
        )}

        {method === 'llm' && (
          <Step n={3} title="试传第一篇文档" done={testedOk} active={!!plan}>
            <Button onClick={runTest} loading={testing} disabled={!plan || !dsId || running}><FlaskConical className="size-4" />试传</Button>
            <span className="ml-3 text-xs text-slate-500">验证方案能否调用成功，成功后批量导入时会跳过这一篇</span>
            {test && (
              <div className={cx('mt-3 rounded-lg px-3 py-2 text-xs ring-1', test.ok ? 'bg-emerald-50 text-emerald-800 ring-emerald-200' : 'bg-rose-50 text-rose-700 ring-rose-200')}>
                <div className="font-medium">{test.ok ? <CheckCircle2 className="mr-1 inline size-3.5" /> : <XCircle className="mr-1 inline size-3.5" />}{test.ok ? `上传成功（${test.fileName}，${test.latencyMs}ms）` : '上传失败'}</div>
                <pre className="mt-1 max-h-32 overflow-auto whitespace-pre-wrap font-mono text-[11px]">{test.ok ? test.output || '（无输出）' : test.error}</pre>
                {test.plan !== planKey && <div className="mt-1 text-amber-700">方案已修改，建议重新试传</div>}
              </div>
            )}
          </Step>
        )}

        {(method === 'api' || method === 'llm' || method === 'dir') && (
          <Step n={method === 'llm' ? 4 : method === 'dir' ? 3 : 2} title={method === 'dir' ? '写入文档' : '批量导入'} done={job?.status === 'done'} active={canStart}>
            {method === 'api' && <p className="text-xs text-slate-500">使用接入配置中的知识库 ID 与 API Key 调用 {kb?.type} 的上传接口。上传后知识库需要一段时间完成解析与向量化，再开始评测。</p>}
            {progress ?? <p className="text-xs text-slate-400">点击右下角「{method === 'dir' ? '写入' : '开始导入'}」。{method === 'llm' && !plan ? '请先解析上传方案。' : ''}</p>}
          </Step>
        )}

        {method === 'none' && <div className="rounded-lg bg-emerald-50 p-4 text-sm text-emerald-800 ring-1 ring-emerald-200">本地 BM25 基线直接读取测评集文档，无需准备，可以直接参与评测。</div>}
        {method === 'builtin' && <div className="rounded-lg bg-amber-50 p-4 text-sm text-amber-800 ring-1 ring-amber-200">内置演示知识库只包含固定的「星云云」演示文档，无法导入其他文档，仅适合配套的演示测评集。</div>}
        {method === 'manual' && (
          <div className="rounded-lg bg-slate-50 p-4 text-sm text-slate-700 ring-1 ring-slate-200">
            {kb?.type} 类接入没有标准的文档上传接口。如果它背后的知识库会读取 / 监听某个目录，选择该目录即可把文档直接写进去；也可以下载文档集合手动导入。
            <div className="mt-3"><DirField value={dir} onChange={setDir} disabled={running} /></div>
            <div className="mt-3 flex flex-wrap gap-2">
              <Button size="sm" variant="primary" loading={running} disabled={!dsId || !dir.trim() || running} onClick={start}><CloudUpload className="size-3.5" />写入目录</Button>
              <Button size="sm" disabled={!dsId} onClick={() => download(api.exportUrl(dsId, 'corpus-zip'))}><Download className="size-3.5" />下载文档集合 ZIP</Button>
            </div>
            {progress && <div className="mt-3">{progress}</div>}
          </div>
        )}

        <div className="flex flex-wrap items-center gap-3 border-t border-slate-100 pt-4 text-xs text-slate-500">
          <Puzzle className="size-4 text-indigo-500" />
          <span>没有现成的知识库？可以把文档生成为新的 Skill 技能包接入。</span>
          <Button size="sm" variant="ghost" disabled={!dsId} onClick={makeSkill}><Wand2 className="size-3.5" />生成 Skill 接入</Button>
          {skillMsg && <span className="text-emerald-600">{skillMsg}，<Link to="/connectors" className="text-indigo-600">查看</Link></span>}
        </div>
      </div>
      {error && <div className="mt-4"><ErrorBox>{error}</ErrorBox></div>}
    </Modal>
  );
}
