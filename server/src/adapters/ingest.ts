import type { DatasetDocument, IngestResult } from '../types.js';

/** 逐篇上传文档的通用流程：限制并发、汇总失败原因、汇报进度 */
export async function ingestEach(
  documents: DatasetDocument[],
  opts: { signal?: AbortSignal; onProgress?: (done: number, total: number) => void; concurrency?: number },
  upload: (doc: DatasetDocument) => Promise<void>,
): Promise<IngestResult> {
  return ingestBatches(documents, { ...opts, batchSize: 1 }, async (batch) => upload(batch[0]));
}

export async function ingestBatches(
  documents: DatasetDocument[],
  opts: { signal?: AbortSignal; onProgress?: (done: number, total: number) => void; concurrency?: number; batchSize: number },
  upload: (batch: DatasetDocument[]) => Promise<void>,
): Promise<IngestResult> {
  const batches: DatasetDocument[][] = [];
  for (let i = 0; i < documents.length; i += opts.batchSize) batches.push(documents.slice(i, i + opts.batchSize));
  const result: IngestResult = { uploaded: 0, failed: 0, errors: [] };
  let next = 0;
  let done = 0;
  await Promise.all(
    Array.from({ length: Math.max(1, Math.min(opts.concurrency ?? 3, batches.length)) }, async () => {
      while (next < batches.length && !opts.signal?.aborted) {
        const batch = batches[next++];
        try {
          await upload(batch);
          result.uploaded += batch.length;
        } catch (e) {
          result.failed += batch.length;
          if (result.errors.length < 20) result.errors.push(`${batch[0].title}${batch.length > 1 ? ` 等 ${batch.length} 篇` : ''}：${(e as Error).message}`);
        }
        done += batch.length;
        opts.onProgress?.(done, documents.length);
      }
    }),
  );
  return result;
}
