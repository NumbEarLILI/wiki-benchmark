import type { DatasetDocument, DatasetItem } from '../types.js';
import { normalizeItem, parseCsv } from '../dataset-io.js';
import { cleanText, shortTitle } from './hf.js';

export interface UploadedFile {
  name: string;
  content: string;
}

export interface FileImportResult {
  documents: DatasetDocument[];
  items: DatasetItem[];
  warnings: string[];
}

const DOC_EXT = /\.(md|markdown|txt|html?)$/i;

function stem(name: string) {
  return name.replace(/^.*[\\/]/, '').replace(/\.[^.]+$/, '');
}

function parseRows(text: string): Record<string, any>[] | Record<string, any> {
  const t = text.trim().replace(/^\uFEFF/, '');
  if (t.startsWith('[') || t.startsWith('{')) {
    try {
      return JSON.parse(t);
    } catch {
      return t.split(/\r?\n/).filter((l) => l.trim()).map((l) => JSON.parse(l));
    }
  }
  const [header, ...body] = parseCsv(t);
  return header ? body.map((cells) => Object.fromEntries(header.map((h, i) => [h.trim(), cells[i] ?? '']))) : [];
}

function first(row: Record<string, any>, keys: string[]): unknown {
  for (const k of keys) if (row[k] !== undefined && row[k] !== null && row[k] !== '') return row[k];
  return undefined;
}

function toDoc(row: Record<string, any>, i: number): DatasetDocument | null {
  const content = cleanText(first(row, ['content', 'text', 'body', 'passage', 'context', '内容', '正文']));
  if (!content) return null;
  const id = String(first(row, ['_id', 'id', 'doc_id', 'docid', 'pid', '文档ID']) ?? `doc-${i + 1}`);
  const title = cleanText(first(row, ['title', 'name', '标题'])) || shortTitle(content);
  const url = first(row, ['url', 'link']);
  return { id, title, content, url: url ? String(url) : undefined };
}

const isQuestionRow = (r: Record<string, any>) => first(r, ['question', 'query', 'q', '问题']) !== undefined;
const isDocRow = (r: Record<string, any>) => first(r, ['content', 'text', 'body', 'passage', '内容', '正文']) !== undefined;

function parseQrels(text: string, into: Map<string, Set<string>>) {
  for (const line of text.split(/\r?\n/)) {
    const cols = line.trim().split(/\t|\s+/);
    if (cols.length < 2) continue;
    const [q, d, score] = cols.length >= 4 ? [cols[0], cols[2], cols[3]] : [cols[0], cols[1], cols[2]];
    if (score !== undefined && !/^-?\d+(\.\d+)?$/.test(score)) continue;
    if (score !== undefined && Number(score) <= 0) continue;
    if (!into.has(q)) into.set(q, new Set());
    into.get(q)!.add(d);
  }
}

function squadToData(data: any[], docs: DatasetDocument[], items: DatasetItem[]) {
  for (const article of data) {
    (article.paragraphs ?? []).forEach((p: any, pi: number) => {
      const id = `p${String(docs.length + 1).padStart(5, '0')}`;
      docs.push({ id, title: article.title ? `${article.title} #${pi + 1}` : shortTitle(p.context, 24), content: String(p.context) });
      for (const qa of p.qas ?? []) {
        const answers: string[] = [...new Set<string>((qa.answers ?? []).map((a: any) => String(a.text).trim()).filter(Boolean))];
        if (qa.is_impossible || !answers.length) continue;
        items.push({ id: `q-${qa.id ?? items.length + 1}`, question: String(qa.question).trim(), referenceAnswer: answers[0], relevantDocs: [id], keywords: answers.slice(0, 1) });
      }
    });
  }
}

/**
 * 从上传文件构建测评集，支持：
 * - 本平台导出的 JSON（{ documents, items }）
 * - BEIR 目录结构：corpus.jsonl + queries.jsonl + qrels/*.tsv（或 TREC qrels）
 * - SQuAD / CMRC 格式 JSON（data[].paragraphs[].qas[]）
 * - Markdown / TXT / HTML 文档（每个文件一篇）+ 问题 CSV / JSONL
 */
