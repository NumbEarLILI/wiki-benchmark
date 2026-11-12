import fs from 'node:fs';
import path from 'node:path';
import type { DatasetDocument, IngestResult } from './types.js';
import { requestJson, renderTemplate, str, trimSlash } from './adapters/http.js';
import { callMcpTool, listMcpTools, type McpToolInfo } from './adapters/mcp.js';
import { execSkillScript, invalidateSkillCache, loadSkills, safeJoin } from './adapters/skill.js';
import { ingestEach } from './adapters/ingest.js';
import { resolveLlm } from './agent.js';
import { docFileName, docMarkdown } from './corpus.js';

/**
 * 文档上传方案：由大模型阅读 MCP 工具列表或 Skill 说明后生成，执行时按模板逐篇调用，
 * 不再每篇文档都询问大模型，既省成本又保证结果确定。
 */
export interface IngestPlan {
  kind: 'mcp-tool' | 'skill-script' | 'skill-files';
  /** mcp-tool：上传工具名 */
  toolName?: string;
  /** skill-script：脚本相对路径 */
  script?: string;
  /** mcp-tool 为参数对象模板；skill-script 为命令行参数数组模板（JSON 字符串） */
  argsTemplate?: string;
  /** skill-script：标准输入模板 */
  stdinTemplate?: string;
  /** skill-files：写入的目录（相对技能根目录） */
  dir?: string;
  /** 全部上传后调用一次，例如触发重建索引 */
  finalize?: { toolName: string; argsTemplate: string };
  reasoning: string;
  source: 'llm' | 'heuristic' | 'manual';
}

export const DOC_VARS: Record<string, string> = {
  id: '文档 ID',
  title: '文档标题',
  fileName: '文件名 `{id}__{标题}.md`，评测靠它判定命中',
  content: '正文纯文本',
  markdown: '带标题的 Markdown 全文',
  url: '原文链接（可能为空）',
};

export const FILES_SUBDIR = 'kb-bench';

export function docVars(doc: DatasetDocument): Record<string, string> {
  return { id: doc.id, title: doc.title, fileName: docFileName(doc), content: doc.content, markdown: docMarkdown(doc), url: doc.url ?? '' };
}

function renderJson<T>(tpl: string, vars: Record<string, string>): T {
  const text = renderTemplate(tpl, vars);
  try {
    return JSON.parse(text) as T;
  } catch {
    throw new Error(`参数模板渲染后不是合法 JSON：${text.slice(0, 200)}`);
  }
}

export function parsePlan(v: unknown): IngestPlan | undefined {
  if (!v) return undefined;
  const p = (typeof v === 'string' ? JSON.parse(v) : v) as IngestPlan;
  return p?.kind ? p : undefined;
}

export function validatePlan(type: string, p: IngestPlan) {
  if (type === 'mcp' && p.kind !== 'mcp-tool') throw new Error('MCP 接入的上传方案必须是 mcp-tool');
  if (type === 'skill' && p.kind === 'mcp-tool') throw new Error('Skill 接入的上传方案必须是 skill-script 或 skill-files');
  if (p.kind === 'mcp-tool') {
    if (!p.toolName) throw new Error('上传方案缺少工具名称');
    renderJson(p.argsTemplate || '{}', docVars({ id: 'x', title: 'x', content: 'x' }));
  }
  if (p.kind === 'skill-script') {
    if (!p.script) throw new Error('上传方案缺少脚本路径');
    const argv = renderJson<unknown>(p.argsTemplate || '[]', docVars({ id: 'x', title: 'x', content: 'x' }));
    if (!Array.isArray(argv)) throw new Error('脚本参数模板必须是 JSON 数组');
  }
}

