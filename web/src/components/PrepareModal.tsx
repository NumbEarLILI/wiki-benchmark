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

function toRelative(root: string, abs: string) {
  const norm = (p: string) => p.replace(/\\/g, '/').replace(/\/+$/, '');
  const r = norm(root);
  const a = norm(abs);
  if (a === r) return '';
  return a.startsWith(`${r}/`) ? a.slice(r.length + 1) : undefined;
}

/** 在技能目录内选择脚本或目录：下拉列出已有项，也可打开目录浏览器 */
function SkillPathSelect({ tree, value, onChange, mode }: { tree?: SkillTree; value: string; onChange: (v: string) => void; mode: 'file' | 'dir' }) {
  const [browsing, setBrowsing] = useState(false);
  const [error, setError] = useState<string>();
  const options = mode === 'file' ? tree?.scripts ?? [] : tree?.dirs ?? [];
  return (
    <div>
      <div className="flex gap-2">
        <Select value={value} onChange={(e) => onChange(e.target.value)}>
          {!value && <option value="">{mode === 'file' ? '请选择脚本' : '请选择目录'}</option>}
          {mode === 'dir' && !options.includes('') && <option value="">（技能根目录）</option>}
          {value && !options.includes(value) && <option value={value}>{value}{mode === 'dir' ? '（将新建）' : '（不存在）'}</option>}
          {options.map((o) => <option key={o} value={o}>{o || '（技能根目录）'}</option>)}
        </Select>
        <Button type="button" disabled={!tree} onClick={() => setBrowsing(true)}><FolderOpen className="size-4" />浏览</Button>
      </div>
      {error && <div className="mt-1 text-xs text-rose-600">{error}</div>}
      {tree && (
        <PathPicker
          open={browsing}
          onClose={() => setBrowsing(false)}
          initial={value ? `${tree.root}/${value}` : tree.root}
          mode={mode}
          onPick={(abs) => {
            const rel = toRelative(tree.root, abs);
            setError(rel === undefined ? `只能选择技能目录（${tree.root}）内的${mode === 'file' ? '文件' : '目录'}` : undefined);
            if (rel !== undefined) onChange(rel);
          }}
        />
      )}
    </div>
  );
}

