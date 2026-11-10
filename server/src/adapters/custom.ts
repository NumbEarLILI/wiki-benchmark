import type { AdapterDefinition, RetrievedContext } from '../types.js';
import { getPath, parseJsonField, requestJson, renderTemplate, str, trimSlash } from './http.js';

export function extractContexts(raw: unknown, config: Record<string, unknown>): RetrievedContext[] {
  const path = str(config.contextsPath);
  if (!path) return [];
  const list = getPath(raw, path);
  if (!Array.isArray(list)) return [];
  const contentField = str(config.contentField, 'content');
  const sourceField = str(config.sourceField);
  const idField = str(config.idField);
  const scoreField = str(config.scoreField);
  return list.map((it) => {
    if (typeof it === 'string') return { content: it };
    const score = scoreField ? Number(getPath(it, scoreField)) : undefined;
    return {
      content: str(getPath(it, contentField)),
      source: sourceField ? str(getPath(it, sourceField)) || undefined : undefined,
      id: idField ? str(getPath(it, idField)) || undefined : undefined,
      score: Number.isFinite(score) ? score : undefined,
    };
  });
}

const mappingFields = [
  { key: 'contextsPath', label: '召回列表路径', type: 'text' as const, placeholder: 'data.chunks[*]', help: '支持 a.b[0].c 与 [*] 语法，留空表示不评估检索' },
  { key: 'contentField', label: '片段内容字段', type: 'text' as const, default: 'content' },
  { key: 'sourceField', label: '片段来源字段', type: 'text' as const, placeholder: 'document_name' },
  { key: 'idField', label: '片段 ID 字段', type: 'text' as const, placeholder: 'id' },
  { key: 'scoreField', label: '相似度字段', type: 'text' as const, placeholder: 'score' },
];

export const customHttpAdapter: AdapterDefinition = {
  type: 'custom-http',
  name: '自定义 HTTP',
  description: '通过请求模板与字段映射对接任意自研知识库服务。模板变量：{{question}}、{{topK}}。',
  capabilities: ['retrieval', 'answer'],
  fields: [
    { key: 'url', label: '请求地址', type: 'text', required: true, placeholder: 'https://kb.example.com/api/search' },
    {
      key: 'method',
      label: '请求方法',
      type: 'select',
      default: 'POST',
      options: [
        { label: 'POST', value: 'POST' },
        { label: 'GET', value: 'GET' },
      ],
    },
    { key: 'headers', label: '请求头 (JSON)', type: 'json', default: '{"Authorization": "Bearer xxx"}' },
    { key: 'bodyTemplate', label: '请求体模板', type: 'textarea', default: '{"query": "{{question}}", "top_k": {{topK}}}' },
    { key: 'answerPath', label: '答案字段路径', type: 'text', placeholder: 'data.answer', help: '留空表示不评估答案' },
    ...mappingFields,
  ],
  async query(config, question, { topK, signal }) {
    const method = str(config.method, 'POST').toUpperCase();
    const vars = { question, topK };
    let url = renderTemplate(str(config.url), vars);
    if (method === 'GET') url = url.replace(/\{\{\s*question\s*\}\}/g, encodeURIComponent(question));
    const raw = await requestJson(url, {
      method,
      signal,
      headers: parseJsonField<Record<string, string>>(config.headers, {}),
      body: method === 'GET' ? undefined : renderTemplate(str(config.bodyTemplate, '{"query": "{{question}}"}'), vars),
    });
    const answerPath = str(config.answerPath);
    return {
      answer: answerPath ? str(getPath(raw, answerPath)) : undefined,
      contexts: extractContexts(raw, config).slice(0, topK),
      raw,
    };
  },
};

export const openaiAdapter: AdapterDefinition = {
  type: 'openai',
  name: 'OpenAI 兼容接口',
  description: '对接任何 OpenAI Chat Completions 兼容的 RAG 服务（如 AnythingLLM、MaxKB、自研网关）。可选配置引用片段的提取路径。',
  capabilities: ['answer', 'retrieval'],
  fields: [
    { key: 'baseUrl', label: 'Base URL', type: 'text', required: true, placeholder: 'https://api.example.com/v1' },
    { key: 'apiKey', label: 'API Key', type: 'password' },
    { key: 'model', label: '模型 / 应用名', type: 'text', required: true, default: 'default' },
    { key: 'systemPrompt', label: '系统提示词', type: 'textarea' },
    { key: 'extraBody', label: '额外请求参数 (JSON)', type: 'json', placeholder: '{"temperature": 0}' },
    ...mappingFields,
  ],
  async query(config, question, { topK, signal }) {
    const messages = [] as { role: string; content: string }[];
    if (str(config.systemPrompt)) messages.push({ role: 'system', content: str(config.systemPrompt) });
    messages.push({ role: 'user', content: question });
    const apiKey = str(config.apiKey);
    const raw = await requestJson(`${trimSlash(config.baseUrl)}/chat/completions`, {
      signal,
      headers: apiKey ? { Authorization: `Bearer ${apiKey}` } : {},
      body: { model: str(config.model, 'default'), messages, stream: false, ...parseJsonField(config.extraBody, {}) },
    });
    return {
      answer: str(raw.choices?.[0]?.message?.content),
      contexts: extractContexts(raw, config).slice(0, topK),
      raw,
    };
  },
};
