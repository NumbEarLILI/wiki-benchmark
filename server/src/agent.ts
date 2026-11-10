import type { FieldDef, LlmSettings, RetrievedContext, TraceStep } from './types.js';
import { requestJson, str, trimSlash } from './adapters/http.js';
import { db } from './store.js';

export interface AgentTool {
  name: string;
  description: string;
  parameters: Record<string, unknown>;
  execute(args: Record<string, unknown>, signal?: AbortSignal): Promise<{ text: string; contexts?: RetrievedContext[] }>;
}

export interface AgentResult {
  answer: string;
  contexts: RetrievedContext[];
  trace: TraceStep[];
}

const TOOL_OUTPUT_LIMIT = 8000;

/** 接入配置中可覆盖的 Agent 模型字段，未填写时回落到「评分设置」中的默认 Agent 模型 */
export function llmFields(showIf?: FieldDef['showIf']): FieldDef[] {
  return [
    { key: 'llmBaseUrl', label: 'Agent 模型 Base URL', type: 'text', placeholder: '留空使用评分设置中的默认 Agent 模型', showIf },
    { key: 'llmApiKey', label: 'Agent 模型 API Key', type: 'password', showIf },
    { key: 'llmModel', label: 'Agent 模型名称', type: 'text', placeholder: '如 gpt-4o-mini / deepseek-chat / qwen-plus', showIf },
    { key: 'maxSteps', label: '最大工具调用轮数', type: 'number', default: 6, showIf },
  ];
}

export function resolveLlm(config: Record<string, unknown>): LlmSettings {
  const d = db.settings.agent;
  const llm = {
    baseUrl: str(config.llmBaseUrl) || d.baseUrl,
    apiKey: str(config.llmApiKey) || d.apiKey,
    model: str(config.llmModel) || d.model,
  };
  if (!llm.baseUrl || !llm.model) throw new Error('Agent 模式需要配置模型：在接入配置或「评分设置 → 默认 Agent 模型」中填写');
  return llm;
}

/** OpenAI 函数名限制为 [a-zA-Z0-9_-]{1,64} */
function safeName(name: string, used: Set<string>) {
  let n = name.replace(/[^a-zA-Z0-9_-]/g, '_').slice(0, 60) || 'tool';
  while (used.has(n)) n = `${n.slice(0, 58)}_${used.size}`;
  used.add(n);
  return n;
}

function dedupe(contexts: RetrievedContext[]) {
  const seen = new Set<string>();
  return contexts.filter((c) => {
    const k = `${c.source ?? ''}|${c.content}`;
    if (seen.has(k)) return false;
    seen.add(k);
    return true;
  });
}

export async function runAgent(opts: {
  llm: LlmSettings;
  system: string;
  question: string;
  tools: AgentTool[];
  maxSteps: number;
  signal?: AbortSignal;
}): Promise<AgentResult> {
  const { llm, signal } = opts;
  const used = new Set<string>();
  const byName = new Map(opts.tools.map((t) => [safeName(t.name, used), t]));
  const toolDefs = [...byName.entries()].map(([name, t]) => ({
    type: 'function',
    function: { name, description: t.description.slice(0, 1024), parameters: t.parameters },
  }));
  const messages: Record<string, unknown>[] = [
    { role: 'system', content: opts.system },
    { role: 'user', content: opts.question },
  ];
  const trace: TraceStep[] = [];
  const contexts: RetrievedContext[] = [];

  const chat = async (withTools: boolean) => {
    const started = performance.now();
    const data = await requestJson(`${trimSlash(llm.baseUrl)}/chat/completions`, {
      signal,
      headers: llm.apiKey ? { Authorization: `Bearer ${llm.apiKey}` } : {},
      body: {
        model: llm.model,
        temperature: 0,
        messages,
        ...(withTools && toolDefs.length ? { tools: toolDefs, tool_choice: 'auto' } : {}),
      },
    });
    trace.push({ type: 'llm', name: llm.model, latencyMs: Math.round(performance.now() - started) });
    const msg = data.choices?.[0]?.message;
    if (!msg) throw new Error('Agent 模型未返回消息');
    return msg;
  };

  for (let step = 0; step < Math.max(1, opts.maxSteps); step++) {
    const msg = await chat(true);
    const calls: any[] = msg.tool_calls ?? [];
    if (!calls.length) return { answer: str(msg.content), contexts: dedupe(contexts), trace };
    messages.push({ role: 'assistant', content: msg.content ?? null, tool_calls: calls });
    for (const call of calls) {
      const tool = byName.get(call.function?.name);
      const started = performance.now();
      let output: string;
      let args: Record<string, unknown> = {};
      let error: string | undefined;
      try {
        args = call.function?.arguments ? JSON.parse(call.function.arguments) : {};
        if (!tool) throw new Error(`未知工具 ${call.function?.name}`);
        const res = await tool.execute(args, signal);
        output = res.text.slice(0, TOOL_OUTPUT_LIMIT);
        if (res.contexts) contexts.push(...res.contexts);
      } catch (e) {
        error = (e as Error).message;
        output = `工具调用失败：${error}`;
      }
      trace.push({ type: 'tool', name: tool?.name ?? String(call.function?.name), args, output: output.slice(0, 1500), latencyMs: Math.round(performance.now() - started), error });
      messages.push({ role: 'tool', tool_call_id: call.id, content: output });
    }
  }
  messages.push({ role: 'user', content: '已达到工具调用上限，请基于已获得的信息直接给出最终答案。' });
  const final = await chat(false);
  return { answer: str(final.content), contexts: dedupe(contexts), trace };
}
