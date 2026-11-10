export class HttpError extends Error {
  constructor(public status: number, message: string) {
    super(message);
  }
}

export async function requestJson<T = any>(
  url: string,
  init: { method?: string; headers?: Record<string, string>; body?: unknown; signal?: AbortSignal },
): Promise<T> {
  const res = await fetch(url, {
    method: init.method ?? 'POST',
    headers: { 'Content-Type': 'application/json', Accept: 'application/json', ...init.headers },
    body: init.body === undefined ? undefined : typeof init.body === 'string' ? init.body : JSON.stringify(init.body),
    signal: init.signal,
  });
  const text = await res.text();
  if (!res.ok) throw new HttpError(res.status, `HTTP ${res.status}: ${text.slice(0, 300)}`);
  try {
    return JSON.parse(text) as T;
  } catch {
    throw new Error(`响应不是合法 JSON: ${text.slice(0, 200)}`);
  }
}

export function trimSlash(url: unknown): string {
  return String(url ?? '').trim().replace(/\/+$/, '');
}

export function str(v: unknown, fallback = ''): string {
  return v === undefined || v === null || v === '' ? fallback : String(v);
}

export function num(v: unknown, fallback: number): number {
  const n = Number(v);
  return Number.isFinite(n) && v !== '' && v !== null && v !== undefined ? n : fallback;
}

export function parseJsonField<T>(v: unknown, fallback: T): T {
  if (v === undefined || v === null || v === '') return fallback;
  if (typeof v === 'object') return v as T;
  try {
    return JSON.parse(String(v)) as T;
  } catch {
    throw new Error(`JSON 配置解析失败: ${String(v).slice(0, 80)}`);
  }
}

/**
 * 简易路径取值，支持 `a.b[0].c`、`a.b[*].c`（展开数组）。
 */
export function getPath(obj: unknown, path: string): unknown {
  if (!path) return obj;
  const segs = path.replace(/^\$\.?/, '').match(/[^.[\]]+|\[\*\]|\[\d+\]/g) ?? [];
  let cur: unknown[] = [obj];
  let spread = false;
  for (const seg of segs) {
    const next: unknown[] = [];
    for (const c of cur) {
      if (c === null || c === undefined) continue;
      if (seg === '[*]') {
        spread = true;
        if (Array.isArray(c)) next.push(...c);
      } else if (/^\[\d+\]$/.test(seg)) {
        if (Array.isArray(c)) next.push(c[Number(seg.slice(1, -1))]);
      } else {
        next.push((c as Record<string, unknown>)[seg]);
      }
    }
    cur = next;
  }
  return spread ? cur.filter((v) => v !== undefined) : cur[0];
}

export function renderTemplate(tpl: string, vars: Record<string, string | number>): string {
  return tpl.replace(/\{\{\s*(\w+)\s*\}\}/g, (_, k) => {
    const v = vars[k];
    if (v === undefined) return '';
    // 模板位于 JSON 字符串中，需要转义引号、换行等字符
    return typeof v === 'number' ? String(v) : JSON.stringify(v).slice(1, -1);
  });
}
