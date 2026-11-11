import { newId, now } from './store.js';

export interface Job {
  id: string;
  type: 'benchmark-import' | 'sync';
  title: string;
  status: 'running' | 'done' | 'error';
  progress: number;
  message: string;
  result?: Record<string, unknown>;
  error?: string;
  createdAt: string;
  finishedAt?: string;
}

const jobs = new Map<string, Job>();

export type JobReporter = (progress: number, message: string) => void;

/** 轻量后台任务：导入社区评测集、同步文档到知识库等耗时操作，前端轮询进度 */
export function startJob(type: Job['type'], title: string, fn: (report: JobReporter) => Promise<Record<string, unknown>>): Job {
  const job: Job = { id: newId('job'), type, title, status: 'running', progress: 0, message: '准备中…', createdAt: now() };
  jobs.set(job.id, job);
  const report: JobReporter = (progress, message) => {
    job.progress = Math.max(0, Math.min(1, progress));
    job.message = message;
  };
  fn(report)
    .then((result) => {
      job.status = 'done';
      job.progress = 1;
      job.result = result;
    })
    .catch((e: Error) => {
      job.status = 'error';
      job.error = e.message;
    })
    .finally(() => {
      job.finishedAt = now();
      if (jobs.size > 200) {
        const oldest = [...jobs.values()].filter((j) => j.status !== 'running').slice(0, jobs.size - 200);
        oldest.forEach((j) => jobs.delete(j.id));
      }
    });
  return job;
}

export function getJob(id: string) {
  return jobs.get(id);
}