function PlanEditor({ plan, onChange, connectorId }: { plan: IngestPlan; onChange: (p: IngestPlan) => void; connectorId: string }) {
  const set = (patch: Partial<IngestPlan>) => onChange({ ...plan, ...patch, source: 'manual' });
  const src = SOURCE_LABEL[plan.source];
  const isSkill = plan.kind !== 'mcp-tool';
  const [tree, setTree] = useState<SkillTree>();
  const [treeError, setTreeError] = useState<string>();
  useEffect(() => {
    if (!isSkill) return;
    setTree(undefined);
    setTreeError(undefined);
    api.skillTree(connectorId).then(setTree, (e: Error) => setTreeError(e.message));
  }, [connectorId, isSkill]);

  return (
    <div className="rounded-xl bg-slate-50 p-4 ring-1 ring-slate-200">
      <div className="mb-3 flex flex-wrap items-center gap-2 text-xs">
        <Badge tone={src.tone}>{plan.source === 'llm' ? <Sparkles className="size-3" /> : null}{src.label}</Badge>
        <Badge>{plan.kind === 'mcp-tool' ? '调用 MCP 工具' : plan.kind === 'skill-script' ? '执行技能脚本' : '写入技能资料目录'}</Badge>
        {plan.reasoning && <span className="text-slate-500">{plan.reasoning}</span>}
      </div>
      {plan.kind === 'mcp-tool' && (
        <div className="grid gap-3">
          <Field label="上传工具"><Input value={plan.toolName ?? ''} onChange={(e) => set({ toolName: e.target.value })} /></Field>
          <Field label="参数模板 (JSON)" help="占位符：{{id}} {{title}} {{fileName}} {{content}} {{markdown}} {{url}}，每篇文档调用一次">
            <Textarea rows={5} value={pretty(plan.argsTemplate)} onChange={(e) => set({ argsTemplate: e.target.value })} />
          </Field>
          {plan.finalize && <div className="text-xs text-slate-500">全部上传后调用一次：<code className="rounded bg-white px-1">{plan.finalize.toolName}</code> {plan.finalize.argsTemplate}</div>}
        </div>
      )}
      {isSkill && (
        <div className="mb-3 flex flex-wrap items-center gap-3 text-xs text-slate-500">
          <span>导入方式</span>
          {(['skill-files', 'skill-script'] as const).map((k) => (
            <label key={k} className="flex items-center gap-1.5 text-slate-700">
              <input
                type="radio"
                className="accent-indigo-600"
                checked={plan.kind === k}
                onChange={() => set(k === 'skill-script' ? { kind: k, script: plan.script ?? tree?.scripts[0] ?? '', argsTemplate: plan.argsTemplate ?? '["--name","{{fileName}}"]', stdinTemplate: plan.stdinTemplate ?? '{{markdown}}' } : { kind: k, dir: plan.dir ?? 'references' })}
              />
              {k === 'skill-files' ? '写入技能目录' : '执行上传脚本'}
            </label>
          ))}
          {tree && <span className="ml-auto truncate font-mono text-[11px] text-slate-400" title={tree.root}>技能目录：{tree.root}</span>}
        </div>
      )}
      {treeError && <div className="mb-3 text-xs text-rose-600">读取技能目录失败：{treeError}</div>}
      {plan.kind === 'skill-script' && (
        <div className="grid gap-3">
          <Field label="上传脚本" help={tree && !tree.scripts.length ? '技能目录中没有找到脚本文件' : '技能目录内的脚本，需在接入配置中开启「允许执行脚本」'}>
            <SkillPathSelect tree={tree} mode="file" value={plan.script ?? ''} onChange={(v) => set({ script: v })} />
          </Field>
          <Field label="命令行参数模板 (JSON 数组)" help="占位符同上，每篇文档执行一次脚本"><Textarea rows={3} value={pretty(plan.argsTemplate)} onChange={(e) => set({ argsTemplate: e.target.value })} /></Field>
          <Field label="标准输入模板" help="留空表示不传标准输入"><Input value={plan.stdinTemplate ?? ''} onChange={(e) => set({ stdinTemplate: e.target.value || undefined })} /></Field>
        </div>
      )}
      {plan.kind === 'skill-files' && (
        <Field label="写入目录" help="文档以 {id}__{标题}.md 写入该目录下的 kb-bench/ 子目录，每次准备会替换上一批">
          <SkillPathSelect tree={tree} mode="dir" value={plan.dir ?? 'references'} onChange={(v) => set({ dir: v })} />
        </Field>
      )}
    </div>
  );
}

