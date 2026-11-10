import type {
  AdapterInfo,
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
  stats: () => req<{ connectors: number; datasets: number; questions: number; runs: number; running: number }>('GET', '/api/stats'),

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
  createDataset: (d: { name: string; description?: string; items?: Partial<DatasetItem>[] }) => req<Dataset>('POST', '/api/datasets', d),
  updateDataset: (id: string, d: Partial<Dataset>) => req<Dataset>('PUT', `/api/datasets/${id}`, d),
  deleteDataset: (id: string) => req('DELETE', `/api/datasets/${id}`),
  parseDataset: (content: string) => req<{ items: DatasetItem[] }>('POST', '/api/datasets/parse', { content }),

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
  debugEvaluate: (connectorId: string, item: Partial<DatasetItem>, topK: number) =>
    req<ItemResult>('POST', '/api/debug/evaluate', { connectorId, item, topK }),

  leaderboard: (datasetId?: string) => req<LeaderboardEntry[]>('GET', `/api/leaderboard${datasetId ? `?datasetId=${datasetId}` : ''}`),
  settings: () => req<Settings>('GET', '/api/settings'),
  saveSettings: (s: Partial<Settings>) => req<Settings>('PUT', '/api/settings', s),
};
