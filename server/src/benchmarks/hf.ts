import { asyncBufferFromUrl, cachedAsyncBuffer, parquetMetadataAsync, parquetReadObjects, type AsyncBuffer, type FileMetaData } from 'hyparquet';
import { db } from '../store.js';

export interface HfSplit {
  dataset: string;
  config: string;
  split: string;
}

const DATASETS_SERVER = 'https://datasets-server.huggingface.co';

function hfEndpoint() {
  return (db.settings.hfEndpoint || 'https://huggingface.co').replace(/\/+$/, '');
}

function authInit(): RequestInit | undefined {
  return db.settings.hfToken ? { headers: { Authorization: `Bearer ${db.settings.hfToken}` } } : undefined;
}

/**
 * 获取某个划分的 Parquet 文件地址：优先查询 datasets-server（支持多文件），
 * 访问不到时按 HF 自动转换分支的约定路径拼接（适用于 hf-mirror 等镜像）。
 */
export async function parquetUrls(s: HfSplit): Promise<string[]> {
  const endpoint = hfEndpoint();
  try {
    const res = await fetch(`${DATASETS_SERVER}/parquet?dataset=${encodeURIComponent(s.dataset)}`, { ...authInit(), signal: AbortSignal.timeout(15_000) });
    if (res.ok) {
      const data = (await res.json()) as { parquet_files?: { config: string; split: string; url: string }[] };
      const urls = (data.parquet_files ?? []).filter((f) => f.config === s.config && f.split === s.split).map((f) => f.url);
      if (urls.length) return urls.map((u) => u.replace(/^https:\/\/huggingface\.co/, endpoint));
    }
  } catch {
    // 回落到约定路径
  }
  return [`${endpoint}/datasets/${s.dataset}/resolve/refs%2Fconvert%2Fparquet/${encodeURIComponent(s.config)}/${encodeURIComponent(s.split)}/0000.parquet`];
}

interface PartFile {
  file: AsyncBuffer;
  metadata: FileMetaData;
  offset: number;
  rows: number;
  groupStarts: number[];
}

export class ParquetTable {
  private constructor(private parts: PartFile[], public readonly numRows: number) {}

  static async open(s: HfSplit): Promise<ParquetTable> {
    const urls = await parquetUrls(s);
    const parts: PartFile[] = [];
    let offset = 0;
    for (const url of urls) {
      let file: AsyncBuffer;
      try {
        file = cachedAsyncBuffer(await asyncBufferFromUrl({ url, requestInit: authInit() }));
      } catch (e) {
        throw new Error(`无法访问 ${s.dataset}（${s.config}/${s.split}）：${(e as Error).message}。如在国内网络环境，可在「评分设置」中把 Hugging Face 地址改为镜像`);
      }
      const metadata = await parquetMetadataAsync(file);
      const groupStarts: number[] = [];
      let acc = 0;
      for (const g of metadata.row_groups) {
        groupStarts.push(acc);
        acc += Number(g.num_rows);
      }
      const rows = Number(metadata.num_rows);
      parts.push({ file, metadata, offset, rows, groupStarts });
      offset += rows;
    }
    return new ParquetTable(parts, offset);
  }

  async readColumns<T = Record<string, unknown>>(columns: string[]): Promise<T[]> {
    const out: T[] = [];
    for (const p of this.parts) out.push(...((await parquetReadObjects({ file: p.file, metadata: p.metadata, columns })) as T[]));
    return out;
  }

  /** 按全局行号读取若干行：按文件 / 行组分组后读取覆盖区间，避免整表下载 */
  async readRows<T = Record<string, unknown>>(indices: number[], columns?: string[], concurrency = 4): Promise<Map<number, T>> {
    const tasks: { part: PartFile; start: number; end: number; wanted: number[] }[] = [];
    const sorted = [...new Set(indices)].filter((i) => i >= 0 && i < this.numRows).sort((a, b) => a - b);
    for (const part of this.parts) {
      const local = sorted.filter((i) => i >= part.offset && i < part.offset + part.rows).map((i) => i - part.offset);
      const byGroup = new Map<number, number[]>();
      for (const i of local) {
        let g = part.groupStarts.length - 1;
        while (g > 0 && part.groupStarts[g] > i) g--;
        if (!byGroup.has(g)) byGroup.set(g, []);
        byGroup.get(g)!.push(i);
      }
      for (const wanted of byGroup.values()) tasks.push({ part, start: wanted[0], end: wanted[wanted.length - 1] + 1, wanted });
    }
    const result = new Map<number, T>();
    let next = 0;
    await Promise.all(
      Array.from({ length: Math.min(concurrency, tasks.length) }, async () => {
        while (next < tasks.length) {
          const t = tasks[next++];
          const rows = (await parquetReadObjects({ file: t.part.file, metadata: t.part.metadata, columns, rowStart: t.start, rowEnd: t.end })) as T[];
          for (const i of t.wanted) result.set(i + t.part.offset, rows[i - t.start]);
        }
      }),
    );
    return result;
  }
}

export function seededRandom(seed: number) {
  let s = seed >>> 0 || 1;
  return () => {
    s = (s + 0x6d2b79f5) >>> 0;
    let t = s;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export function shuffle<T>(arr: T[], rand: () => number): T[] {
  const a = [...arr];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(rand() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

export function cleanText(s: unknown): string {
  return String(s ?? '')
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<\/?(p|div|li|h\d)[^>]*>/gi, '\n')
    .replace(/<[^>]+>/g, '')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/[ \t]+/g, ' ')
    .replace(/\n\s*\n+/g, '\n')
    .trim();
}

export function shortTitle(text: string, max = 30): string {
  const first = text.split('\n').find((l) => l.trim())?.trim() ?? '';
  return first.length > max ? `${first.slice(0, max)}…` : first;
}
