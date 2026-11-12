export interface FieldDef {
  key: string;
  label: string;
  type: 'text' | 'password' | 'number' | 'select' | 'textarea' | 'json';
  required?: boolean;
  placeholder?: string;
  help?: string;
  default?: string | number;
  options?: { label: string; value: string }[];
  /** 文本框旁提供服务端目录浏览按钮 */
  browse?: 'dir' | 'file';
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
  ingest: boolean;
  prepare: PrepareMethod;
}

export type PrepareMethod = 'api' | 'llm' | 'none' | 'builtin' | 'manual';

export interface IngestPlan {
  kind: 'mcp-tool' | 'skill-script' | 'skill-files';
  toolName?: string;
  script?: string;
  argsTemplate?: string;
  stdinTemplate?: string;
  dir?: string;
  finalize?: { toolName: string; argsTemplate: string };
  reasoning: string;
  source: 'llm' | 'heuristic' | 'manual';
}

export interface SkillTree {
  root: string;
  skills: { name: string; dir: string }[];
  dirs: string[];
  scripts: string[];
}

export interface BrowseEntry {
  name: string;
  path: string;
  dir: boolean;
  skill?: boolean;
}

export interface BrowseResult {
  path: string;
  parent: string | null;
  sep: string;
  skill: boolean;
  entries: BrowseEntry[];
  error?: string;
  roots: string[];
  shortcuts: { label: string; path: string }[];
}

export interface PrepareTestResult {
  ok: boolean;
  docId: string;
  fileName?: string;
  output?: string;
  error?: string;
  latencyMs: number;
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

export interface DatasetDocument {
  id: string;
  title: string;
  content: string;
  url?: string;
}

export interface DocumentListItem {
  id: string;
  title: string;
  url?: string;
  length: number;
  preview: string;
  referenced: boolean;
}

export interface DatasetSource {
  benchmarkId?: string;
  name: string;
  url?: string;
  license?: string;
  split?: string;
  sampling?: { queries: number; distractors: number; seed: number };
}

export interface DatasetSyncRecord {
  connectorId: string;
  connectorName: string;
  at: string;
  uploaded: number;
  failed: number;
  detail?: string;
}

export interface DatasetSummary {
  id: string;
  name: string;
  description?: string;
  source?: DatasetSource;
  syncs?: DatasetSyncRecord[];
  itemCount: number;
  documentCount: number;
  withAnswer: number;
  withDocs: number;
  withKeywords: number;
  createdAt: string;
  updatedAt: string;
}

export interface Dataset extends Omit<DatasetSummary, 'itemCount' | 'withAnswer' | 'withDocs' | 'withKeywords'> {
  items: DatasetItem[];
  /** 问题所引用文档的 ID → 标题 */
  docTitles: Record<string, string>;
}

export interface Benchmark {
  id: string;
  name: string;
  org: string;
  lang: 'zh' | 'en';
  domain: string;
  task: string;
  description: string;
  homepage: string;
  license: string;
  stats: { documents: number; questions: number };
  hasAnswers: boolean;
  defaults: { queries: number; distractors: number };
  format: 'beir' | 'squad' | 'multihop-rag';
  hfDataset: string;
  splits?: string[];
  imported: { id: string; name: string }[];
}

export interface Job {
  id: string;
  type: 'benchmark-import' | 'sync';
  title: string;
  status: 'running' | 'done' | 'error';
  progress: number;
  message: string;
  result?: Record<string, any>;
  error?: string;
}

export interface FileImportPreview {
  documents: number;
  items: number;
  linked: number;
  warnings: string[];
  sampleItems: DatasetItem[];
  sampleDocuments: { id: string; title: string; length: number }[];
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
  hfEndpoint: string;
  hfToken: string;
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
