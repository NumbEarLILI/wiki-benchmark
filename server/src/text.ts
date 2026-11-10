const CJK = /[\u3400-\u9fff\uf900-\ufaff\u3040-\u30ff\uac00-\ud7af]/;

/**
 * 中英混合分词：CJK 字符按单字切分，拉丁字母/数字按单词切分，忽略标点。
 * 不依赖外部分词词典，保证不同知识库之间的评分口径一致。
 */
export function tokenize(text: string): string[] {
  const tokens: string[] = [];
  const lower = (text || '').toLowerCase();
  let buf = '';
  for (const ch of lower) {
    if (CJK.test(ch)) {
      if (buf) tokens.push(buf), (buf = '');
      tokens.push(ch);
    } else if (/[\p{L}\p{N}]/u.test(ch)) {
      buf += ch;
    } else if (buf) {
      tokens.push(buf);
      buf = '';
    }
  }
  if (buf) tokens.push(buf);
  return tokens;
}

export function normalize(text: string): string {
  return (text || '').toLowerCase().replace(/[\s\p{P}\p{S}]+/gu, '');
}

export function containsNormalized(haystack: string, needle: string): boolean {
  const n = normalize(needle);
  return n.length > 0 && normalize(haystack).includes(n);
}

export function tokenF1(prediction: string, reference: string): number {
  const p = tokenize(prediction);
  const r = tokenize(reference);
  if (!p.length || !r.length) return 0;
  const counts = new Map<string, number>();
  for (const t of r) counts.set(t, (counts.get(t) ?? 0) + 1);
  let common = 0;
  for (const t of p) {
    const c = counts.get(t) ?? 0;
    if (c > 0) {
      common++;
      counts.set(t, c - 1);
    }
  }
  if (!common) return 0;
  const precision = common / p.length;
  const recall = common / r.length;
  return (2 * precision * recall) / (precision + recall);
}

export function rougeL(prediction: string, reference: string): number {
  const p = tokenize(prediction);
  const r = tokenize(reference);
  if (!p.length || !r.length) return 0;
  let prev = new Array(r.length + 1).fill(0);
  for (let i = 1; i <= p.length; i++) {
    const cur = new Array(r.length + 1).fill(0);
    for (let j = 1; j <= r.length; j++) {
      cur[j] = p[i - 1] === r[j - 1] ? prev[j - 1] + 1 : Math.max(prev[j], cur[j - 1]);
    }
    prev = cur;
  }
  const lcs = prev[r.length];
  if (!lcs) return 0;
  const precision = lcs / p.length;
  const recall = lcs / r.length;
  return (2 * precision * recall) / (precision + recall);
}

export function keywordCoverage(text: string, keywords: string[]): number {
  if (!keywords.length) return 0;
  return keywords.filter((k) => containsNormalized(text, k)).length / keywords.length;
}
