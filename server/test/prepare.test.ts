import http from 'node:http';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import express from 'express';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { handleDemoMcp } from '../src/demo/mcp-server.js';
import { demoKb } from '../src/demo/kb-store.js';
import { closeAllMcpClients, listMcpTools, mcpAdapter } from '../src/adapters/mcp.js';
import { skillAdapter } from '../src/adapters/skill.js';
import { executePlan, heuristicPlanMcp, planIngest, testPlan, validatePlan, type IngestPlan } from '../src/prepare.js';
import { evaluateRetrieval } from '../src/metrics.js';
import { docAliases } from '../src/corpus.js';
import type { DatasetDocument } from '../src/types.js';

const docs: DatasetDocument[] = [
  { id: 'Q101', title: 'Lunar regolith', content: 'Lunar regolith contains helium-3 implanted by the solar wind over billions of years.' },
  { id: 'Q102', title: 'Martian dust storms', content: 'Global dust storms on Mars can last for months and block sunlight for rovers.' },
  { id: 'Q103', title: 'Europa ocean', content: 'Europa hides a salty liquid water ocean beneath an ice shell tens of kilometres thick.' },
];

/** 假的规划模型：根据提示词里是 MCP 工具列表还是技能说明，返回对应的上传方案 */
const prompts: string[] = [];
const planner = http.createServer((req, res) => {
  let b = '';
  req.on('data', (c) => (b += c));
  req.on('end', () => {
    const user: string = JSON.parse(b).messages[1].content;
    prompts.push(user);
    let plan: unknown;
    if (user.includes('MCP 工具列表')) plan = { toolName: 'add_document', argsTemplate: { title: '{{fileName}}', content: '{{markdown}}' }, finalize: null, reasoning: 'add_document 用于新增文档' };
    else if (user.includes('scripts/add_doc.py')) plan = { method: 'script', script: 'scripts/add_doc.py', args: ['--name', '{{fileName}}'], stdin: '{{markdown}}', reasoning: '技能提供了 add_doc.py' };
    else plan = { method: 'files', dir: 'references', reasoning: '没有上传脚本，写入参考资料目录' };
    res.setHeader('Content-Type', 'application/json');
    res.end(JSON.stringify({ choices: [{ message: { role: 'assistant', content: '```json\n' + JSON.stringify(plan) + '\n```' } }] }));
  });
});

let mcpConfig: Record<string, unknown> = {};
let llmUrl = '';
let mcpServer: http.Server;

function listen(srv: http.Server): Promise<string> {
  return new Promise((r) => srv.listen(0, '127.0.0.1', () => r(`http://127.0.0.1:${(srv.address() as any).port}`)));
}

function makeSkill(withScript: boolean) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'prep-skill-'));
  fs.mkdirSync(path.join(root, 'references'));
  fs.writeFileSync(path.join(root, 'references', 'intro.md'), '# Space notes\n\nGeneral notes about planets.');
  let body = '# Space KB\n\nAnswer questions from references/.';
  if (withScript) {
    fs.mkdirSync(path.join(root, 'scripts'));
    fs.writeFileSync(
      path.join(root, 'scripts', 'add_doc.py'),
      'import sys, os\nname = sys.argv[sys.argv.index("--name") + 1]\nos.makedirs("../references/uploads", exist_ok=True)\nopen(os.path.join("../references/uploads", name), "w").write(sys.stdin.read())\nprint("saved", name)\n',
    );
    body += '\n\n## Adding documents\nRun `python3 scripts/add_doc.py --name <file name>` and pipe the markdown body via stdin.';
  }
  fs.writeFileSync(path.join(root, 'SKILL.md'), `---\nname: space-kb\ndescription: Space knowledge base\n---\n${body}\n`);
  return root;
}

async function hits(adapterQuery: () => Promise<{ contexts: any[] }>, relevant: string) {
  const r = await adapterQuery();
  return evaluateRetrieval({ id: 'q', question: '', relevantDocs: [relevant] }, r.contexts, 3, docAliases(docs))!.metrics.hit;
}

beforeAll(async () => {
  llmUrl = await listen(planner);
  const app = express();
  app.use(express.json({ limit: '10mb' }));
  app.all('/mcp', handleDemoMcp);
  mcpServer = http.createServer(app);
  const base = await listen(mcpServer);
  mcpConfig = { transport: 'streamable-http', url: `${base}/mcp`, mode: 'direct', toolName: 'search_knowledge_base', argsTemplate: '{"query": "{{question}}", "top_k": {{topK}}}', llmBaseUrl: llmUrl, llmModel: 'planner' };
  demoKb.clear();
});

afterAll(async () => {
  await closeAllMcpClients();
  planner.close();
  mcpServer.close();
});