export function importFiles(files: UploadedFile[]): FileImportResult {
  const documents: DatasetDocument[] = [];
  const items: DatasetItem[] = [];
  const warnings: string[] = [];
  const queries = new Map<string, string>();
  const qrels = new Map<string, Set<string>>();

  for (const f of files) {
    const lower = f.name.toLowerCase();
    try {
      if (DOC_EXT.test(lower) && !/qrels/.test(lower)) {
        const content = /\.html?$/.test(lower) ? cleanText(f.content) : f.content.trim();
        const heading = content.match(/^#\s+(.+)$/m)?.[1]?.trim();
        const s = stem(f.name);
        const [id, title] = s.includes('__') ? [s.split('__')[0], s.split('__').slice(1).join('__')] : [s, heading || s];
        if (content) documents.push({ id, title, content });
        continue;
      }
      if (/qrels/.test(lower) || /\.(tsv|trec)$/.test(lower)) {
        parseQrels(f.content, qrels);
        continue;
      }
      const parsed = parseRows(f.content);
      if (!Array.isArray(parsed)) {
        if (Array.isArray(parsed.documents) || Array.isArray(parsed.items)) {
          (parsed.documents ?? []).forEach((r: any, i: number) => {
            const d = toDoc(r, documents.length + i);
            if (d) documents.push(d);
          });
          for (const r of parsed.items ?? []) {
            const it = normalizeItem(r);
            if (it) items.push(it);
          }
        } else if (Array.isArray(parsed.data)) {
          squadToData(parsed.data, documents, items);
        } else warnings.push(`${f.name}：无法识别的 JSON 结构`);
        continue;
      }
      const isCorpus = /corpus/.test(lower) || (parsed.length > 0 && isDocRow(parsed[0]) && !isQuestionRow(parsed[0]));
      const isQueries = /quer/.test(lower) && !parsed.some(isQuestionRow) && parsed.some((r) => r.text !== undefined);
      if (isQueries) {
        for (const r of parsed) queries.set(String(r._id ?? r.id), cleanText(r.text));
      } else if (isCorpus) {
        parsed.forEach((r, i) => {
          const d = toDoc(r, documents.length + i);
          if (d) documents.push(d);
        });
      } else {
        for (const r of parsed) {
          const it = normalizeItem(r);
          if (it) items.push(it);
        }
      }
    } catch (e) {
      warnings.push(`${f.name}：解析失败（${(e as Error).message}）`);
    }
  }

  for (const [qid, text] of queries) {
    const rel = qrels.get(qid);
    if (!text) continue;
    items.push({ id: `q-${qid}`, question: text, relevantDocs: rel ? [...rel] : undefined });
  }
  if (queries.size && !qrels.size) warnings.push('未提供 qrels 文件，问题没有相关文档标注，只能评估回答');

  const seen = new Set<string>();
  const uniqueDocs = documents.filter((d) => (seen.has(d.id) ? false : (seen.add(d.id), true)));
  if (uniqueDocs.length < documents.length) warnings.push(`有 ${documents.length - uniqueDocs.length} 篇文档 ID 重复，已去重`);
  return { documents: uniqueDocs, items: resolveRelevantDocs(items, uniqueDocs), warnings };
}

/** 问题里的相关文档可能写的是标题或文件名，尽量映射为文档 ID */
export function resolveRelevantDocs(items: DatasetItem[], documents: DatasetDocument[]): DatasetItem[] {
  if (!documents.length) return items;
  const lookup = new Map<string, string>();
  for (const d of documents) {
    lookup.set(d.title.toLowerCase(), d.id);
    lookup.set(stem(d.title).toLowerCase(), d.id);
  }
  for (const d of documents) lookup.set(d.id.toLowerCase(), d.id);
  return items.map((it) => (it.relevantDocs ? { ...it, relevantDocs: it.relevantDocs.map((r) => lookup.get(r.toLowerCase()) ?? lookup.get(stem(r).toLowerCase()) ?? r) } : it));
}