/**
 * 准备知识库：把测评集的文档集合导入被测知识库。
 * Dify / RAGFlow / FastGPT 直接调用上传接口；MCP / Skill 先由大模型阅读接口说明生成上传方案，确认并试传后批量执行。
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
      const skip = testedOk && plan?.kind !== 'skill-files' ? [test!.docId] : undefined;
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
  const canStart = !!dsId && !!kbId && (method === 'api' || (method === 'llm' && !!plan)) && !running;

  return (
    <Modal
      open={open}
      onClose={running ? () => undefined : onClose}
      wide
      title="准备知识库"
      footer={
        <>
          <Button onClick={onClose} disabled={running}>{job?.status === 'done' ? '完成' : '关闭'}</Button>
          {(method === 'api' || method === 'llm') && (
            <Button variant="primary" loading={running} disabled={!canStart} onClick={start}>
              <CloudUpload className="size-4" />开始导入{ds ? ` ${fmtNum(ds.documentCount - (testedOk && plan?.kind !== 'skill-files' ? 1 : 0))} 篇文档` : ''}
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
          <Step n={2} title={`大模型解析${kb?.type === 'mcp' ? ' MCP 工具' : ' Skill'}，生成上传方案`} done={!!plan} active={!!kbId}>
            <p className="mb-3 text-xs leading-relaxed text-slate-500">
              {kb?.type === 'mcp'
                ? '读取 MCP 服务的工具列表及参数定义，由大模型找出写入文档的工具并生成参数模板。'
                : '阅读 SKILL.md、文件列表与脚本，由大模型判断是调用技能自带的上传脚本，还是把文档写入技能的参考资料目录。'}
              使用接入配置中的模型，未配置时使用「评分设置 → 默认 Agent 模型」；大模型不可用时自动改用规则识别。方案只解析一次，之后按模板逐篇执行。
            </p>
            <Button onClick={runPlan} loading={planning} disabled={!kbId || running}><Bot className="size-4" />{plan ? '重新解析' : '解析上传接口'}</Button>
            {savedPlan && plan === savedPlan && <span className="ml-3 text-xs text-slate-500">已加载上次保存的方案</span>}
            {note && <div className="mt-3 rounded-lg bg-amber-50 px-3 py-2 text-xs text-amber-700 ring-1 ring-amber-200">{note}</div>}
            {plan && <div className="mt-3"><PlanEditor plan={plan} onChange={setPlan} connectorId={kbId} /></div>}
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

        {(method === 'api' || method === 'llm') && (
          <Step n={method === 'llm' ? 4 : 2} title="批量导入" done={job?.status === 'done'} active={canStart}>
            {method === 'api' && <p className="text-xs text-slate-500">使用接入配置中的知识库 ID 与 API Key 调用 {kb?.type} 的上传接口。上传后知识库需要一段时间完成解析与向量化，再开始评测。</p>}
            {job ? (
              <div className="space-y-1.5">
                <div className="flex justify-between text-xs text-slate-600">
                  <span>{job.status === 'done' ? `完成：成功 ${result?.uploaded} 篇${result?.skipped ? `（含试传 ${result.skipped} 篇）` : ''}，失败 ${result?.failed} 篇` : job.status === 'error' ? '导入失败' : job.message}</span>
                  <span>{Math.round(job.progress * 100)}%</span>
                </div>
                <Progress value={job.progress} tone={job.status === 'done' ? 'emerald' : 'indigo'} />
                {result?.errors?.slice(0, 3).map((e) => <div key={e} className="text-xs text-rose-600">{e}</div>)}
                {job.error && <ErrorBox>{job.error}</ErrorBox>}
              </div>
            ) : (
              <p className="text-xs text-slate-400">点击右下角「开始导入」。{method === 'llm' && !plan ? '请先解析上传方案。' : ''}</p>
            )}
          </Step>
        )}

        {method === 'none' && <div className="rounded-lg bg-emerald-50 p-4 text-sm text-emerald-800 ring-1 ring-emerald-200">本地 BM25 基线直接读取测评集文档，无需准备，可以直接参与评测。</div>}
        {method === 'builtin' && <div className="rounded-lg bg-amber-50 p-4 text-sm text-amber-800 ring-1 ring-amber-200">内置演示知识库只包含固定的「星云云」演示文档，无法导入其他文档，仅适合配套的演示测评集。</div>}
        {method === 'manual' && (
          <div className="rounded-lg bg-slate-50 p-4 text-sm text-slate-700 ring-1 ring-slate-200">
            {kb?.type} 类接入没有标准的文档上传接口，请下载文档集合后导入到它背后的知识库。
            <div className="mt-3"><Button size="sm" disabled={!dsId} onClick={() => download(api.exportUrl(dsId, 'corpus-zip'))}><Download className="size-3.5" />下载文档集合 ZIP</Button></div>
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