// ---------- 大模型解析 ----------
function extractJson(text: string): any {
  const t = text.replace(/```(?:json)?/gi, '').trim();
  const start = t.indexOf('{');
  const end = t.lastIndexOf('}');
  if (start < 0 || end <= start) throw new Error('大模型没有返回 JSON');
  return JSON.parse(t.slice(start, end + 1));
}

async function askLlm(config: Record<string, unknown>, system: string, user: string, signal?: AbortSignal): Promise<any> {
  const llm = resolveLlm(config);
  const data = await requestJson(`${trimSlash(llm.baseUrl)}/chat/completions`, {
    signal,
    headers: llm.apiKey ? { Authorization: `Bearer ${llm.apiKey}` } : {},
    body: { model: llm.model, temperature: 0, messages: [{ role: 'system', content: system }, { role: 'user', content: user }] },
  });
  return extractJson(String(data.choices?.[0]?.message?.content ?? ''));
}

const asTemplate = (v: unknown, fallback: string) => (v === undefined || v === null ? fallback : typeof v === 'string' ? v : JSON.stringify(v));

const VAR_DOC = Object.entries(DOC_VARS).map(([k, v]) => `- {{${k}}}：${v}`).join('\n');

const PLAN_RULES = `参数模板中的字符串可以使用以下占位符，执行时会替换为每篇文档的值（自动做 JSON 转义）：
${VAR_DOC}
规则：
1. 文档的标题 / 名称 / 文件名类参数必须使用 {{fileName}}，因为知识库检索结果会返回这个名字，评测依靠其中的文档 ID 判定命中。
2. 正文类参数使用 {{markdown}}（或接口明确只要纯文本时用 {{content}}）。
3. 只使用接口说明里存在的参数，必填参数必须给出；与上传无关的可选参数不要填。
4. 只输出一个 JSON 对象，不要输出其他文字。`;

const sample = (doc: DatasetDocument) => JSON.stringify({ ...docVars(doc), content: doc.content.slice(0, 200), markdown: docMarkdown(doc).slice(0, 200) }, null, 2);

async function llmPlanMcp(config: Record<string, unknown>, tools: McpToolInfo[], doc: DatasetDocument, signal?: AbortSignal): Promise<IngestPlan> {
  const toolText = tools.map((t) => JSON.stringify({ name: t.name, description: t.description ?? '', inputSchema: t.inputSchema ?? {} })).join('\n');
  const out = await askLlm(
    config,
    '你是知识库集成工程师。你会阅读一个 MCP 服务暴露的工具列表，找出用来向知识库写入 / 上传 / 新增文档的工具，并给出调用参数模板，用于把评测语料逐篇导入该知识库。',
    `## MCP 工具列表（每行一个）\n${toolText}\n\n## 示例文档（占位符取值）\n${sample(doc)}\n\n${PLAN_RULES}\n\n输出格式：{"toolName": "上传工具名，没有可用工具则为空字符串", "argsTemplate": {参数对象}, "finalize": null 或 {"toolName": "全部上传后需调用一次的工具，如重建索引", "argsTemplate": {}}, "reasoning": "用中文简要说明选择依据"}`,
    signal,
  );
  const toolName = str(out.toolName);
  if (!toolName) throw new Error(`大模型认为该 MCP 服务没有可写入文档的工具：${str(out.reasoning)}`);
  if (!tools.some((t) => t.name === toolName)) throw new Error(`大模型选择的工具不存在：${toolName}`);
  const finalize = out.finalize?.toolName && tools.some((t) => t.name === out.finalize.toolName) ? { toolName: String(out.finalize.toolName), argsTemplate: asTemplate(out.finalize.argsTemplate, '{}') } : undefined;
  return { kind: 'mcp-tool', toolName, argsTemplate: asTemplate(out.argsTemplate, '{}'), finalize, reasoning: str(out.reasoning), source: 'llm' };
}

function skillContext(skillPath: string) {
  const s = loadSkills(skillPath);
  const scripts = s.files.filter((f) => /\.(py|js|mjs|sh)$/i.test(f)).slice(0, 5);
  const scriptText = scripts
    .map((f) => {
      const text = fs.readFileSync(path.join(s.root, f), 'utf8').split('\n').slice(0, 80).join('\n');
      return `### ${f}\n\`\`\`\n${text}\n\`\`\``;
    })
    .join('\n\n');
  const skillText = s.skills.map((k) => `### ${k.name}（目录 ${k.dir || '.'}）\n${k.description}\n\n${k.body.slice(0, 4000)}`).join('\n\n');
  return { s, scripts, text: `## 技能说明\n${skillText}\n\n## 文件列表\n${s.files.slice(0, 200).join('\n')}\n\n## 脚本内容（节选）\n${scriptText || '（无脚本）'}` };
}

