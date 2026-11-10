import http from 'node:http';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import express from 'express';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { SSEServerTransport } from '@modelcontextprotocol/sdk/server/sse.js';
import { autoExtract } from '../src/adapters/mapping.js';
import { closeAllMcpClients, listMcpTools, mapDirectResult, mcpAdapter, parseArgs, parseToolResult, suggestArgs } from '../src/adapters/mcp.js';
import { loadSkills, parseFrontmatter, skillAdapter } from '../src/adapters/skill.js';
import { createDemoMcpServer, handleDemoMcp } from '../src/demo/mcp-server.js';

const here = path.dirname(fileURLToPath(import.meta.url));
const DEMO_SKILL = path.resolve(here, '../demo/skills/star-cloud-docs');
const STDIO_ENTRY = path.resolve(here, '../src/demo/mcp-stdio.ts');
const TSX = path.resolve(here, '../../node_modules/.bin/tsx');

/**
 * 假的 OpenAI 兼容模型：首轮调用一个检索类工具（或按 "RUN:" 前缀调用 run_script），
 * 拿到工具结果后把结果原文作为答案返回，用来确定性地验证 Agent 循环。
 */
function fakeLlm() {
  const calls: any[] = [];
  const srv = http.createServer((req, res) => {
    let b = '';
    req.on('data', (c) => (b += c));
    req.on('end', () => {
      const body = JSON.parse(b);
      calls.push(body);
      const msgs: any[] = body.messages;
      const question: string = msgs.find((m) => m.role === 'user').content;
      const toolMsgs = msgs.filter((m) => m.role === 'tool');
      let message: any;
      if (!toolMsgs.length && body.tools?.length) {
        const names: string[] = body.tools.map((t: any) => t.function.name);
        const [name, args] = question.startsWith('RUN:')
          ? ['run_script', JSON.parse(question.slice(4))]
          : [names.find((n) => /search/.test(n)) ?? names[0], { query: question, top_k: 3 }];
        message = { role: 'assistant', content: null, tool_calls: [{ id: 'call_1', type: 'function', function: { name, arguments: JSON.stringify(args) } }] };
      } else {
        message = { role: 'assistant', content: `答案：${toolMsgs.map((m) => m.content).join('\n').slice(0, 300)}` };
      }
      res.setHeader('Content-Type', 'application/json');
      res.end(JSON.stringify({ choices: [{ message }] }));
    });
  });
  return { srv, calls };
}

let base = '';
let llmUrl = '';
let sseUrl = '';
const servers: http.Server[] = [];
const llm = fakeLlm();

function listen(srv: http.Server): Promise<string> {
  servers.push(srv);
  return new Promise((r) => srv.listen(0, '127.0.0.1', () => r(`http://127.0.0.1:${(srv.address() as any).port}`)));
}

beforeAll(async () => {
  const app = express();
  app.use(express.json());
  app.all('/mcp', (req, res) => void handleDemoMcp(req, res));

  // 旧版 HTTP+SSE 传输
  const sse = new Map<string, SSEServerTransport>();
  app.get('/sse', async (_req, res) => {
    const t = new SSEServerTransport('/messages', res);
    sse.set(t.sessionId, t);
    res.on('close', () => sse.delete(t.sessionId));
    await createDemoMcpServer().connect(t);
  });
  app.post('/messages', (req, res) => void sse.get(String(req.query.sessionId))?.handlePostMessage(req, res, req.body));

  base = await listen(http.createServer(app));
  sseUrl = `${base}/sse`;
  llmUrl = `${await listen(llm.srv)}/v1`;
});

afterAll(async () => {
  await closeAllMcpClients();
  for (const s of servers) s.closeAllConnections?.(), s.close();
});

describe('result mapping helpers', () => {
  it('auto extracts contexts from common shapes', () => {
    const r = autoExtract({ answer: 'A', data: { chunks: [{ text: 't1', metadata: { document_name: 'd1' }, similarity: 0.5 }] } });
    expect(r.answer).toBe('A');
    expect(r.contexts).toEqual([{ content: 't1', source: 'd1', id: undefined, score: 0.5 }]);
  });
  it('suggests args from input schema', () => {
    expect(suggestArgs({ type: 'object', properties: { query: { type: 'string' }, top_k: { type: 'number' } } })).toBe('{"query": "{{question}}", "top_k": {{topK}}}');
    expect(suggestArgs({ type: 'object', properties: { foo: { type: 'string' }, limit: { type: 'integer' } }, required: ['foo'] })).toBe('{"foo": "{{question}}", "limit": {{topK}}}');
  });
  it('parses stdio args', () => {
    expect(parseArgs('-y "@org/pkg name" --x')).toEqual(['-y', '@org/pkg name', '--x']);
    expect(parseArgs('["a","b c"]')).toEqual(['a', 'b c']);
  });
  it('maps tool results', () => {
    const parsed = parseToolResult({ content: [{ type: 'text', text: '{"results":[{"content":"x","title":"t"}]}' }] });
    expect(mapDirectResult(parsed, { resultAs: 'contexts' }).contexts).toEqual([{ content: 'x', source: 't', id: undefined, score: undefined }]);
    const plain = parseToolResult({ content: [{ type: 'text', text: '90天' }] });
    expect(mapDirectResult(plain, { resultAs: 'answer' }).answer).toBe('90天');
    expect(() => parseToolResult({ isError: true, content: [{ type: 'text', text: 'boom' }] })).toThrow(/boom/);
  });
});

