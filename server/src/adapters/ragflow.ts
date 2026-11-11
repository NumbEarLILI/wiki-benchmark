import type { AdapterDefinition } from '../types.js';
import { HttpError, num, requestJson, str, trimSlash } from './http.js';
import { docFileName, docMarkdown } from '../corpus.js';
import { ingestBatches } from './ingest.js';

function check(data: any) {
  if (data?.code !== undefined && data.code !== 0) throw new Error(`RAGFlow 错误 ${data.code}: ${data.message ?? ''}`);
  return data;
}

export const ragflowAdapter: AdapterDefinition = {
  type: 'ragflow',
  name: 'RAGFlow',
  description: '对接 RAGFlow 的检索 API（/api/v1/retrieval）或聊天助手 API（/api/v1/chats/{id}/completions）。',
  capabilities: ['retrieval', 'answer'],
  fields: [
    { key: 'baseUrl', label: '服务地址', type: 'text', required: true, placeholder: 'http://localhost:9380' },
    { key: 'apiKey', label: 'API Key', type: 'password', required: true },
    {
      key: 'mode',
      label: '调用模式',
      type: 'select',
      default: 'retrieval',
      options: [
        { label: '仅检索', value: 'retrieval' },
        { label: '聊天助手（检索 + 生成）', value: 'chat' },
      ],
    },
    { key: 'datasetIds', label: '知识库 ID', type: 'text', help: '检索模式必填，多个用逗号分隔；同步测评集文档时导入到第一个知识库' },
    { key: 'chatId', label: '聊天助手 ID', type: 'text', help: '聊天模式必填', showIf: { key: 'mode', values: ['chat'] } },
    { key: 'similarityThreshold', label: '相似度阈值', type: 'number', default: 0.2, showIf: { key: 'mode', values: ['retrieval'] } },
    { key: 'vectorWeight', label: '向量相似度权重', type: 'number', default: 0.3, showIf: { key: 'mode', values: ['retrieval'] } },
  ],
  async query(config, question, { topK, signal }) {
    const base = trimSlash(config.baseUrl);
    const headers = { Authorization: `Bearer ${str(config.apiKey)}` };

    if (str(config.mode, 'retrieval') === 'chat') {
      if (!config.chatId) throw new Error('聊天模式需要填写聊天助手 ID');
      const data = check(
        await requestJson(`${base}/api/v1/chats/${str(config.chatId)}/completions`, {
          headers,
          signal,
          body: { question, stream: false },
        }),
      );
      const chunks = data.data?.reference?.chunks ?? [];
      return {
        answer: (data.data?.answer ?? '').replace(/\s*##\d+\$\$/g, ''),
        contexts: chunks.slice(0, topK).map((c: any) => ({
          id: c.id ?? c.chunk_id,
          source: c.document_name ?? c.doc_name ?? c.document_keyword,
          content: c.content ?? c.content_with_weight ?? '',
          score: c.similarity,
        })),
        raw: data,
      };
    }

    const datasetIds = str(config.datasetIds).split(/[,，\s]+/).filter(Boolean);
    if (!datasetIds.length) throw new Error('检索模式需要填写知识库 ID');
    const data = check(
      await requestJson(`${base}/api/v1/retrieval`, {
        headers,
        signal,
        body: {
          question,
          dataset_ids: datasetIds,
          page: 1,
          page_size: topK,
          similarity_threshold: num(config.similarityThreshold, 0.2),
          vector_similarity_weight: num(config.vectorWeight, 0.3),
        },
      }),
    );
    return {
      contexts: (data.data?.chunks ?? []).slice(0, topK).map((c: any) => ({
        id: c.id,
        source: c.document_keyword ?? c.docnm_kwd ?? c.document_id,
        content: c.content ?? '',
        score: c.similarity,
      })),
      raw: data,
    };
  },
  async ingest(config, documents, opts) {
    const base = trimSlash(config.baseUrl);
    const headers = { Authorization: `Bearer ${str(config.apiKey)}` };
    const datasetId = str(config.datasetIds).split(/[,，\s]+/).filter(Boolean)[0];
    if (!datasetId) throw new Error('请先在接入配置中填写知识库 ID');
    return ingestBatches(documents, { ...opts, batchSize: 20, concurrency: 2 }, async (batch) => {
      const form = new FormData();
      for (const doc of batch) form.append('file', new Blob([docMarkdown(doc)], { type: 'text/markdown' }), docFileName(doc));
      const res = await fetch(`${base}/api/v1/datasets/${datasetId}/documents`, { method: 'POST', headers, body: form, signal: opts.signal });
      const text = await res.text();
      if (!res.ok) throw new HttpError(res.status, `HTTP ${res.status}: ${text.slice(0, 200)}`);
      const ids = (check(JSON.parse(text)).data ?? []).map((d: any) => d.id).filter(Boolean);
      if (ids.length) {
        check(await requestJson(`${base}/api/v1/datasets/${datasetId}/chunks`, { headers, signal: opts.signal, body: { document_ids: ids } }));
      }
    });
  },
};
