import fs from 'node:fs';
import path from 'node:path';
import { execFile } from 'node:child_process';
import type { AdapterDefinition, FieldDef, RetrievedContext } from '../types.js';
import { BM25Index, chunkText, type IndexedChunk } from '../bm25.js';
import { num, str } from './http.js';
import { llmFields, resolveLlm, runAgent, type AgentTool } from '../agent.js';

export interface SkillMeta {
  name: string;
  description: string;
  /** 相对技能根目录的路径 */
  dir: string;
  body: string;
}

interface LoadedSkills {
  root: string;
  skills: SkillMeta[];
  files: string[];
  index: BM25Index;
  at: number;
}

const DOC_EXT = new Set(['.md', '.markdown', '.txt', '.rst', '.csv', '.json', '.jsonl', '.yaml', '.yml', '.html', '.htm', '.xml']);
const SKIP_DIRS = new Set(['node_modules', '.git', '__pycache__', '.venv', 'venv', 'dist']);
const MAX_FILE_BYTES = 512 * 1024;
const CACHE_MS = 30_000;
const cache = new Map<string, LoadedSkills>();

export function parseFrontmatter(md: string): { meta: Record<string, string>; body: string } {
  const m = md.match(/^\uFEFF?---\r?\n([\s\S]*?)\r?\n---\r?\n?/);
  if (!m) return { meta: {}, body: md };
  const meta: Record<string, string> = {};
  for (const line of m[1].split(/\r?\n/)) {
    const kv = line.match(/^([\w-]+)\s*:\s*(.*)$/);
    if (kv) meta[kv[1]] = kv[2].trim().replace(/^(["'])(.*)\1$/, '$2');
  }
  return { meta, body: md.slice(m[0].length) };
}

function walk(root: string, rel = '', out: string[] = []): string[] {
  for (const ent of fs.readdirSync(path.join(root, rel), { withFileTypes: true })) {
    if (ent.name.startsWith('.') && ent.name !== '.') continue;
    const r = rel ? `${rel}/${ent.name}` : ent.name;
    if (ent.isDirectory()) {
      if (!SKIP_DIRS.has(ent.name)) walk(root, r, out);
    } else if (ent.isFile()) out.push(r);
    if (out.length > 5000) break;
  }
  return out;
}

export function resolveSkillRoot(p: string): string {
  if (!p) throw new Error('请填写技能路径');
  let abs = path.resolve(p);
  if (fs.existsSync(abs) && fs.statSync(abs).isFile()) abs = path.dirname(abs);
  if (!fs.existsSync(abs)) throw new Error(`技能路径不存在：${abs}`);
  return abs;
}

/** 技能路径可以是单个技能目录（含 SKILL.md），也可以是包含多个技能子目录的文件夹 */
export function loadSkills(p: string): LoadedSkills {
  const root = resolveSkillRoot(p);
  const hit = cache.get(root);
  if (hit && Date.now() - hit.at < CACHE_MS) return hit;

  const files = walk(root);
  const skillFiles = files.filter((f) => path.basename(f).toUpperCase() === 'SKILL.MD');
  if (!skillFiles.length) throw new Error(`未找到 SKILL.md：${root}`);
  const skills = skillFiles.map((f) => {
    const { meta, body } = parseFrontmatter(fs.readFileSync(path.join(root, f), 'utf8'));
    const dir = path.dirname(f) === '.' ? '' : path.dirname(f);
    return { name: meta.name || path.basename(dir || root), description: meta.description || '', dir, body: body.trim() };
  });

  const docs = files.filter((f) => DOC_EXT.has(path.extname(f).toLowerCase()) && path.basename(f).toUpperCase() !== 'SKILL.MD');
  const indexed = docs.length ? docs : skillFiles;
  const chunks: IndexedChunk[] = [];
  for (const f of indexed) {
    const full = path.join(root, f);
    if (fs.statSync(full).size > MAX_FILE_BYTES) continue;
    const text = f.toUpperCase().endsWith('SKILL.MD') ? parseFrontmatter(fs.readFileSync(full, 'utf8')).body : fs.readFileSync(full, 'utf8');
    chunkText(text).forEach((content, i) => chunks.push({ id: `${f}#${i}`, source: f, content }));
  }
  const loaded: LoadedSkills = {
    root,
    skills,
    files,
    index: new BM25Index(chunks, (c) => `${path.basename(c.source, path.extname(c.source))} ${c.content}`),
    at: Date.now(),
  };
  cache.set(root, loaded);
  return loaded;
}

export function invalidateSkillCache(p: string) {
  cache.delete(resolveSkillRoot(p));
}

export function safeJoin(root: string, rel: unknown): string {
  const full = path.resolve(root, str(rel).replace(/^\/+/, ''));
  if (full !== root && !full.startsWith(root + path.sep)) throw new Error('路径越界：只能访问技能目录内的文件');
  return full;
}

function readText(full: string): string {
  const buf = fs.readFileSync(full);
  if (buf.length > MAX_FILE_BYTES) return buf.subarray(0, MAX_FILE_BYTES).toString('utf8') + '\n…（文件过大已截断）';
  if (buf.includes(0)) throw new Error('二进制文件无法读取');
  return buf.toString('utf8');
}

const INTERPRETERS: Record<string, string> = { '.py': 'python3', '.js': 'node', '.mjs': 'node', '.sh': 'bash' };

/** 执行技能脚本并返回退出码，供准备知识库时按方案逐篇上传文档 */
export function execSkillScript(root: string, rel: string, argv: string[], stdin: string | undefined, signal?: AbortSignal): Promise<{ code: number; stdout: string; stderr: string }> {
  const full = safeJoin(root, rel);
  if (!fs.existsSync(full)) throw new Error(`脚本不存在：${rel}`);
  const interp = INTERPRETERS[path.extname(full).toLowerCase()];
  const [cmd, cmdArgs] = interp ? [interp, [full, ...argv]] : [full, argv];
  return new Promise((resolve) => {
    const child = execFile(cmd, cmdArgs, { cwd: path.dirname(full), timeout: 60_000, maxBuffer: 4 * 1024 * 1024, signal }, (err, stdout, stderr) => {
      const code = err ? (typeof (err as any).code === 'number' ? (err as any).code : 1) : 0;
      resolve({ code, stdout: String(stdout), stderr: String(stderr || (err && !stdout ? err.message : '')) });
    });
    child.stdin?.on('error', () => {});
    child.stdin?.end(stdin ?? '');
  });
}

function runScript(root: string, rel: unknown, args: unknown, signal?: AbortSignal): Promise<string> {
  const full = safeJoin(root, rel);
  if (!fs.existsSync(full)) throw new Error(`脚本不存在：${rel}`);
  const argv = Array.isArray(args) ? args.map(String) : [];
  const interp = INTERPRETERS[path.extname(full).toLowerCase()];
  const [cmd, cmdArgs] = interp ? [interp, [full, ...argv]] : [full, argv];
  return new Promise((resolve) => {
    execFile(cmd, cmdArgs, { cwd: path.dirname(full), timeout: 30_000, maxBuffer: 1024 * 1024, signal }, (err, stdout, stderr) => {
      const out = [stdout, stderr && `[stderr]\n${stderr}`].filter(Boolean).join('\n').trim();
      resolve(err && !out ? `执行失败：${err.message}` : out || '（无输出）');
    });
  });
}

function skillTools(s: LoadedSkills, allowScripts: boolean): AgentTool[] {
  const tools: AgentTool[] = [
    {
      name: 'list_files',
      description: '列出技能目录中的文件（相对路径）。',
      parameters: { type: 'object', properties: { dir: { type: 'string', description: '子目录，留空表示根目录' } } },
      execute: async ({ dir }) => {
        const prefix = str(dir).replace(/^\/+|\/+$/g, '');
        const list = s.files.filter((f) => !prefix || f.startsWith(prefix + '/'));
        return { text: list.slice(0, 500).join('\n') || '（空）' };
      },
    },
    {
      name: 'read_file',
      description: '读取技能目录中的文本文件内容。',
      parameters: { type: 'object', properties: { path: { type: 'string', description: '相对技能根目录的文件路径' } }, required: ['path'] },
      execute: async ({ path: rel }) => {
        const text = readText(safeJoin(s.root, rel));
        return { text, contexts: [{ id: str(rel), source: str(rel), content: text }] };
      },
    },
    {
      name: 'search_files',
      description: '在技能的参考资料中做全文检索，返回最相关的片段及其文件路径。',
      parameters: {
        type: 'object',
        properties: { query: { type: 'string', description: '检索关键词或问题' }, top_k: { type: 'integer', description: '返回条数，默认 5' } },
        required: ['query'],
      },
      execute: async ({ query, top_k }) => {
        const hits = s.index.search(str(query), Math.max(1, Math.min(20, num(top_k, 5)))).filter((h) => h.score > 0);
        const contexts: RetrievedContext[] = hits.map((h) => ({ id: h.chunk.id, source: h.chunk.source, content: h.chunk.content, score: Number(h.score.toFixed(4)) }));
        return { text: contexts.map((c, i) => `[${i + 1}] ${c.source}\n${c.content}`).join('\n\n') || '没有找到相关内容', contexts };
      },
    },
  ];
  if (s.skills.length > 1) {
    tools.unshift({
      name: 'load_skill',
      description: '加载指定技能的完整说明（SKILL.md 正文）。',
      parameters: { type: 'object', properties: { name: { type: 'string', enum: s.skills.map((k) => k.name) } }, required: ['name'] },
      execute: async ({ name }) => {
        const k = s.skills.find((x) => x.name === name);
        if (!k) throw new Error(`技能不存在：${name}`);
        return { text: `技能目录：${k.dir || '.'}\n\n${k.body}` };
      },
    });
  }
  if (allowScripts) {
    tools.push({
      name: 'run_script',
      description: '执行技能目录中的脚本（.py / .js / .sh 或可执行文件），返回标准输出。',
      parameters: {
        type: 'object',
        properties: { path: { type: 'string', description: '脚本相对路径' }, args: { type: 'array', items: { type: 'string' }, description: '命令行参数' } },
        required: ['path'],
      },
      execute: async ({ path: rel, args }, signal) => {
        const text = await runScript(s.root, rel, args, signal);
        return { text, contexts: [{ id: str(rel), source: str(rel), content: text }] };
      },
    });
  }
  return tools;
}

export function skillSystemPrompt(s: LoadedSkills, extra: string): string {
  const head = '你是知识库问答助手，可以使用下列技能（Skill）来回答用户问题。请按照技能说明，使用工具查阅技能目录中的参考资料后，严格基于资料简洁作答；资料中没有的信息请明确说明不知道。';
  const skillText =
    s.skills.length === 1
      ? `<skill name="${s.skills[0].name}" dir="${s.skills[0].dir || '.'}">\n${s.skills[0].description}\n\n${s.skills[0].body}\n</skill>`
      : `可用技能（需要时调用 load_skill 加载完整说明）：\n${s.skills.map((k) => `- ${k.name}（目录 ${k.dir || '.'}）：${k.description}`).join('\n')}`;
  return [head, extra, skillText, `技能目录文件：\n${s.files.slice(0, 200).join('\n')}`].filter(Boolean).join('\n\n');
}

const isAgent: FieldDef['showIf'] = { key: 'mode', values: ['agent'] };

export const skillAdapter: AdapterDefinition = {
  type: 'skill',
  name: 'Skill 技能包',
  description: '评测以 Agent Skill（SKILL.md + 参考资料 / 脚本）形式封装的知识库。Agent 模式由 LLM 按技能说明查阅资料作答；检索模式直接对技能资料做全文检索。',
  capabilities: ['retrieval', 'answer'],
  fields: [
    { key: 'skillPath', label: '技能路径', type: 'text', required: true, placeholder: '/path/to/skills/my-kb', help: '服务端本地路径：单个技能目录（含 SKILL.md），或包含多个技能的目录' },
    {
      key: 'mode',
      label: '调用模式',
      type: 'select',
      default: 'agent',
      options: [
        { label: 'Agent（LLM 按技能说明作答）', value: 'agent' },
        { label: '仅检索（无需 LLM，评估资料可检索性）', value: 'retrieval' },
      ],
    },
    {
      key: 'allowScripts',
      label: '允许执行技能脚本',
      type: 'select',
      default: 'no',
      options: [
        { label: '否', value: 'no' },
        { label: '是（脚本将在服务端执行，仅用于可信技能）', value: 'yes' },
      ],
      help: '对 Agent 调用脚本与「准备知识库」时执行上传脚本均生效',
    },
    { key: 'systemPrompt', label: '附加系统提示词', type: 'textarea', showIf: isAgent },
    ...llmFields(isAgent),
  ],
  resolveCapabilities: (c) => ({ retrieval: true, answer: str(c.mode, 'agent') === 'agent' }),
  async query(config, question, { topK, signal }) {
    const s = loadSkills(str(config.skillPath));
    if (str(config.mode, 'agent') === 'retrieval') {
      const hits = s.index.search(question, topK).filter((h) => h.score > 0);
      return { contexts: hits.map((h) => ({ id: h.chunk.id, source: h.chunk.source, content: h.chunk.content, score: Number(h.score.toFixed(4)) })) };
    }
    const out = await runAgent({
      llm: resolveLlm(config),
      system: skillSystemPrompt(s, str(config.systemPrompt)),
      question,
      tools: skillTools(s, str(config.allowScripts) === 'yes'),
      maxSteps: num(config.maxSteps, 6),
      signal,
    });
    return { answer: out.answer, contexts: out.contexts.slice(0, topK), trace: out.trace };
  },
};