async function llmPlanSkill(config: Record<string, unknown>, doc: DatasetDocument, signal?: AbortSignal): Promise<IngestPlan> {
  const ctx = skillContext(str(config.skillPath));
  const out = await askLlm(
    config,
    '你是知识库集成工程师。你会阅读一个 Agent Skill（SKILL.md、文件列表与脚本），判断如何把一批评测文档加入这个技能所代表的知识库：如果技能提供了添加 / 上传 / 导入文档的脚本，就给出逐篇调用该脚本的命令行参数模板；否则把文档以 Markdown 文件写入技能的参考资料目录。',
    `${ctx.text}\n\n## 示例文档（占位符取值）\n${sample(doc)}\n\n${PLAN_RULES}\n\n输出格式：{"method": "script" 或 "files", "script": "脚本相对路径（method=script）", "args": ["命令行参数数组模板"], "stdin": "标准输入模板，不需要则为 null", "dir": "写入目录（method=files，通常是参考资料目录如 references）", "reasoning": "用中文简要说明判断依据"}`,
    signal,
  );
  if (out.method === 'script') {
    const script = str(out.script);
    if (!ctx.scripts.includes(script) && !ctx.s.files.includes(script)) throw new Error(`大模型选择的脚本不存在：${script}`);
    return { kind: 'skill-script', script, argsTemplate: asTemplate(out.args, '[]'), stdinTemplate: out.stdin ? String(out.stdin) : undefined, reasoning: str(out.reasoning), source: 'llm' };
  }
  return { kind: 'skill-files', dir: str(out.dir, 'references').replace(/^\/+|\/+$/g, ''), reasoning: str(out.reasoning), source: 'llm' };
}

// ---------- 规则识别（未配置大模型或调用失败时） ----------
const WRITE_TOOL = /(add|upload|create|insert|ingest|import|write|put|save|upsert|index|store|新增|添加|上传|导入)/i;
const CONTENT_KEY = /^(content|text|body|markdown|md|document|data|page_content|正文|内容)$/i;
const TITLE_KEY = /^(title|name|file_?name|filename|path|doc_?name|source|标题|名称)$/i;
const ID_KEY = /^(id|doc_?id|document_?id|key)$/i;

export function heuristicPlanMcp(tools: McpToolInfo[]): IngestPlan {
  const props = (t: McpToolInfo) => Object.keys(((t.inputSchema?.properties ?? {}) as Record<string, unknown>));
  const candidates = tools.filter((t) => WRITE_TOOL.test(t.name) && props(t).some((k) => CONTENT_KEY.test(k)));
  const tool = candidates.find((t) => /doc|file|knowledge|note|page|text/i.test(t.name)) ?? candidates[0];
  if (!tool) throw new Error('没有识别到可写入文档的工具（需要名称含 add / upload / create 等、且带 content / text 参数的工具），请配置大模型或手动填写方案');
  const args: Record<string, string> = {};
  for (const k of props(tool)) {
    if (CONTENT_KEY.test(k) && !Object.values(args).includes('{{markdown}}')) args[k] = '{{markdown}}';
    else if (TITLE_KEY.test(k)) args[k] = '{{fileName}}';
    else if (ID_KEY.test(k)) args[k] = '{{id}}';
  }
  return { kind: 'mcp-tool', toolName: tool.name, argsTemplate: JSON.stringify(args), reasoning: `按名称与参数规则识别出写入工具 ${tool.name}`, source: 'heuristic' };
}

function heuristicPlanSkill(): IngestPlan {
  return { kind: 'skill-files', dir: 'references', reasoning: '把文档以 Markdown 文件写入技能的 references/ 目录，Skill 检索与 Agent 读取时都能用到', source: 'heuristic' };
}