describe('MCP adapter', () => {
  const q = 'AccessKey 多久需要轮换一次？';
  const direct = { mode: 'direct', toolName: 'search_knowledge_base', argsTemplate: '{"query": "{{question}}", "top_k": {{topK}}}', resultAs: 'contexts' };

  it('lists tools over streamable HTTP', async () => {
    const tools = await listMcpTools({ transport: 'streamable-http', url: `${base}/mcp` }, 0);
    expect(tools.map((t) => t.name)).toEqual(['search_knowledge_base', 'get_document', 'list_documents']);
    expect(tools[0].suggestedArgs).toBe('{"query": "{{question}}", "top_k": {{topK}}}');
  });

  it('direct mode over streamable HTTP', async () => {
    const res = await mcpAdapter.query({ ...direct, transport: 'streamable-http', url: `${base}/mcp` }, q, { topK: 3 });
    expect(res.contexts).toHaveLength(3);
    expect(res.contexts[0].source).toBe('账号安全最佳实践.md');
    expect(res.trace?.[0].name).toBe('search_knowledge_base');
  });

  it('direct mode over legacy SSE', async () => {
    const res = await mcpAdapter.query({ ...direct, transport: 'sse', url: sseUrl }, q, { topK: 2 });
    expect(res.contexts[0].source).toBe('账号安全最佳实践.md');
  });

  it('direct mode over stdio', async () => {
    const res = await mcpAdapter.query({ ...direct, transport: 'stdio', command: TSX, args: STDIO_ENTRY }, q, { topK: 2 });
    expect(res.contexts[0].source).toBe('账号安全最佳实践.md');
  });

  it('resource content blocks become contexts', async () => {
    const res = await mcpAdapter.query(
      { transport: 'streamable-http', url: `${base}/mcp`, mode: 'direct', toolName: 'get_document', argsTemplate: '{"doc": "退款政策"}', resultAs: 'contexts' },
      'x',
      { topK: 3 },
    );
    expect(res.contexts[0].source).toBe('kb://star-cloud/退款政策.md');
  });

  it('agent mode lets the LLM call MCP tools', async () => {
    const res = await mcpAdapter.query({ transport: 'streamable-http', url: `${base}/mcp`, mode: 'agent', llmBaseUrl: llmUrl, llmModel: 'fake', maxSteps: 3 }, q, { topK: 5 });
    expect(res.answer).toContain('90天');
    expect(res.contexts[0].source).toBe('账号安全最佳实践.md');
    expect(res.trace?.map((t) => t.type)).toEqual(['llm', 'tool', 'llm']);
    const lastReq = llm.calls.at(-1);
    expect(lastReq.tools.map((t: any) => t.function.name)).toContain('search_knowledge_base');
  });

  it('reports capabilities by mode', () => {
    expect(mcpAdapter.resolveCapabilities!({ mode: 'direct', resultAs: 'contexts' })).toEqual({ retrieval: true, answer: false });
    expect(mcpAdapter.resolveCapabilities!({ mode: 'direct', resultAs: 'answer' })).toEqual({ retrieval: false, answer: true });
    expect(mcpAdapter.resolveCapabilities!({ mode: 'agent' })).toEqual({ retrieval: true, answer: true });
  });
});

describe('Skill adapter', () => {
  it('parses frontmatter and loads skills', () => {
    expect(parseFrontmatter('---\nname: "a"\ndescription: b\n---\nbody').meta).toEqual({ name: 'a', description: 'b' });
    const s = loadSkills(DEMO_SKILL);
    expect(s.skills[0].name).toBe('star-cloud-docs');
    expect(s.files).toContain('references/退款政策.md');
  });

  it('loads a parent folder containing multiple skills', () => {
    const s = loadSkills(path.dirname(DEMO_SKILL));
    expect(s.skills[0].dir).toBe('star-cloud-docs');
  });

  it('retrieval mode searches skill references without an LLM', async () => {
    const res = await skillAdapter.query({ skillPath: DEMO_SKILL, mode: 'retrieval' }, '归档存储的价格是多少？', { topK: 3 });
    expect(res.answer).toBeUndefined();
    expect(res.contexts[0].source).toBe('references/对象存储计费.md');
  });

  it('agent mode uses skill tools', async () => {
    const res = await skillAdapter.query({ skillPath: DEMO_SKILL, mode: 'agent', llmBaseUrl: llmUrl, llmModel: 'fake' }, 'AccessKey 多久需要轮换一次？', { topK: 3 });
    expect(res.answer).toContain('90天');
    expect(res.contexts[0].source).toBe('references/账号安全最佳实践.md');
    const req = llm.calls.at(-1);
    expect(req.messages[0].content).toContain('<skill name="star-cloud-docs"');
    expect(req.tools.map((t: any) => t.function.name)).toEqual(['list_files', 'read_file', 'search_files']);
  });

  it('runs skill scripts only when allowed', async () => {
    const question = 'RUN:' + JSON.stringify({ path: 'scripts/oss_price.py', args: ['archive', '100'] });
    const denied = await skillAdapter.query({ skillPath: DEMO_SKILL, mode: 'agent', llmBaseUrl: llmUrl, llmModel: 'fake' }, question, { topK: 3 });
    expect(denied.trace?.find((t) => t.type === 'tool')?.error).toMatch(/未知工具/);
    const allowed = await skillAdapter.query({ skillPath: DEMO_SKILL, mode: 'agent', allowScripts: 'yes', llmBaseUrl: llmUrl, llmModel: 'fake' }, question, { topK: 3 });
    expect(allowed.answer).toContain('3.30 元');
  });

  it('blocks path traversal', async () => {
    const question = 'RUN:' + JSON.stringify({ path: '../../../package.json' });
    const res = await skillAdapter.query({ skillPath: DEMO_SKILL, mode: 'agent', allowScripts: 'yes', llmBaseUrl: llmUrl, llmModel: 'fake' }, question, { topK: 3 });
    expect(res.trace?.find((t) => t.type === 'tool')?.error).toMatch(/路径越界/);
  });
});
