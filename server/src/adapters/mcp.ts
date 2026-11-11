import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import { SSEClientTransport } from '@modelcontextprotocol/sdk/client/sse.js';
import { StdioClientTransport, getDefaultEnvironment } from '@modelcontextprotocol/sdk/client/stdio.js';
import { WebSocketClientTransport } from '@modelcontextprotocol/sdk/client/websocket.js';
import type { Transport } from '@modelcontextprotocol/sdk/shared/transport.js';
import type { AdapterDefinition, FieldDef, RetrievedContext } from '../types.js';
import { getPath, parseJsonField, renderTemplate, str, num } from './http.js';
import { autoExtract, toContexts, type FieldMapping } from './mapping.js';
import { llmFields, resolveLlm, runAgent, type AgentTool } from '../agent.js';

const REMOTE = ['streamable-http', 'sse', 'websocket'];
const HTTP = ['streamable-http', 'sse'];
const IDLE_MS = 5 * 60 * 1000;
const CALL_TIMEOUT_MS = 10 * 60 * 1000;

export interface McpToolInfo {
  name: string;
  description?: string;
  inputSchema?: Record<string, unknown>;
  suggestedArgs: string;
}

interface PoolEntry {
  client: Promise<Client>;
  lastUsed: number;
  tools?: { at: number; list: McpToolInfo[] };
}

const pool = new Map<string, PoolEntry>();

