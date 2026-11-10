export interface FieldDef {
  key: string;
  label: string;
  type: 'text' | 'password' | 'number' | 'select' | 'textarea' | 'json';
  required?: boolean;
  placeholder?: string;
  help?: string;
  default?: string | number;
  options?: { label: string; value: string }[];
  /** 仅当另一字段取指定值时显示，例如只在 stdio 传输下显示启动命令 */
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

export interface RetrievedContext {
  id?: string;
  source?: string;
  content: string;
  score?: number;
}

export interface QueryResult {
  answer?: string;
  contexts: RetrievedContext[];
  /** Agent 类接入（MCP Agent / Skill）的工具调用轨迹 */
  trace?: TraceStep[];
  raw?: unknown;
}

export interface QueryOptions {
  topK: number;
  signal?: AbortSignal;
}

export interface AdapterDefinition {
  type: string;
  name: string;
  description: string;
  /** 能力：retrieval 返回召回片段，answer 返回生成答案 */
  capabilities: ('retrieval' | 'answer')[];
  fields: FieldDef[];
  /** 按具体配置判断实际能力，例如"仅检索"模式不评估答案 */
  resolveCapabilities?(config: Record<string, unknown>): { retrieval: boolean; answer: boolean };
  query(config: Record<string, unknown>, question: string, opts: QueryOptions): Promise<QueryResult>;
}

export interface Connector {
  id: string;
  name: string;
  type: string;
  description?: string;
  config: Record<string, unknown>;
  createdAt: string;
  updatedAt: string;
}

export interface DatasetItem {
  id: string;
  question: string;
  referenceAnswer?: string;
  /** 相关文档标识（文档 ID / 文件名 / 标题），用于检索命中判定 */
  relevantDocs?: string[];
  /** 关键要点，用于答案与召回内容的覆盖率评估 */
  keywords?: string[];
  tags?: string[];
}

export interface Dataset {
  id: string;
  name: string;
  description?: string;
  items: DatasetItem[];
  createdAt: string;
  updatedAt: string;
}

export interface JudgeSettings {
  enabled: boolean;
  baseUrl: string;
  apiKey: string;
  model: string;
}

export interface ScoreWeights {
  retrieval: number;
  answer: number;
  performance: number;
}

export interface LlmSettings {
  baseUrl: string;
  apiKey: string;
  model: string;
}

export interface Settings {
  judge: JudgeSettings;
  /** Agent 模式（MCP Agent / Skill Agent）默认使用的模型，接入配置中未填写时生效 */
  agent: LlmSettings;
  weights: ScoreWeights;
  /** 低于该延迟（毫秒）得满分，超过 latencyMaxMs 得 0 分 */
  latencyTargetMs: number;
  latencyMaxMs: number;
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

export interface RunConnectorSummary {
  connectorId: string;
  connectorName: string;
  connectorType: string;
  status: 'pending' | 'running' | 'done' | 'error' | 'cancelled';
  completed: number;
  metrics?: AggregateMetrics;
}

export interface Run {
  id: string;
  name: string;
  datasetId: string;
  datasetName: string;
  connectorIds: string[];
  params: {
    topK: number;
    concurrency: number;
    timeoutMs: number;
    useJudge: boolean;
    weights: ScoreWeights;
  };
  status: 'pending' | 'running' | 'done' | 'error' | 'cancelled';
  total: number;
  summaries: RunConnectorSummary[];
  results: ItemResult[];
  createdAt: string;
  startedAt?: string;
  finishedAt?: string;
  error?: string;
}
