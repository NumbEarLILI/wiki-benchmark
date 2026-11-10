import type { AdapterDefinition } from '../types.js';
import { requestJson, str, trimSlash } from './http.js';

export const difyAdapter: AdapterDefinition = {
  type: 'dify',
  name: 'Dify',
  description: '对接 Dify 应用（聊天助手 / Agent）或知识库检索 API。应用模式需在应用中开启「引用和归属」才能返回召回片段。',
  capabilities: ['retrieval', 'answer'],
  fields: [
    { key: 'baseUrl', label: 'API 地址', type: 'text', required: true, default: 'https://api.dify.ai/v1', placeholder: 'https://api.dify.ai/v1' },
    {
      key: 'mode',
      label: '调用模式',
      type: 'select',
      default: 'chat',
      options: [
        { label: '应用对话 (chat-messages)', value: 'chat' },
        { label: '知识库检索 (datasets/retrieve)', value: 'dataset' },
      ],
    },
    { key: 'apiKey', label: 'API Key', type: 'password', required: true, help: '应用模式使用应用 API Key；检索模式使用知识库 API Key' },
    { key: 'datasetId', label: '知识库 ID', type: 'text', help: '仅检索模式需要' },
    {
      key: 'searchMethod',
      label: '检索方式',
      type: 'select',
      default: 'hybrid_search',
      options: [
        { label: '混合检索', value: 'hybrid_search' },
        { label: '向量检索', value: 'semantic_search' },
        { label: '全文检索', value: 'full_text_search' },
      ],
      help: '仅检索模式生效',
    },
  ],
  async query(config, question, { topK, signal }) {
    const base = trimSlash(config.baseUrl);
    const headers = { Authorization: `Bearer ${str(config.apiKey)}` };

    if (str(config.mode, 'chat') === 'dataset') {
      if (!config.datasetId) throw new Error('检索模式需要填写知识库 ID');
      const data = await requestJson(`${base}/datasets/${str(config.datasetId)}/retrieve`, {
        headers,
        signal,
        body: {
          query: question,
          retrieval_model: {
            search_method: str(config.searchMethod, 'hybrid_search'),
            reranking_enable: false,
            top_k: topK,
            score_threshold_enabled: false,
          },
        },
      });
      return {
        contexts: (data.records ?? []).map((r: any) => ({
          id: r.segment?.id,
          source: r.segment?.document?.name,
          content: r.segment?.content ?? '',
          score: r.score,
        })),
        raw: data,
      };
    }

    const data = await requestJson(`${base}/chat-messages`, {
      headers,
      signal,
      body: { inputs: {}, query: question, response_mode: 'blocking', user: 'kb-benchmark' },
    });
    const resources = data.metadata?.retriever_resources ?? [];
    return {
      answer: data.answer ?? '',
      contexts: resources.slice(0, topK).map((r: any) => ({
        id: r.segment_id ?? r.document_id,
        source: r.document_name,
        content: r.content ?? '',
        score: r.score,
      })),
      raw: data,
    };
  },
};