export function parseArgs(v: unknown): string[] {
  const s = str(v).trim();
  if (!s) return [];
  if (s.startsWith('[')) return parseJsonField<string[]>(s, []).map(String);
  return (s.match(/"[^"]*"|'[^']*'|\S+/g) ?? []).map((a) => a.replace(/^(["'])(.*)\1$/, '$2'));
}

function transportKey(c: Record<string, unknown>) {
  const t = str(c.transport, 'streamable-http');
  return JSON.stringify(t === 'stdio' ? [t, c.command, c.args, c.env, c.cwd] : [t, c.url, c.headers]);
}

function createTransport(c: Record<string, unknown>): Transport {
  const t = str(c.transport, 'streamable-http');
  if (t === 'stdio') {
    const command = str(c.command);
    if (!command) throw new Error('stdio 传输需要填写启动命令');
    return new StdioClientTransport({
      command,
      args: parseArgs(c.args),
      env: { ...getDefaultEnvironment(), ...parseJsonField<Record<string, string>>(c.env, {}) },
      cwd: str(c.cwd) || undefined,
      stderr: 'ignore',
    });
  }
  const url = str(c.url);
  if (!url) throw new Error('请填写 MCP 服务地址');
  const headers = parseJsonField<Record<string, string>>(c.headers, {});
  if (t === 'websocket') return new WebSocketClientTransport(new URL(url));
  if (t === 'sse') {
    return new SSEClientTransport(new URL(url), {
      requestInit: { headers },
      eventSourceInit: { fetch: (u, init) => fetch(u, { ...init, headers: { ...(init?.headers as Record<string, string>), ...headers } }) },
    });
  }
  return new StreamableHTTPClientTransport(new URL(url), { requestInit: { headers } });
}

async function connect(c: Record<string, unknown>): Promise<PoolEntry> {
  const key = transportKey(c);
  let entry = pool.get(key);
  if (!entry) {
    const client = new Client({ name: 'kb-bench', version: '0.1.0' });
    const p = client.connect(createTransport(c)).then(() => client);
    entry = { client: p, lastUsed: Date.now() };
    pool.set(key, entry);
    client.onclose = () => pool.get(key) === entry && pool.delete(key);
    p.catch(() => pool.get(key) === entry && pool.delete(key));
  }
  entry.lastUsed = Date.now();
  await entry.client;
  return entry;
}

async function withClient<T>(c: Record<string, unknown>, fn: (client: Client, entry: PoolEntry) => Promise<T>): Promise<T> {
  const entry = await connect(c);
  try {
    return await fn(await entry.client, entry);
  } catch (e) {
    if (/not connected|closed|ECONNRESET|EPIPE/i.test((e as Error).message)) pool.delete(transportKey(c));
    throw e;
  }
}

setInterval(() => {
  const now = Date.now();
  for (const [key, e] of pool) {
    if (now - e.lastUsed > IDLE_MS) {
      pool.delete(key);
      e.client.then((c) => c.close()).catch(() => {});
    }
  }
}, 60_000).unref();

export async function closeAllMcpClients() {
  const entries = [...pool.values()];
  pool.clear();
  await Promise.all(entries.map((e) => e.client.then((c) => c.close()).catch(() => {})));
}

const QUESTION_PARAM = /^(query|question|q|text|keyword|keywords|search|search_query|input|prompt|content|message)$/i;
const TOPK_PARAM = /^(top_?k|topK|limit|k|n|size|count|max_results|maxResults|num_results|page_size)$/i;

/** 根据工具的 inputSchema 推测参数模板：问题类字段填 {{question}}，数量类字段填 {{topK}} */
export function suggestArgs(schema?: Record<string, unknown>): string {
  const props = (schema?.properties ?? {}) as Record<string, { type?: string | string[] }>;
  const required = new Set((schema?.required as string[]) ?? []);
  const isType = (p: { type?: string | string[] }, t: string) => (Array.isArray(p.type) ? p.type.includes(t) : p.type === t);
  const entries = Object.entries(props);
  let qKey = entries.find(([k, p]) => QUESTION_PARAM.test(k) && (isType(p, 'string') || !p.type))?.[0];
  qKey ??= entries.find(([k, p]) => required.has(k) && isType(p, 'string'))?.[0];
  qKey ??= entries.find(([, p]) => isType(p, 'string'))?.[0];
  const kKey = entries.find(([k, p]) => TOPK_PARAM.test(k) && (isType(p, 'integer') || isType(p, 'number')))?.[0];
  const parts: string[] = [];
  if (qKey) parts.push(`"${qKey}": "{{question}}"`);
  if (kKey) parts.push(`"${kKey}": {{topK}}`);
  return parts.length ? `{${parts.join(', ')}}` : '{"query": "{{question}}"}';
}

export async function listMcpTools(c: Record<string, unknown>, maxAgeMs = 60_000): Promise<McpToolInfo[]> {
  return withClient(c, async (client, entry) => {
    if (entry.tools && Date.now() - entry.tools.at < maxAgeMs) return entry.tools.list;
    const list: McpToolInfo[] = [];
    let cursor: string | undefined;
    do {
      const res = await client.listTools(cursor ? { cursor } : undefined);
      for (const t of res.tools) list.push({ name: t.name, description: t.description, inputSchema: t.inputSchema as Record<string, unknown>, suggestedArgs: suggestArgs(t.inputSchema as Record<string, unknown>) });
      cursor = res.nextCursor;
    } while (cursor);
    entry.tools = { at: Date.now(), list };
    return list;
  });
}

export async function callMcpTool(c: Record<string, unknown>, name: string, args: Record<string, unknown>, signal?: AbortSignal): Promise<ParsedToolResult> {
  const res = await withClient(c, (client) => client.callTool({ name, arguments: args }, undefined, { signal, timeout: CALL_TIMEOUT_MS }));
  return parseToolResult(res);
}

function tryJson(s: string): unknown {
  const t = s.trim();
  if (!t.startsWith('{') && !t.startsWith('[')) return undefined;
  try {
    return JSON.parse(t);
  } catch {
    return undefined;
  }
}

export interface ParsedToolResult {
  payload: unknown;
  text: string;
  resources: RetrievedContext[];
}

export function parseToolResult(res: any): ParsedToolResult {
  const blocks: any[] = Array.isArray(res?.content) ? res.content : [];
  const texts = blocks.filter((b) => b.type === 'text').map((b) => String(b.text ?? ''));
  const resources: RetrievedContext[] = blocks
    .filter((b) => b.type === 'resource' && b.resource?.text)
    .map((b) => ({ content: String(b.resource.text), source: b.resource.uri, id: b.resource.uri }));
  const text = texts.join('\n') || resources.map((r) => r.content).join('\n');
  if (res?.isError) throw new Error(`MCP 工具返回错误：${text.slice(0, 300) || '未知错误'}`);
  let payload: unknown = res?.structuredContent;
  if (payload === undefined) {
    if (texts.length <= 1) payload = tryJson(texts[0] ?? '') ?? texts[0] ?? '';
    else {
      const parsed = texts.map((t) => tryJson(t));
      payload = parsed.every((p) => p !== undefined) ? parsed.flatMap((p) => (Array.isArray(p) ? p : [p])) : texts;
    }
  }
  return { payload, text, resources };
}

function mappingOf(c: Record<string, unknown>): FieldMapping {
  return {
    contentField: str(c.contentField) || undefined,
    sourceField: str(c.sourceField) || undefined,
    idField: str(c.idField) || undefined,
    scoreField: str(c.scoreField) || undefined,
  };
}

/** 直连模式下把工具结果映射为答案与召回片段 */
export function mapDirectResult(parsed: ParsedToolResult, c: Record<string, unknown>) {
  const m = mappingOf(c);
  const resultAs = str(c.resultAs, 'contexts');
  const answerPath = str(c.answerPath);
  const contextsPath = str(c.contextsPath);
  const auto = autoExtract(parsed.payload, m);
  let answer: string | undefined;
  let contexts: RetrievedContext[] = [];

  if (answerPath) answer = str(getPath(parsed.payload, answerPath));
  else if (resultAs === 'answer') answer = auto.answer ?? parsed.text;
  else answer = auto.answer;

  if (contextsPath) {
    const list = getPath(parsed.payload, contextsPath);
    contexts = Array.isArray(list) ? toContexts(list, m) : [];
  } else if (resultAs === 'contexts') {
    contexts = typeof parsed.payload === 'string' ? (parsed.payload ? [{ content: parsed.payload }] : []) : auto.contexts;
  }
  return { answer, contexts: [...contexts, ...parsed.resources] };
}

const isDirect: FieldDef['showIf'] = { key: 'mode', values: ['direct'] };
const isAgent: FieldDef['showIf'] = { key: 'mode', values: ['agent'] };

export const mcpAdapter: AdapterDefinition = {
  type: 'mcp',
  name: 'MCP 服务',
  description: '对接以 MCP（Model Context Protocol）暴露的知识库，支持 Streamable HTTP、SSE、WebSocket、stdio。可直连调用检索工具，或由 Agent 模型自主选择工具作答。',
  capabilities: ['retrieval', 'answer'],
  fields: [
    {
      key: 'transport',
      label: '传输方式',
      type: 'select',
      default: 'streamable-http',
      options: [
        { label: 'Streamable HTTP', value: 'streamable-http' },
        { label: 'SSE（旧版 HTTP+SSE）', value: 'sse' },
        { label: 'WebSocket', value: 'websocket' },
        { label: 'stdio（本地进程）', value: 'stdio' },
      ],
    },
    { key: 'url', label: '服务地址', type: 'text', required: true, placeholder: 'http://localhost:3000/mcp', showIf: { key: 'transport', values: REMOTE } },
    { key: 'headers', label: '请求头 (JSON)', type: 'json', placeholder: '{"Authorization": "Bearer xxx"}', showIf: { key: 'transport', values: HTTP } },
    { key: 'command', label: '启动命令', type: 'text', required: true, placeholder: 'npx / uvx / python', showIf: { key: 'transport', values: ['stdio'] } },
    { key: 'args', label: '命令参数', type: 'text', placeholder: '-y @org/kb-mcp-server --index ./docs', help: '空格分隔，或 JSON 数组', showIf: { key: 'transport', values: ['stdio'] } },
    { key: 'env', label: '环境变量 (JSON)', type: 'json', placeholder: '{"API_KEY": "xxx"}', showIf: { key: 'transport', values: ['stdio'] } },
    { key: 'cwd', label: '工作目录', type: 'text', showIf: { key: 'transport', values: ['stdio'] } },
    {
      key: 'mode',
      label: '调用模式',
      type: 'select',
      default: 'direct',
      options: [
        { label: '直连工具（评估检索工具本身）', value: 'direct' },
        { label: 'Agent（LLM 自主调用工具作答）', value: 'agent' },
      ],
    },
    { key: 'toolName', label: '工具名称', type: 'text', required: true, placeholder: 'search', help: '可点击下方「获取工具列表」选择', showIf: isDirect },
    { key: 'argsTemplate', label: '参数模板 (JSON)', type: 'textarea', default: '{"query": "{{question}}", "top_k": {{topK}}}', help: '变量：{{question}}、{{topK}}', showIf: isDirect },
    {
      key: 'resultAs',
      label: '工具结果视为',
      type: 'select',
      default: 'contexts',
      options: [
        { label: '召回片段（检索类工具）', value: 'contexts' },
        { label: '答案（问答类工具）', value: 'answer' },
      ],
      showIf: isDirect,
    },
    { key: 'contextsPath', label: '召回列表路径', type: 'text', placeholder: '留空自动识别 results / chunks / documents 等', showIf: isDirect },
    { key: 'answerPath', label: '答案字段路径', type: 'text', placeholder: '留空自动识别 answer / result 等', showIf: isDirect },
    { key: 'contentField', label: '片段内容字段', type: 'text', placeholder: '留空自动识别', showIf: isDirect },
    { key: 'sourceField', label: '片段来源字段', type: 'text', placeholder: '留空自动识别', showIf: isDirect },
    { key: 'allowedTools', label: '允许的工具', type: 'text', placeholder: '留空表示全部，多个用逗号分隔', showIf: isAgent },
    { key: 'systemPrompt', label: '系统提示词', type: 'textarea', placeholder: '你是知识库问答助手，请先调用工具检索，再基于检索结果简洁作答。', showIf: isAgent },
    ...llmFields(isAgent),
  ],
  resolveCapabilities: (c) =>
    str(c.mode, 'direct') === 'agent'
      ? { retrieval: true, answer: true }
      : { retrieval: str(c.resultAs, 'contexts') === 'contexts' || !!str(c.contextsPath), answer: str(c.resultAs, 'contexts') === 'answer' || !!str(c.answerPath) },
  async query(config, question, { topK, signal }) {
    if (str(config.mode, 'direct') === 'agent') {
      const llm = resolveLlm(config);
      const allowed = str(config.allowedTools).split(/[,，\s]+/).filter(Boolean);
      const tools = (await listMcpTools(config)).filter((t) => !allowed.length || allowed.includes(t.name));
      if (!tools.length) throw new Error('MCP 服务没有可用的工具');
      const agentTools: AgentTool[] = tools.map((t) => ({
        name: t.name,
        description: t.description ?? '',
        parameters: t.inputSchema ?? { type: 'object', properties: {} },
        execute: async (args, sig) => {
          const res = await withClient(config, (client) => client.callTool({ name: t.name, arguments: args }, undefined, { signal: sig, timeout: CALL_TIMEOUT_MS }));
          const parsed = parseToolResult(res);
          const auto = autoExtract(parsed.payload);
          const contexts = auto.contexts.length ? auto.contexts : parsed.text ? [{ content: parsed.text, source: t.name }] : [];
          return { text: parsed.text || JSON.stringify(parsed.payload), contexts: [...contexts, ...parsed.resources] };
        },
      }));
      const out = await runAgent({
        llm,
        system: str(config.systemPrompt) || '你是知识库问答助手。请先调用工具检索相关资料，再严格基于检索到的内容简洁作答；资料中没有的信息请明确说明不知道。',
        question,
        tools: agentTools,
        maxSteps: num(config.maxSteps, 6),
        signal,
      });
      return { answer: out.answer, contexts: out.contexts.slice(0, topK), trace: out.trace };
    }

    const toolName = str(config.toolName);
    if (!toolName) throw new Error('直连模式需要填写工具名称');
    const argsText = renderTemplate(str(config.argsTemplate, '{"query": "{{question}}"}'), { question, topK });
    const args = parseJsonField<Record<string, unknown>>(argsText, {});
    const started = performance.now();
    const res = await withClient(config, (client) => client.callTool({ name: toolName, arguments: args }, undefined, { signal, timeout: CALL_TIMEOUT_MS }));
    const parsed = parseToolResult(res);
    const mapped = mapDirectResult(parsed, config);
    return {
      answer: mapped.answer,
      contexts: mapped.contexts.slice(0, topK),
      trace: [{ type: 'tool', name: toolName, args, output: parsed.text.slice(0, 1500), latencyMs: Math.round(performance.now() - started) }],
      raw: res,
    };
  },
};
