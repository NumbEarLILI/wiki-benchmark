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
  /** 测评集的文档集合，供本地检索基线等直接使用语料的接入 */
  documents?: DatasetDocument[];
  /** 文档集合的缓存键（测评集 ID + 更新时间） */
  corpusKey?: string;
}

export interface IngestResult {
  uploaded: number;
  failed: number;
  errors: string[];
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
  /** 把测评集文档导入到该知识库（可选） */
  ingest?(
    config: Record<string, unknown>,
    documents: DatasetDocument[],
    opts: { signal?: AbortSignal; onProgress?: (done: number, total: number) => void },
  ): Promise<IngestResult>;
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

export interface DatasetDocument {
  id: string;
  title: string;
  content: string;
  url?: string;
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
  /** 准备方式说明，如「MCP 工具 add_document（大模型解析）」 */
  detail?: string;
}

export interface DatasetItem {
  id: string;
  question: string;
  referenceAnswer?: string;
  /** 相关文档标识：有文档集合时为文档 ID；否则为文件名 / 标题，用于检索命中判定 */
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
  /** 知识库文档集合：被测知识库需要预先导入这些文档 */
  documents?: DatasetDocument[];
  source?: DatasetSource;
  syncs?: DatasetSyncRecord[];
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
  /** Hugging Face 地址，国内可改为镜像如 https://hf-mirror.com */
  hfEndpoint: string;
  hfToken: string;
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
