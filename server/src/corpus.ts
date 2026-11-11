import fs from 'node:fs';
import path from 'node:path';
import type { Dataset, DatasetDocument } from './types.js';
import type { DocAliases } from './metrics.js';

/**
 * 文档导出 / 同步到知识库时的文件名：`{id}__{标题}.md`。
 * 知识库返回的来源文件名以文档 ID 开头，评测时据此精确判定命中。
 */
export function docFileName(doc: DatasetDocument, ext = '.md'): string {
  const safe = (s: string) => s.replace(/[\\/:*?"<>|\r\n\t#]+/g, ' ').replace(/\s+/g, ' ').trim();
  const title = safe(doc.title).slice(0, 60);
  const id = safe(doc.id).slice(0, 80);
  return `${title && title !== id ? `${id}__${title}` : id}${ext}`;
}

export function docMarkdown(doc: DatasetDocument): string {
  return `# ${doc.title}\n\n${doc.content.trim()}\n${doc.url ? `\n来源：${doc.url}\n` : ''}`;
}

export function docAliases(documents?: DatasetDocument[]): DocAliases | undefined {
  if (!documents?.length) return undefined;
  return new Map(documents.map((d) => [d.id.toLowerCase(), [d.title, docFileName(d)].filter(Boolean)]));
}

export function corpusKey(ds: Dataset) {
  return `${ds.id}:${ds.updatedAt}:${ds.documents?.length ?? 0}`;
}

function slug(s: string) {
  return s.toLowerCase().replace(/[^a-z0-9\u4e00-\u9fff]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 40) || 'kb';
}

/** 把测评集文档打包为 Agent Skill：SKILL.md + references/ */
export function skillFiles(ds: Dataset): { name: string; content: string }[] {
  const docs = ds.documents ?? [];
  const name = `kb-${slug(ds.source?.name ?? ds.name)}`;
  const index = docs.slice(0, 300).map((d) => `- \`references/${docFileName(d)}\`：${d.title}`).join('\n');
  const skillMd = `---
name: ${name}
description: ${ds.name} 的知识库文档（共 ${docs.length} 篇）。回答与这些文档内容相关的问题时使用。
---

# ${ds.name}

${ds.description ?? ''}

参考资料位于 \`references/\` 目录，每篇文档一个 Markdown 文件，文件名格式为 \`{文档ID}__{标题}.md\`。

## 使用方法

1. 先用 \`search_files\` 检索与问题相关的片段，再用 \`read_file\` 阅读命中的文档全文。
2. 严格依据文档内容作答；文档中没有的信息请说明不知道。

## 文档目录${docs.length > 300 ? '（前 300 篇）' : ''}

${index}
`;
  return [{ name: 'SKILL.md', content: skillMd }, ...docs.map((d) => ({ name: `references/${docFileName(d)}`, content: docMarkdown(d) }))];
}

export function writeSkillDir(ds: Dataset, root: string): string {
  const dir = path.join(root, `kb-${slug(ds.source?.name ?? ds.name)}-${ds.id.slice(-6)}`);
  fs.rmSync(dir, { recursive: true, force: true });
  for (const f of skillFiles(ds)) {
    const full = path.join(dir, f.name);
    fs.mkdirSync(path.dirname(full), { recursive: true });
    fs.writeFileSync(full, f.content);
  }
  return dir;
}
