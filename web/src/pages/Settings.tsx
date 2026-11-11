import { useEffect, useState } from 'react';
import { Save } from 'lucide-react';
import { api } from '../api';
import { METRICS, useAsync } from '../lib';
import type { Settings } from '../types';
import { Button, Card, ErrorBox, Field, Input, PageHeader } from '../components/ui';

export default function SettingsPage() {
  const remote = useAsync(api.settings);
  const [s, setS] = useState<Settings>();
  const [saving, setSaving] = useState(false);
  const [msg, setMsg] = useState<string>();
  const [error, setError] = useState<string>();

  useEffect(() => {
    if (remote.data) setS(remote.data);
  }, [remote.data]);

  if (!s) return <div className="text-sm text-slate-500">加载中…</div>;

  const save = async () => {
    setSaving(true);
    setError(undefined);
    try {
      setS(await api.saveSettings(s));
      setMsg('已保存');
      setTimeout(() => setMsg(undefined), 2000);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setSaving(false);
    }
  };

  const wsum = s.weights.retrieval + s.weights.answer + s.weights.performance || 1;

  return (
    <>
      <PageHeader
        title="评分设置"
        desc="配置综合得分的计算方式与 LLM 裁判模型。修改后对新建的评测任务生效，历史任务可在详情页调整权重重新计分。"
        actions={<>{msg && <span className="text-xs text-emerald-600">{msg}</span>}<Button variant="primary" loading={saving} onClick={save}><Save className="size-4" />保存设置</Button></>}
      />
      {error && <div className="mb-4"><ErrorBox>{error}</ErrorBox></div>}
      <div className="grid gap-6 lg:grid-cols-2">
        <Card title="综合得分权重">
          <div className="grid grid-cols-3 gap-3">
            {(['retrieval', 'answer', 'performance'] as const).map((k) => (
              <Field key={k} label={{ retrieval: '检索', answer: '答案', performance: '性能' }[k]} help={`占比 ${((s.weights[k] / wsum) * 100).toFixed(0)}%`}>
                <Input type="number" step="0.05" min={0} value={s.weights[k]} onChange={(e) => setS({ ...s, weights: { ...s.weights, [k]: Number(e.target.value) } })} />
              </Field>
            ))}
          </div>
          <div className="mt-5 grid grid-cols-2 gap-3">
            <Field label="目标延迟 (ms)" help="不高于该值性能满分"><Input type="number" value={s.latencyTargetMs} onChange={(e) => setS({ ...s, latencyTargetMs: Number(e.target.value) })} /></Field>
            <Field label="最大延迟 (ms)" help="达到该值延迟分为 0"><Input type="number" value={s.latencyMaxMs} onChange={(e) => setS({ ...s, latencyMaxMs: Number(e.target.value) })} /></Field>
          </div>
        </Card>

        <Card title="LLM 裁判（可选）">
          <label className="mb-4 flex items-center gap-2 text-sm">
            <input type="checkbox" className="size-4 accent-indigo-600" checked={s.judge.enabled} onChange={(e) => setS({ ...s, judge: { ...s.judge, enabled: e.target.checked } })} />
            启用 LLM 裁判，评估答案正确性与忠实度
          </label>
          <div className="space-y-3">
            <Field label="Base URL" help="任意 OpenAI 兼容接口，如 OpenAI、DeepSeek、通义千问、本地 vLLM / Ollama"><Input value={s.judge.baseUrl} onChange={(e) => setS({ ...s, judge: { ...s.judge, baseUrl: e.target.value } })} /></Field>
            <div className="grid grid-cols-2 gap-3">
              <Field label="API Key"><Input type="password" autoComplete="off" value={s.judge.apiKey} onChange={(e) => setS({ ...s, judge: { ...s.judge, apiKey: e.target.value } })} /></Field>
              <Field label="模型"><Input value={s.judge.model} onChange={(e) => setS({ ...s, judge: { ...s.judge, model: e.target.value } })} /></Field>
            </div>
          </div>
        </Card>

        <Card title="默认 Agent 模型" className="lg:col-span-2">
          <p className="mb-4 text-xs text-slate-500">MCP 服务（Agent 模式）与 Skill 技能包（Agent 模式）需要一个支持函数调用（tools）的 OpenAI 兼容模型来自主调用工具。接入配置中未单独填写模型时使用这里的设置。</p>
          <div className="grid gap-3 md:grid-cols-3">
            <Field label="Base URL"><Input value={s.agent.baseUrl} onChange={(e) => setS({ ...s, agent: { ...s.agent, baseUrl: e.target.value } })} /></Field>
            <Field label="API Key"><Input type="password" autoComplete="off" value={s.agent.apiKey} onChange={(e) => setS({ ...s, agent: { ...s.agent, apiKey: e.target.value } })} /></Field>
            <Field label="模型"><Input value={s.agent.model} onChange={(e) => setS({ ...s, agent: { ...s.agent, model: e.target.value } })} /></Field>
          </div>
        </Card>

        <Card title="社区评测集数据源" className="lg:col-span-2">
          <p className="mb-4 text-xs text-slate-500">导入社区评测集时从 Hugging Face 读取 Parquet 数据。国内网络可改为镜像地址（如 https://hf-mirror.com）；访问受限数据集时填写 Access Token。</p>
          <div className="grid gap-3 md:grid-cols-2">
            <Field label="Hugging Face 地址"><Input value={s.hfEndpoint} onChange={(e) => setS({ ...s, hfEndpoint: e.target.value })} placeholder="https://huggingface.co" /></Field>
            <Field label="Access Token（可选）"><Input type="password" autoComplete="off" value={s.hfToken} onChange={(e) => setS({ ...s, hfToken: e.target.value })} placeholder="hf_..." /></Field>
          </div>
        </Card>

        <Card title="评分口径说明" className="lg:col-span-2">
          <div className="grid gap-6 text-xs leading-relaxed text-slate-600 md:grid-cols-3">
            <div>
              <h4 className="mb-2 text-sm font-semibold text-slate-900">检索得分</h4>
              <p>Hit@K、Recall@K、MRR、nDCG@K 四项的均值 × 100。相关性判定优先使用题目的「相关文档」匹配召回片段的来源/ID（按文档 ID 精确匹配，或匹配文档标题 / 文件名）；未标注时使用「关键要点」覆盖（≥50%），再退化为参考答案词元覆盖（≥50%）。</p>
            </div>
            <div>
              <h4 className="mb-2 text-sm font-semibold text-slate-900">答案得分</h4>
              <p>启用 LLM 裁判时取正确性与忠实度均值；否则取要点覆盖率、Token F1、ROUGE-L 的均值（中文按字切分）。× 100。</p>
            </div>
            <div>
              <h4 className="mb-2 text-sm font-semibold text-slate-900">性能得分 & 综合</h4>
              <p>成功率 × 延迟系数（P50 与 P95 各自在目标与最大延迟之间线性衰减后取均值）× 100。综合得分按权重加权，缺失维度自动归一化；请求失败的题目在所有质量指标上记 0 分。</p>
            </div>
          </div>
          <div className="mt-5 grid gap-x-6 gap-y-1.5 border-t border-slate-100 pt-4 text-xs sm:grid-cols-2">
            {METRICS.map((m) => <div key={m.key}><b className="text-slate-800">{m.label}</b><span className="ml-2 text-slate-500">{m.desc}</span></div>)}
          </div>
        </Card>
      </div>
    </>
  );
}
