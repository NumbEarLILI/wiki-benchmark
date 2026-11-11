import type { AdapterDefinition, RetrievedContext } from '../types.js';
import { num, requestJson, str, trimSlash } from './http.js';
import { docFileName, docMarkdown } from '../corpus.js';
import { ingestEach } from './ingest.js';

function scoreOf(s: unknown): number | undefined {
  if (typeof s === 'number') return s;
  if (Array.isArray(s) && s.length) return Number(s[0]?.value);
  return undefined;
}

function toContext(q: any): RetrievedContext {
  return {
    id: q.id ?? q._id,
    source: q.sourceName,
    content: [q.q, q.a].filter(Boolean).join('\n'),
    score: scoreOf(q.score),
  };
}

export const fastgptAdapter: AdapterDefinition = {
  type: 'fastgpt',
  name: 'FastGPT',
  description: '对接 FastGPT 应用对话 API（detail 模式返回引用）或知识库搜索测试 API。',
  capabilities: ['retrieval', 'answer'],
  fields: [
    { key: 'baseUrl', label: '服务地址', type: 'text', required: true, placeholder: 'https://cloud.fastgpt.cn' },
    { key: 'apiKey', label: 'API Key', type: 'password', required: true, help: '应用模式使用应用专属 Key；搜索模式使用账号 OpenAPI Key' },
    {
      key: 'mode',
      label: '调用模式',
      type: 'select',
      default: 'chat',
      options: [
        { label: '应用对话', value: 'chat' },
        { label: '知识库搜索', value: 'search' },
      ],
    },
    { key: 'datasetId', label: '知识库 ID', type: 'text', help: '搜索模式必填；同步测评集文档时也会导入到这个知识库' },
    {
      key: 'datasetApiKey',
      label: '账号 OpenAPI Key',
      type: 'password',
      help: '用于同步测评集文档（应用专属 Key 无权导入）；搜索模式下留空则使用上面的 API Key',
      showIf: { key: 'mode', values: ['chat'] },
    },
    {
      key: 'searchMode',
      label: '搜索方式',
      type: 'select',
      default: 'mixedRecall',
      options: [
        { label: '混合检索', value: 'mixedRecall' },
        { label: '语义检索', value: 'embedding' },
        { label: '全文检索', value: 'fullTextRecall' },
      ],
      showIf: { key: 'mode', values: ['search'] },
    },
    { key: 'tokenLimit', label: '搜索 Token 上限', type: 'number', default: 5000, showIf: { key: 'mode', values: ['search'] } },
  ],
  async query(config, question, { topK, signal }) {
    const base = trimSlash(config.baseUrl);
    const headers = { Authorization: `Bearer ${str(config.apiKey)}` };

    if (str(config.mode, 'chat') === 'search') {
      if (!config.datasetId) throw new Error('搜索模式需要填写知识库 ID');
      const data = await requestJson(`${base}/api/core/dataset/searchTest`, {
        headers,
        signal,
        body: {
          datasetId: str(config.datasetId),
          text: question,
          limit: num(config.tokenLimit, 5000),
          similarity: 0,
          searchMode: str(config.searchMode, 'mixedRecall'),
          usingReRank: false,
        },
      });
      const list = data.data?.list ?? data.data ?? [];
      return { contexts: list.slice(0, topK).map(toContext), raw: data };
    }

    const data = await requestJson(`${base}/api/v1/chat/completions`, {
      headers,
      signal,
      body: { stream: false, detail: true, messages: [{ role: 'user', content: question }] },
    });
    const nodes: any[] = data.responseData ?? [];
    const quotes = nodes.flatMap((n) => n.quoteList ?? []);
    return {
      answer: data.choices?.[0]?.message?.content ?? '',
      contexts: quotes.slice(0, topK).map(toContext),
      raw: data,
    };
  },
  async ingest(config, documents, opts) {
    const base = trimSlash(config.baseUrl);
    const key = str(config.datasetApiKey) || (str(config.mode, 'chat') === 'search' ? str(config.apiKey) : '');
    if (!config.datasetId) throw new Error('请先在接入配置中填写知识库 ID');
    if (!key) throw new Error('请先在接入配置中填写账号 OpenAPI Key');
    return ingestEach(documents, opts, async (doc) => {
      const data = await requestJson(`${base}/api/core/dataset/collection/create/text`, {
        headers: { Authorization: `Bearer ${key}` },
        signal: opts.signal,
        body: { datasetId: str(config.datasetId), name: docFileName(doc), text: docMarkdown(doc), trainingType: 'chunk' },
      });
      if (data?.code !== undefined && data.code !== 200) throw new Error(data.message ?? `code ${data.code}`);
    });
  },
};