describe('MCP preparation', () => {
  it('recognises the write tool by rules', async () => {
    const plan = heuristicPlanMcp(await listMcpTools(mcpConfig, 0));
    expect(plan.toolName).toBe('add_document');
    expect(JSON.parse(plan.argsTemplate!)).toEqual({ title: '{{fileName}}', content: '{{markdown}}', doc_id: '{{id}}' });
  });

  it('asks the LLM with the tool schemas and uses its plan', async () => {
    const { plan, note } = await planIngest('mcp', mcpConfig, docs[0]);
    expect(note).toBeUndefined();
    expect(plan).toMatchObject({ kind: 'mcp-tool', toolName: 'add_document', source: 'llm' });
    expect(prompts.at(-1)).toContain('"name":"add_document"');
    expect(prompts.at(-1)).toContain('{{fileName}}');
  });

  it('falls back to rules when the LLM is unreachable', async () => {
    const { plan, note } = await planIngest('mcp', { ...mcpConfig, llmBaseUrl: 'http://127.0.0.1:1' }, docs[0]);
    expect(plan.source).toBe('heuristic');
    expect(note).toMatch(/规则识别/);
  });

  it('uploads every document so the search tool can find them', async () => {
    const { plan } = await planIngest('mcp', mcpConfig, docs[0]);
    expect(await hits(() => mcpAdapter.query(mcpConfig, 'Europa salty ocean under ice', { topK: 3 }), 'Q103')).toBe(0);
    const progress: number[] = [];
    const r = await executePlan('mcp', mcpConfig, plan, docs, { onProgress: (d) => progress.push(d) });
    expect(r).toEqual({ uploaded: 3, failed: 0, errors: [] });
    expect(progress.at(-1)).toBe(3);
    expect(await hits(() => mcpAdapter.query(mcpConfig, 'Europa salty ocean under ice', { topK: 3 }), 'Q103')).toBe(1);
    expect(demoKb.list().map((d) => d.title)).toContain('Q101__Lunar regolith.md');
  });

  it('reports tool errors per document', async () => {
    const bad: IngestPlan = { kind: 'mcp-tool', toolName: 'add_document', argsTemplate: '{"title": "{{fileName}}"}', reasoning: '', source: 'manual' };
    const r = await executePlan('mcp', mcpConfig, bad, docs.slice(0, 1), {});
    expect(r.failed).toBe(1);
    expect(r.errors[0]).toMatch(/Lunar regolith/);
  });
});

describe('Skill preparation', () => {
  it('runs the upload script described by the skill', async () => {
    const root = makeSkill(true);
    const config = { skillPath: root, mode: 'retrieval', allowScripts: 'yes', llmBaseUrl: llmUrl, llmModel: 'planner' };
    const { plan } = await planIngest('skill', config, docs[0]);
    expect(plan).toMatchObject({ kind: 'skill-script', script: 'scripts/add_doc.py', source: 'llm' });
    expect(prompts.at(-1)).toContain('add_doc.py --name');
    expect(await testPlan('skill', config, plan, docs[0])).toContain('saved Q101__Lunar regolith.md');
    const r = await executePlan('skill', config, plan, docs, {});
    expect(r.uploaded).toBe(3);
    expect(fs.readFileSync(path.join(root, 'references/uploads/Q102__Martian dust storms.md'), 'utf8')).toContain('# Martian dust storms');
    expect(await hits(() => skillAdapter.query(config, 'Mars dust storms block sunlight', { topK: 3 }), 'Q102')).toBe(1);
  });

  it('refuses to run scripts unless allowed', async () => {
    const root = makeSkill(true);
    const plan: IngestPlan = { kind: 'skill-script', script: 'scripts/add_doc.py', argsTemplate: '["--name", "{{fileName}}"]', stdinTemplate: '{{markdown}}', reasoning: '', source: 'manual' };
    const r = await executePlan('skill', { skillPath: root, allowScripts: 'no' }, plan, docs.slice(0, 1), {});
    expect(r.errors[0]).toMatch(/允许执行技能脚本/);
  });

  it('writes documents into the references folder and replaces the previous batch', async () => {
    const root = makeSkill(false);
    const config = { skillPath: root, mode: 'retrieval', llmBaseUrl: llmUrl, llmModel: 'planner' };
    const { plan } = await planIngest('skill', config, docs[0]);
    expect(plan).toMatchObject({ kind: 'skill-files', dir: 'references' });
    await executePlan('skill', config, plan, docs.slice(0, 2), {});
    expect(await hits(() => skillAdapter.query(config, 'helium-3 solar wind regolith', { topK: 3 }), 'Q101')).toBe(1);
    await executePlan('skill', config, plan, docs.slice(2), {});
    expect(fs.readdirSync(path.join(root, 'references/kb-bench'))).toEqual(['Q103__Europa ocean.md']);
    expect(fs.existsSync(path.join(root, 'references/intro.md'))).toBe(true);
  });

  it('rejects plans of the wrong kind or with path traversal', async () => {
    expect(() => validatePlan('mcp', { kind: 'skill-files', reasoning: '', source: 'manual' })).toThrow();
    const root = makeSkill(false);
    const r = await executePlan('skill', { skillPath: root }, { kind: 'skill-files', dir: '../../etc', reasoning: '', source: 'manual' }, docs.slice(0, 1), {}).catch((e) => e);
    expect(String(r.message ?? r.errors?.[0])).toMatch(/路径越界/);
  });
});
