import { tokenize } from './text.js';

export interface IndexedChunk {
  id: string;
  source: string;
  content: string;
}

/** 单字 + 相邻二元组，在无分词词典的情况下兼顾中文短语匹配 */
export function bm25Terms(text: string): string[] {
  const t = tokenize(text);
  const out = [...t];
  for (let i = 0; i < t.length - 1; i++) out.push(t[i] + t[i + 1]);
  return out;
}

export function splitSentences(text: string): string[] {
  // 英文标点需后跟空白才断句，避免把 99.95% 之类的数字切开
  return text.split(/(?<=[。！？；])\s*|(?<=[.!?;])\s+/).map((s) => s.trim()).filter(Boolean);
}

/** 按段落切分，过长段落再按句子合并到 maxLen 左右 */
export function chunkText(text: string, maxLen = 400): string[] {
  const out: string[] = [];
  for (const para of text.split(/\n\s*\n/).map((p) => p.trim()).filter(Boolean)) {
    if (para.length <= maxLen) {
      out.push(para);
      continue;
    }
    let buf = '';
    for (const s of splitSentences(para)) {
      if (buf && buf.length + s.length > maxLen) out.push(buf), (buf = '');
      buf += s;
    }
    if (buf) out.push(buf);
  }
  return out;
}

export class BM25Index<C extends IndexedChunk = IndexedChunk> {
  private postings = new Map<string, [number, number][]>();
  private lengths: number[];
  private avgLen: number;

  constructor(public readonly chunks: C[], textOf: (c: C) => string = (c) => c.content) {
    this.lengths = chunks.map((c, i) => {
      const terms = bm25Terms(textOf(c));
      const tf = new Map<string, number>();
      for (const t of terms) tf.set(t, (tf.get(t) ?? 0) + 1);
      for (const [t, f] of tf) {
        if (!this.postings.has(t)) this.postings.set(t, []);
        this.postings.get(t)!.push([i, f]);
      }
      return terms.length;
    });
    this.avgLen = this.lengths.reduce((s, l) => s + l, 0) / Math.max(1, chunks.length) || 1;
  }

  search(query: string, limit = this.chunks.length): { chunk: C; score: number }[] {
    const n = this.chunks.length;
    const k1 = 1.2;
    const b = 0.75;
    const scores = new Float64Array(n);
    for (const t of new Set(bm25Terms(query))) {
      const list = this.postings.get(t);
      if (!list) continue;
      const idf = Math.log(1 + (n - list.length + 0.5) / (list.length + 0.5));
      for (const [i, f] of list) scores[i] += (idf * f * (k1 + 1)) / (f + k1 * (1 - b + (b * this.lengths[i]) / this.avgLen));
    }
    return Array.from(scores, (score, i) => ({ chunk: this.chunks[i], score }))
      .sort((a, b) => b.score - a.score)
      .slice(0, limit);
  }
}
