import type {
  AdapterInfo,
  Benchmark,
  DatasetDocument,
  DocumentListItem,
  FileImportPreview,
  IngestPlan,
  PrepareTestResult,
  Job,
  Connector,
  Dataset,
  DatasetItem,
  DatasetSummary,
  ItemResult,
  LeaderboardEntry,
  McpToolInfo,
  Run,
  ScoreWeights,
  Settings,
  TestResult,
} from './types';

async function req<T>(method: string, url: string, body?: unknown): Promise<T> {
  const res = await fetch(url, {
    method,
    headers: body === undefined ? undefined : { 'Content-Type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || `请求失败 (${res.status})`);
  return data as T;
}

export const api = {
  adapters: () => req<AdapterInfo[]>('GET', '/api/adapters'),
  stats: () => req<{ connectors: number; datasets: number; questions: number; documents: number; runs: number; running: number }>('GET', '/api/stats'),

  connectors: () => req<Connector[]>('GET', '/api/connectors'),
  createConnector: (c: Partial<Connector>) => req<Connector>('POST', '/api/connectors', c),
  updateConnector: (id: string, c: Partial<Connector>) => req<Connector>('PUT', `/api/connectors/${id}`, c),
  deleteConnector: (id: string) => req('DELETE', `/api/connectors/${id}`),
  testConnector: (body: { id?: string; type: string; config: Record<string, unknown>; question: string }) =>
    req<TestResult>('POST', '/api/connectors/test', body),
  mcpTools: (body: { id?: string; config: Record<string, unknown> }) =>
    req<{ ok: boolean; error?: string; tools: McpToolInfo[] }>('POST', '/api/connectors/mcp-tools', body),

  datasets: () => req<DatasetSummary[]>('GET', '/api/datasets'),
  dataset: (id: string) => req<Dataset>('GET', `/api/datasets/${id}`),
  createDataset: (d: { name: string; description?: string; items?: Partial<DatasetItem>[]; documents?: Partial<DatasetDocument>[] }) => req<Dataset>('POST', '/api/datasets', d),
  updateDataset: (id: string, d: Partial<Dataset>) => req<Dataset>('PUT', `/api/datasets/${id}`, d),
  deleteDataset: (id: string) => req('DELETE', `/api/datasets/${id}`),
  parseDataset: (content: string) => req<{ items: DatasetItem[] }>('POST', '/api/datasets/parse', { content }),
  previewFiles: (files: { name: string; content: string }[]) => req<FileImportPreview>('POST', '/api/datasets/import-files', { files, preview: true }),
  importFiles: (body: { name: string; description?: string; files: { name: string; content: string }[] }) => req<Dataset>('POST', '/api/datasets/import-files', body),
  documents: (id: string, params: { q?: string; offset?: number; limit?: number }) =>
    req<{ total: number; documents: DocumentListItem[] }>('GET', `/api/datasets/${id}/documents?${new URLSearchParams(Object.entries(params).filter(([, v]) => v !== undefined && v !== '').map(([k, v]) => [k, String(v)]))}`),
  document: (id: string, docId: string) => req<DatasetDocument>('GET', `/api/datasets/${id}/documents/${encodeURIComponent(docId)}`),
  addDocument: (id: string, doc: Partial<DatasetDocument>) => req<{ added: number; documentCount: number }>('POST', `/api/datasets/${id}/documents`, doc),
  updateDocument: (id: string, docId: string, doc: Partial<DatasetDocument>) => req<DatasetDocument>('PUT', `/api/datasets/${id}/documents/${encodeURIComponent(docId)}`, doc),
  deleteDocument: (id: string, docId: string) => req('DELETE', `/api/datasets/${id}/documents/${encodeURIComponent(docId)}`),
  exportUrl: (id: string, format: 'json' | 'corpus-zip' | 'skill-zip') => `/api/datasets/${id}/export?format=${format}`,
  createSkill: (id: string, body: { createConnector: boolean; mode?: 'retrieval' | 'agent' }) => req<{ path: string; connector?: Connector }>('POST', `/api/datasets/${id}/skill`, body),
  syncDataset: (id: string, body: { connectorId: string; plan?: IngestPlan; skip?: string[] }) => req<Job>('POST', `/api/datasets/${id}/sync`, body),
  preparePlan: (connectorId: string, datasetId?: string) => req<{ plan: IngestPlan; note?: string }>('POST', '/api/prepare/plan', { connectorId, datasetId }),
  prepareTest: (connectorId: string, datasetId: string, plan: IngestPlan) => req<PrepareTestResult>('POST', '/api/prepare/test', { connectorId, datasetId, plan }),

  benchmarks: () => req<Benchmark[]>('GET', '/api/benchmarks'),
  importBenchmark: (body: { benchmarkId: string; queries: number; distractors: number; seed: number; split?: string; name?: string }) => req<Job>('POST', '/api/benchmarks/import', body),
  job: (id: string) => req<Job>('GET', `/api/jobs/${id}`),

  runs: () => req<Run[]>('GET', '/api/runs'),
  run: (id: string) => req<Run>('GET', `/api/runs/${id}`),
  createRun: (body: {
    name?: string;
    datasetId: string;
    connectorIds: string[];
    topK: number;
    concurrency: number;
    timeoutMs: number;
    useJudge: boolean;
    weights?: ScoreWeights;
  }) => req<Run>('POST', '/api/runs', body),
  cancelRun: (id: string) => req('POST', `/api/runs/${id}/cancel`),
  rerun: (id: string) => req<Run>('POST', `/api/runs/${id}/rerun`),
  rescore: (id: string, weights: ScoreWeights) => req<Run>('POST', `/api/runs/${id}/rescore`, { weights }),
  deleteRun: (id: string) => req('DELETE', `/api/runs/${id}`),
  debugEvaluate: (connectorId: string, item: Partial<DatasetItem>, topK: number, datasetId?: string) =>
    req<ItemResult>('POST', '/api/debug/evaluate', { connectorId, item, topK, datasetId }),

  leaderboard: (datasetId?: string) => req<LeaderboardEntry[]>('GET', `/api/leaderboard${datasetId ? `?datasetId=${datasetId}` : ''}`),
  settings: () => req<Settings>('GET', '/api/settings'),
  saveSettings: (s: Partial<Settings>) => req<Settings>('PUT', '/api/settings', s),
};
