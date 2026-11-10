import type { DatasetItem } from './types.js';
import { newId } from './store.js';

const FIELD_ALIASES: Record<keyof Omit<DatasetItem, 'id'>, string[]> = {
  question: ['question', 'query', 'q', '问题'],
  referenceAnswer: ['referenceAnswer', 'reference_answer', 'answer', 'ground_truth', 'a', '参考答案', '答案'],
  relevantDocs: ['relevantDocs', 'relevant_docs', 'docs', 'sources', 'source', '相关文档', '来源'],
  keywords: ['keywords', 'key_points', 'keypoints', '关键词', '要点'],
  tags: ['tags', 'tag', 'category', '标签', '分类'],
};

function pick(row: Record<string, unknown>, keys: string[]): unknown {
  for (const k of keys) {
    const hit = Object.keys(row).find((rk) => rk.trim().toLowerCase() === k.toLowerCase());
    if (hit !== undefined && row[hit] !== undefined && row[hit] !== '') return row[hit];
  }
  return undefined;
}

function toList(v: unknown): string[] | undefined {
  if (v === undefined || v === null || v === '') return undefined;
  if (Array.isArray(v)) return v.map(String).map((s) => s.trim()).filter(Boolean);
  const list = String(v).split(/[|;；,，\n]+/).map((s) => s.trim()).filter(Boolean);
  return list.length ? list : undefined;
}

export function normalizeItem(row: Record<string, unknown>): DatasetItem | null {
  const question = String(pick(row, FIELD_ALIASES.question) ?? '').trim();
  if (!question) return null;
  const ref = pick(row, FIELD_ALIASES.referenceAnswer);
  return {
    id: typeof row.id === 'string' && row.id ? row.id : newId('q'),
    question,
    referenceAnswer: ref === undefined ? undefined : String(ref).trim(),
    relevantDocs: toList(pick(row, FIELD_ALIASES.relevantDocs)),
    keywords: toList(pick(row, FIELD_ALIASES.keywords)),
    tags: toList(pick(row, FIELD_ALIASES.tags)),
  };
}

export function parseCsv(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let cell = '';
  let quoted = false;
  const src = text.replace(/^\uFEFF/, '');
  for (let i = 0; i < src.length; i++) {
    const ch = src[i];
    if (quoted) {
      if (ch === '"' && src[i + 1] === '"') cell += '"', i++;
      else if (ch === '"') quoted = false;
      else cell += ch;
    } else if (ch === '"') quoted = true;
    else if (ch === ',') row.push(cell), (cell = '');
    else if (ch === '\n' || ch === '\r') {
      if (ch === '\r' && src[i + 1] === '\n') i++;
      row.push(cell);
      if (row.some((c) => c !== '')) rows.push(row);
      row = [];
      cell = '';
    } else cell += ch;
  }
  row.push(cell);
  if (row.some((c) => c !== '')) rows.push(row);
  return rows;
}

/** 支持 JSON 数组、JSONL、CSV（首行为表头），字段名兼容常见别名 */
export function parseDatasetText(text: string): DatasetItem[] {
  const trimmed = text.trim();
  let rows: Record<string, unknown>[];
  let whole: unknown;
  if (trimmed.startsWith('[') || trimmed.startsWith('{')) {
    try {
      whole = JSON.parse(trimmed);
    } catch {
      whole = undefined;
    }
  }
  if (whole !== undefined) {
    const w = whole as any;
    rows = Array.isArray(w) ? w : Array.isArray(w.items) ? w.items : [w];
  } else if (trimmed.startsWith('{')) {
    rows = trimmed.split(/\r?\n/).filter((l) => l.trim()).map((l) => JSON.parse(l));
  } else {
    const [header, ...body] = parseCsv(trimmed);
    if (!header) return [];
    rows = body.map((cells) => Object.fromEntries(header.map((h, i) => [h.trim(), cells[i] ?? ''])));
  }
  return rows.map(normalizeItem).filter((x): x is DatasetItem => x !== null);
}