export async function planIngest(type: string, config: Record<string, unknown>, doc: DatasetDocument, signal?: AbortSignal): Promise<{ plan: IngestPlan; note?: string }> {
  if (type !== 'mcp' && type !== 'skill') throw new Error('只有 MCP 与 Skill 接入需要解析上传方案');
  const tools = type === 'mcp' ? await listMcpTools(config, 0) : [];
  if (type === 'skill') skillContext(str(config.skillPath));
  try {
    return { plan: type === 'mcp' ? await llmPlanMcp(config, tools, doc, signal) : await llmPlanSkill(config, doc, signal) };
  } catch (e) {
    const plan = type === 'mcp' ? heuristicPlanMcp(tools) : heuristicPlanSkill();
    return { plan, note: `大模型解析失败（${(e as Error).message}），已改用规则识别，请确认方案是否正确` };
  }
}

// ---------- 执行 ----------
async function uploadOne(type: string, config: Record<string, unknown>, plan: IngestPlan, doc: DatasetDocument, signal?: AbortSignal): Promise<string> {
  const vars = docVars(doc);
  if (plan.kind === 'mcp-tool') {
    const res = await callMcpTool(config, plan.toolName!, renderJson(plan.argsTemplate || '{}', vars), signal);
    return res.text;
  }
  const root = loadSkills(str(config.skillPath)).root;
  if (plan.kind === 'skill-script') {
    if (str(config.allowScripts) !== 'yes') throw new Error('该 Skill 未允许执行脚本，请在接入配置中把「允许执行技能脚本」设为「是」');
    const argv = renderJson<unknown[]>(plan.argsTemplate || '[]', vars).map(String);
    const stdin = plan.stdinTemplate ? fillPlain(plan.stdinTemplate, vars) : undefined;
    const r = await execSkillScript(root, plan.script!, argv, stdin, signal);
    if (r.code !== 0) throw new Error(`脚本退出码 ${r.code}：${(r.stderr || r.stdout).slice(0, 300)}`);
    return r.stdout.trim();
  }
  const dir = filesDir(root, plan);
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, vars.fileName), vars.markdown);
  return path.relative(root, path.join(dir, vars.fileName));
}

/** 标准输入是纯文本而非 JSON 字符串，占位符直接替换为原值 */
function fillPlain(tpl: string, vars: Record<string, string>) {
  return tpl.replace(/\{\{\s*(\w+)\s*\}\}/g, (_, k) => vars[k] ?? '');
}

function filesDir(root: string, plan: IngestPlan) {
  return path.join(safeJoin(root, plan.dir ?? 'references'), FILES_SUBDIR);
}

/** 试传第一篇，返回接口输出，便于确认方案 */
export async function testPlan(type: string, config: Record<string, unknown>, plan: IngestPlan, doc: DatasetDocument, signal?: AbortSignal) {
  validatePlan(type, plan);
  const output = await uploadOne(type, config, plan, doc, signal);
  if (plan.kind === 'skill-files') invalidateSkillCache(str(config.skillPath));
  return output;
}

export async function executePlan(
  type: string,
  config: Record<string, unknown>,
  plan: IngestPlan,
  documents: DatasetDocument[],
  opts: { signal?: AbortSignal; onProgress?: (done: number, total: number) => void; fresh?: boolean },
): Promise<IngestResult> {
  validatePlan(type, plan);
  if (plan.kind === 'skill-files' && opts.fresh !== false) {
    fs.rmSync(filesDir(loadSkills(str(config.skillPath)).root, plan), { recursive: true, force: true });
  }
  const result = await ingestEach(documents, { ...opts, concurrency: plan.kind === 'skill-script' ? 2 : 3 }, async (doc) => {
    await uploadOne(type, config, plan, doc, opts.signal);
  });
  if (plan.finalize && result.uploaded) {
    try {
      await callMcpTool(config, plan.finalize.toolName, renderJson(plan.finalize.argsTemplate || '{}', {}), opts.signal);
    } catch (e) {
      result.errors.push(`收尾调用 ${plan.finalize.toolName} 失败：${(e as Error).message}`);
    }
  }
  if (type === 'skill') invalidateSkillCache(str(config.skillPath));
  return result;
}

export async function ingestWithPlan(type: string, config: Record<string, unknown>, documents: DatasetDocument[], opts: { signal?: AbortSignal; onProgress?: (done: number, total: number) => void }) {
  const plan = parsePlan(config.ingestPlan) ?? (await planIngest(type, config, documents[0], opts.signal)).plan;
  return executePlan(type, config, plan, documents, opts);
}
