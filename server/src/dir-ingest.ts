import fs from 'node:fs';
import path from 'node:path';
import type { DatasetDocument, IngestResult } from './types.js';
import { str } from './adapters/http.js';
import { invalidateSkillCache, loadSkills } from './adapters/skill.js';
import { docFileName, docMarkdown } from './corpus.js';

/** 记录上次写入的文件，再次导入时只删除这些文件，不动目录里原有的内容 */
const MANIFEST = '.kb-bench-files.json';

/** Skill 默认写入技能的 references/ 目录，Skill 检索与 Agent 读取都能用到 */
export function skillIngestDir(config: Record<string, unknown>): string {
  const chosen = str(config.ingestDir);
  return chosen ? path.resolve(chosen) : path.join(loadSkills(str(config.skillPath)).root, 'references');
}

export function isInside(root: string, p: string) {
  const rel = path.relative(root, p);
  return !rel.startsWith('..') && !path.isAbsolute(rel);
}

function readManifest(dir: string): string[] {
  try {
    const v = JSON.parse(fs.readFileSync(path.join(dir, MANIFEST), 'utf8'));
    return Array.isArray(v) ? v.map((f) => path.basename(String(f))) : [];
  } catch {
    return [];
  }
}

/** 把文档以 `{id}__{标题}.md` 写入目录；replace 时先删除上一批写入的文件 */
export async function writeDocsToDir(
  dir: string,
  documents: DatasetDocument[],
  opts: { signal?: AbortSignal; onProgress?: (done: number, total: number) => void; replace?: boolean } = {},
): Promise<IngestResult> {
  const abs = path.resolve(dir);
  if (fs.existsSync(abs) && !fs.statSync(abs).isDirectory()) throw new Error(`不是目录：${abs}`);
  fs.mkdirSync(abs, { recursive: true });
  const previous = readManifest(abs);
  if (opts.replace !== false) for (const f of previous) fs.rmSync(path.join(abs, f), { force: true });

  const result: IngestResult = { uploaded: 0, failed: 0, errors: [] };
  const written = new Set(opts.replace !== false ? [] : previous);
  for (const [i, doc] of documents.entries()) {
    if (opts.signal?.aborted) break;
    const name = docFileName(doc);
    try {
      await fs.promises.writeFile(path.join(abs, name), docMarkdown(doc));
      written.add(name);
      result.uploaded++;
    } catch (e) {
      result.failed++;
      if (result.errors.length < 20) result.errors.push(`${doc.title}：${(e as Error).message}`);
    }
    if (i % 20 === 19 || i === documents.length - 1) opts.onProgress?.(i + 1, documents.length);
  }
  fs.writeFileSync(path.join(abs, MANIFEST), JSON.stringify([...written], null, 0));
  return result;
}

export async function ingestSkillDir(config: Record<string, unknown>, documents: DatasetDocument[], opts: { signal?: AbortSignal; onProgress?: (done: number, total: number) => void }) {
  const r = await writeDocsToDir(skillIngestDir(config), documents, opts);
  invalidateSkillCache(str(config.skillPath));
  return r;
}
