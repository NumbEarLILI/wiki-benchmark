export interface FieldDef {
  key: string;
  label: string;
  type: 'text' | 'password' | 'number' | 'select' | 'textarea' | 'json';
  required?: boolean;
  placeholder?: string;
  help?: string;
  default?: string | number;
  options?: { label: string; value: string }[];
  showIf?: { key: string; values: string[] };
}

export interface TraceStep {
  type: 'tool' | 'llm';
  name: string;
  args?: unknown;
  output?: string;
  latencyMs: number;
  error?: string;
}

export interface McpToolInfo {
  name: string;
  description?: string;
  inputSchema?: Record<string, unknown>;
  suggestedArgs: string;
}

export interface AdapterInfo {
  type: string;
  name: string;
  description: string;
  capabilities: ('retrieval' | 'answer')[];
  fields: FieldDef[];
}

export interface Connector {
  id: string;
  name: string;
  type: string;
  description?: string;
  config: Record<string, unknown>;
  capabilities: { retrieval: boolean; answer: boolean };
  createdAt: string;
  updatedAt: string;
}

export interface RetrievedContext {
  id?: string;
  source?: string;
  content: string;
  score?: number;
}

export interface DatasetItem {
  id: string;
  question: string;
  referenceAnswer?: string;
  relevantDocs?: string[];
  keywords?: string[];
  tags?: string[];
}

export interface DatasetSummary {
  id: string;
  name: string;
  description?: string;
  itemCount: number;
  withAnswer: number;
  withDocs: number;
  withKeywords: number;
  createdAt: string;
  updatedAt: string;
}

export interface Dataset extends Omit<DatasetSummary, 'itemCount' | 'withAnswer' | 'withDocs' | 'withKeywords'> {
  items: DatasetItem[];
}

export interface ItemMetrics {
  hit?: number;
  recall?: number;
  precision?: number;
  mrr?: number;
  ndcg?: number;
  contextCoverage?: number;
  answerCoverage?: number;
  f1?: number;
  rougeL?: number;
  judgeCorrectness?: number;
  judgeFaithfulness?: number;
}

export interface AggregateMetrics extends ItemMetrics {
  total: number;
  success: number;
  successRate: number;
  latencyAvg: number;
  latencyP50: number;
  latencyP95: number;
  retrievalScore?: number;
  answerScore?: number;
  performanceScore: number;
  overallScore: number;
}

export interface ItemResult {
  itemId: string;
  connectorId: string;
  question: string;
  status: 'ok' | 'error';
  error?: string;
  latencyMs: number;
  answer?: string;
  contexts: RetrievedContext[];
  relevantFlags: boolean[];
  metrics: ItemMetrics;
  judgeReason?: string;
  trace?: TraceStep[];
}

export type RunStatus = 'pending' | 'running' | 'done' | 'error' | 'cancelled';

export interface ScoreWeights {
  retrieval: number;
  answer: number;
  performance: number;
}

export interface RunSummary {
  connectorId: string;
  connectorName: string;
  connectorType: string;
  status: RunStatus;
  completed: number;
  metrics?: AggregateMetrics;
}

export interface Run {
  id: string;
  name: string;
  datasetId: string;
  datasetName: string;
  connectorIds: string[];
  params: { topK: number; concurrency: number; timeoutMs: number; useJudge: boolean; weights: ScoreWeights };
  status: RunStatus;
  total: number;
  summaries: RunSummary[];
  results?: ItemResult[];
  createdAt: string;
  startedAt?: string;
  finishedAt?: string;
  error?: string;
}

export interface LeaderboardEntry {
  connectorId: string;
  connectorName: string;
  connectorType: string;
  datasetId: string;
  datasetName: string;
  runId: string;
  runAt: string;
  topK: number;
  metrics: AggregateMetrics;
}

export interface Settings {
  judge: { enabled: boolean; baseUrl: string; apiKey: string; model: string };
  agent: { baseUrl: string; apiKey: string; model: string };
  weights: ScoreWeights;
  latencyTargetMs: number;
  latencyMaxMs: number;
}

export interface TestResult {
  ok: boolean;
  latencyMs: number;
  error?: string;
  answer?: string;
  contexts?: RetrievedContext[];
  trace?: TraceStep[];
  raw?: unknown;
}
