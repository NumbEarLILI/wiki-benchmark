import { useCallback, useEffect, useRef, useState } from 'react';
import type { ItemMetrics, Job, RunStatus } from './types';
import { api } from './api';

export function useAsync<T>(fn: () => Promise<T>, deps: unknown[] = [], pollMs?: number | (() => number | undefined)) {
  const [data, setData] = useState<T>();
  const [error, setError] = useState<string>();
  const [loading, setLoading] = useState(true);
  const fnRef = useRef(fn);
  fnRef.current = fn;

  const reload = useCallback(async () => {
    try {
      setData(await fnRef.current());
      setError(undefined);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    setLoading(true);
    void reload();
  }, deps); // eslint-disable-line react-hooks/exhaustive-deps

  const pollRef = useRef(pollMs);
  pollRef.current = pollMs;
  useEffect(() => {
    if (!pollMs) return;
    let timer: ReturnType<typeof setTimeout>;
    const tick = () => {
      const p = pollRef.current;
      const ms = typeof p === 'function' ? p() : p;
      timer = setTimeout(async () => {
        if (ms) await reload();
        tick();
      }, ms || 1500);
    };
    tick();
    return () => clearTimeout(timer);
  }, [!!pollMs, reload]);

  return { data, error, loading, reload, setData };
}

export type Async<T> = ReturnType<typeof useAsync<T>>;

export const METRICS: { key: keyof ItemMetrics; label: string; group: 'retrieval' | 'answer'; desc: string }[] = [
  { key: 'hit', label: 'Hit@K', group: 'retrieval', desc: '前 K 条召回中至少命中一条相关内容的题目占比' },
  { key: 'recall', label: 'Recall@K', group: 'retrieval', desc: '相关文档（或关键要点）被前 K 条召回覆盖的比例' },
  { key: 'precision', label: 'Precision@K', group: 'retrieval', desc: '召回结果中相关片段的占比' },
  { key: 'mrr', label: 'MRR', group: 'retrieval', desc: '首个相关片段排名的倒数均值，衡量排序质量' },
  { key: 'ndcg', label: 'nDCG@K', group: 'retrieval', desc: '归一化折损累计增益，综合衡量相关片段的位置' },
  { key: 'contextCoverage', label: '上下文要点覆盖', group: 'retrieval', desc: '召回内容覆盖关键要点的比例' },
  { key: 'answerCoverage', label: '答案要点覆盖', group: 'answer', desc: '答案中包含关键要点的比例' },
  { key: 'f1', label: 'Token F1', group: 'answer', desc: '答案与参考答案的词元级 F1（中文按字切分）' },
  { key: 'rougeL', label: 'ROUGE-L', group: 'answer', desc: '基于最长公共子序列的答案相似度' },
  { key: 'judgeCorrectness', label: 'LLM 正确性', group: 'answer', desc: '裁判模型评估答案与参考答案的事实一致性' },
  { key: 'judgeFaithfulness', label: 'LLM 忠实度', group: 'answer', desc: '裁判模型评估答案是否有召回内容作为依据' },
];

export const pct = (v?: number, digits = 1) => (v === undefined || v === null ? '—' : `${(v * 100).toFixed(digits)}%`);
export const score = (v?: number) => (v === undefined || v === null ? '—' : v.toFixed(1));
export const ms = (v?: number) => (v === undefined ? '—' : v >= 1000 ? `${(v / 1000).toFixed(2)}s` : `${Math.round(v)}ms`);

export function fmtTime(iso?: string) {
  if (!iso) return '—';
  return new Date(iso).toLocaleString('zh-CN', { hour12: false, month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' });
}

export function duration(start?: string, end?: string) {
  if (!start) return '—';
  const d = (end ? new Date(end).getTime() : Date.now()) - new Date(start).getTime();
  if (d < 60000) return `${(d / 1000).toFixed(1)}s`;
  return `${Math.floor(d / 60000)}m${Math.round((d % 60000) / 1000)}s`;
}

export const STATUS: Record<RunStatus, { label: string; tone: 'slate' | 'blue' | 'green' | 'red' | 'amber' }> = {
  pending: { label: '排队中', tone: 'slate' },
  running: { label: '运行中', tone: 'blue' },
  done: { label: '已完成', tone: 'green' },
  error: { label: '失败', tone: 'red' },
  cancelled: { label: '已取消', tone: 'amber' },
};

export const PALETTE = ['#4f46e5', '#0ea5e9', '#10b981', '#f59e0b', '#ef4444', '#8b5cf6', '#ec4899', '#14b8a6'];

export function scoreTone(v?: number) {
  if (v === undefined) return 'text-slate-400';
  if (v >= 80) return 'text-emerald-600';
  if (v >= 60) return 'text-amber-600';
  return 'text-rose-600';
}

/** 轮询后台任务直到结束 */
export function useJob(onFinish?: (job: Job) => void) {
  const [job, setJob] = useState<Job>();
  const cb = useRef(onFinish);
  cb.current = onFinish;
  useEffect(() => {
    if (!job || job.status !== 'running') return;
    const t = setTimeout(async () => {
      try {
        const next = await api.job(job.id);
        setJob(next);
        if (next.status !== 'running') cb.current?.(next);
      } catch (e) {
        setJob({ ...job, status: 'error', error: (e as Error).message });
      }
    }, 700);
    return () => clearTimeout(t);
  }, [job]);
  return [job, setJob] as const;
}

export const fmtNum = (n?: number) => (n === undefined ? '—' : n.toLocaleString('en-US'));

export function download(url: string) {
  const a = document.createElement('a');
  a.href = url;
  a.click();
}

export async function readFiles(list: FileList | File[]) {
  return Promise.all([...list].map(async (f) => ({ name: (f as File & { webkitRelativePath?: string }).webkitRelativePath || f.name, content: await f.text() })));
}
