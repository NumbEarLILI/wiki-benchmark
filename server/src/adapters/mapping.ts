import type { RetrievedContext } from '../types.js';
import { getPath, str } from './http.js';

const CONTENT_KEYS = ['content', 'text', 'page_content', 'pageContent', 'chunk', 'snippet', 'passage', 'body', 'segment', 'value'];
const SOURCE_KEYS = ['source', 'document_name', 'documentName', 'doc_name', 'title', 'file', 'filename', 'file_name', 'sourceName', 'path', 'uri', 'url', 'document'];
const ID_KEYS = ['id', 'chunk_id', 'chunkId', 'segment_id', 'doc_id', 'document_id'];
const SCORE_KEYS = ['score', 'similarity', 'relevance', 'relevance_score', 'distance'];
const LIST_KEYS = ['results', 'chunks', 'documents', 'docs', 'records', 'contexts', 'passages', 'hits', 'items', 'matches', 'references', 'sources', 'data', 'list'];
const ANSWER_KEYS = ['answer', 'response', 'output', 'result', 'reply', 'completion'];

function firstKey(obj: Record<string, unknown>, keys: string[]) {
  for (const k of keys) if (obj[k] !== undefined && obj[k] !== null && obj[k] !== '') return obj[k];
  const meta = obj.metadata ?? obj.meta;
  if (meta && typeof meta === 'object') {
    for (const k of keys) {
      const v = (meta as Record<string, unknown>)[k];
      if (v !== undefined && v !== null && v !== '') return v;
    }
  }
  return undefined;
}

function scalar(v: unknown): string | undefined {
  if (v === undefined || v === null) return undefined;
  if (typeof v === 'object') return str((v as Record<string, unknown>).name ?? (v as Record<string, unknown>).title ?? '') || undefined;
  return String(v);
}

export interface FieldMapping {
  contentField?: string;
  sourceField?: string;
  idField?: string;
  scoreField?: string;
}

/** 把任意列表元素映射成召回片段；未指定字段名时按常见命名自动识别 */
export function toContexts(list: unknown[], m: FieldMapping = {}): RetrievedContext[] {
  return list
    .map((it): RetrievedContext | null => {
      if (it === null || it === undefined) return null;
      if (typeof it !== 'object') return { content: String(it) };
      const o = it as Record<string, unknown>;
      const content = m.contentField ? getPath(o, m.contentField) : firstKey(o, CONTENT_KEYS);
      const source = m.sourceField ? getPath(o, m.sourceField) : firstKey(o, SOURCE_KEYS);
      const id = m.idField ? getPath(o, m.idField) : firstKey(o, ID_KEYS);
      const score = Number(m.scoreField ? getPath(o, m.scoreField) : firstKey(o, SCORE_KEYS));
      return {
        content: typeof content === 'string' ? content : content === undefined ? JSON.stringify(o) : JSON.stringify(content),
        source: scalar(source),
        id: scalar(id),
        score: Number.isFinite(score) ? score : undefined,
      };
    })
    .filter((c): c is RetrievedContext => !!c && !!c.content);
}

export function autoExtract(payload: unknown, m: FieldMapping = {}): { answer?: string; contexts: RetrievedContext[] } {
  if (Array.isArray(payload)) return { contexts: toContexts(payload, m) };
  if (typeof payload === 'string') return { answer: payload, contexts: [] };
  if (!payload || typeof payload !== 'object') return { contexts: [] };
  const o = payload as Record<string, unknown>;
  const ans = firstKey(o, ANSWER_KEYS);
  let list: unknown[] | undefined;
  for (const k of LIST_KEYS) {
    const v = o[k];
    if (Array.isArray(v)) {
      list = v;
      break;
    }
    if (v && typeof v === 'object') {
      const nested = autoExtract(v, m);
      if (nested.contexts.length) return { answer: typeof ans === 'string' ? ans : nested.answer, contexts: nested.contexts };
    }
  }
  return { answer: typeof ans === 'string' ? ans : undefined, contexts: list ? toContexts(list, m) : [] };
}
