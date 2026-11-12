import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { loadSkills } from './adapters/skill.js';

export interface BrowseEntry {
  name: string;
  path: string;
  dir: boolean;
  /** 目录中直接包含 SKILL.md */
  skill?: boolean;
}

const SKIP = new Set(['node_modules', '.git', '__pycache__', '.venv', 'venv']);
const MAX_ENTRIES = 1000;

const hasSkillMd = (dir: string) => {
  try {
    return fs.readdirSync(dir).some((n) => n.toUpperCase() === 'SKILL.MD');
  } catch {
    return false;
  }
};

/** Windows 下列出存在的盘符，其它系统只有根目录 */
function roots(): string[] {
  if (process.platform !== 'win32') return ['/'];
  return 'CDEFGHIJKLMNOPQRSTUVWXYZ'.split('').map((l) => `${l}:\\`).filter((r) => fs.existsSync(r));
}

/** 浏览服务端目录，用于在网页上选择技能路径等本地路径 */
export function browseDir(p: string | undefined, opts: { files?: boolean; shortcuts: { label: string; path: string }[] }) {
  let abs = path.resolve(p?.trim() || opts.shortcuts[0]?.path || os.homedir());
  while (!fs.existsSync(abs) && path.dirname(abs) !== abs) abs = path.dirname(abs);
  if (fs.statSync(abs).isFile()) abs = path.dirname(abs);

  const entries: BrowseEntry[] = [];
  let error: string | undefined;
  try {
    for (const ent of fs.readdirSync(abs, { withFileTypes: true })) {
      if (ent.name.startsWith('.') || SKIP.has(ent.name)) continue;
      const full = path.join(abs, ent.name);
      let dir = ent.isDirectory();
      if (ent.isSymbolicLink()) {
        try {
          dir = fs.statSync(full).isDirectory();
        } catch {
          continue;
        }
      }
      if (!dir && !opts.files) continue;
      entries.push({ name: ent.name, path: full, dir, ...(dir && hasSkillMd(full) ? { skill: true } : {}) });
      if (entries.length >= MAX_ENTRIES) break;
    }
  } catch (e) {
    error = `无法读取目录：${(e as Error).message}`;
  }
  entries.sort((a, b) => Number(b.dir) - Number(a.dir) || a.name.localeCompare(b.name));

  const parent = path.dirname(abs);
  return {
    path: abs,
    parent: parent === abs ? null : parent,
    sep: path.sep,
    skill: hasSkillMd(abs),
    entries,
    error,
    roots: roots(),
    shortcuts: opts.shortcuts.filter((s) => fs.existsSync(s.path)),
  };
}

const SCRIPT_EXT = new Set(['.py', '.js', '.mjs', '.cjs', '.ts', '.sh', '.bash', '.rb', '.php', '.pl']);

/** 技能目录内的子目录与可执行脚本（相对技能根目录），供上传方案选择 */
export function skillTree(skillPath: string) {
  const s = loadSkills(skillPath);
  const dirs = new Set<string>();
  for (const f of s.files) {
    const parts = f.split('/').slice(0, -1);
    for (let i = 1; i <= parts.length; i++) dirs.add(parts.slice(0, i).join('/'));
  }
  const listed = [...dirs].filter((d) => !d.split('/').includes('kb-bench')).sort();
  const scripts = s.files.filter((f) => SCRIPT_EXT.has(path.extname(f).toLowerCase())).sort();
  return { root: s.root, skills: s.skills.map((k) => ({ name: k.name, dir: k.dir })), dirs: listed, scripts };
}
