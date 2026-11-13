import type { AdapterDefinition } from '../types.js';
import { mockAdapter } from './mock.js';
import { difyAdapter } from './dify.js';
import { ragflowAdapter } from './ragflow.js';
import { fastgptAdapter } from './fastgpt.js';
import { customHttpAdapter, openaiAdapter } from './custom.js';
import { mcpAdapter } from './mcp.js';
import { skillAdapter } from './skill.js';
import { localBm25Adapter } from './local-bm25.js';
import { str } from './http.js';
import { ingestWithPlan } from '../prepare.js';
import { ingestSkillDir } from '../dir-ingest.js';

mockAdapter.resolveCapabilities = (c) => ({ retrieval: true, answer: str(c.answerMode, 'extractive') !== 'none' });
difyAdapter.resolveCapabilities = (c) => ({ retrieval: true, answer: str(c.mode, 'chat') === 'chat' });
ragflowAdapter.resolveCapabilities = (c) => ({ retrieval: true, answer: str(c.mode, 'retrieval') === 'chat' });
fastgptAdapter.resolveCapabilities = (c) => ({ retrieval: true, answer: str(c.mode, 'chat') === 'chat' });
openaiAdapter.resolveCapabilities = (c) => ({ retrieval: !!str(c.contextsPath), answer: true });
customHttpAdapter.resolveCapabilities = (c) => ({ retrieval: !!str(c.contextsPath), answer: !!str(c.answerPath) });
mcpAdapter.ingest = (c, docs, opts) => ingestWithPlan('mcp', c, docs, opts);
skillAdapter.ingest = ingestSkillDir;

/** 准备知识库的方式：api 直接调用上传接口；llm 由大模型解析 MCP / Skill 接口生成上传方案；none 无需准备；builtin 内置固定语料；manual 需手动导入 */
export type PrepareMethod = 'api' | 'llm' | 'dir' | 'none' | 'builtin' | 'manual';
const PREPARE: Record<string, PrepareMethod> = { dify: 'api', ragflow: 'api', fastgpt: 'api', mcp: 'llm', skill: 'dir', 'local-bm25': 'none', mock: 'builtin' };
export const prepareMethodOf = (type: string): PrepareMethod => PREPARE[type] ?? 'manual';

export const adapters: AdapterDefinition[] = [
  mockAdapter,
  localBm25Adapter,
  mcpAdapter,
  skillAdapter,
  difyAdapter,
  ragflowAdapter,
  fastgptAdapter,
  openaiAdapter,
  customHttpAdapter,
];

export function getAdapter(type: string): AdapterDefinition {
  const a = adapters.find((x) => x.type === type);
  if (!a) throw new Error(`未知的知识库类型: ${type}`);
  return a;
}

export function capabilitiesOf(type: string, config: Record<string, unknown>) {
  const a = getAdapter(type);
  return a.resolveCapabilities?.(config) ?? { retrieval: a.capabilities.includes('retrieval'), answer: a.capabilities.includes('answer') };
}
