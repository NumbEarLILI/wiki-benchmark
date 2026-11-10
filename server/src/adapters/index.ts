import type { AdapterDefinition } from '../types.js';
import { mockAdapter } from './mock.js';
import { difyAdapter } from './dify.js';
import { ragflowAdapter } from './ragflow.js';
import { fastgptAdapter } from './fastgpt.js';
import { customHttpAdapter, openaiAdapter } from './custom.js';
import { str } from './http.js';

mockAdapter.resolveCapabilities = (c) => ({ retrieval: true, answer: str(c.answerMode, 'extractive') !== 'none' });
difyAdapter.resolveCapabilities = (c) => ({ retrieval: true, answer: str(c.mode, 'chat') === 'chat' });
ragflowAdapter.resolveCapabilities = (c) => ({ retrieval: true, answer: str(c.mode, 'retrieval') === 'chat' });
fastgptAdapter.resolveCapabilities = (c) => ({ retrieval: true, answer: str(c.mode, 'chat') === 'chat' });
openaiAdapter.resolveCapabilities = (c) => ({ retrieval: !!str(c.contextsPath), answer: true });
customHttpAdapter.resolveCapabilities = (c) => ({ retrieval: !!str(c.contextsPath), answer: !!str(c.answerPath) });

export const adapters: AdapterDefinition[] = [mockAdapter, difyAdapter, ragflowAdapter, fastgptAdapter, openaiAdapter, customHttpAdapter];

export function getAdapter(type: string): AdapterDefinition {
  const a = adapters.find((x) => x.type === type);
  if (!a) throw new Error(`未知的知识库类型: ${type}`);
  return a;
}

export function capabilitiesOf(type: string, config: Record<string, unknown>) {
  const a = getAdapter(type);
  return a.resolveCapabilities?.(config) ?? { retrieval: a.capabilities.includes('retrieval'), answer: a.capabilities.includes('answer') };
}
