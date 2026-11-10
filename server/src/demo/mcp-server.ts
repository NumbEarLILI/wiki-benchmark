import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';
import type { Request, Response } from 'express';
import { z } from 'zod';
import { demoDocs } from '../seed.js';
import { demoIndex } from '../adapters/mock.js';

/** 演示用 MCP 知识库服务：把内置的星云云文档以 MCP 工具的形式暴露出来 */
export function createDemoMcpServer() {
  const server = new McpServer({ name: 'star-cloud-kb', version: '0.1.0' });

  server.registerTool(
    'search_knowledge_base',
    {
      description: '在星云云产品文档知识库中检索与问题相关的片段。',
      inputSchema: {
        query: z.string().describe('检索问题或关键词'),
        top_k: z.number().int().min(1).max(20).optional().describe('返回条数，默认 5'),
      },
    },
    async ({ query, top_k }) => {
      const results = demoIndex.search(query, top_k ?? 5).map((h) => ({
        id: h.chunk.id,
        title: h.chunk.source,
        content: h.chunk.content,
        score: Number(h.score.toFixed(4)),
      }));
      return { content: [{ type: 'text', text: JSON.stringify({ results }) }] };
    },
  );

  server.registerTool(
    'get_document',
    {
      description: '按文档 ID 或标题获取完整文档内容。',
      inputSchema: { doc: z.string().describe('文档 ID（如 doc-refund）或标题（如 退款政策.md）') },
    },
    async ({ doc }) => {
      const d = demoDocs.find((x) => x.id === doc || x.title === doc || x.title.replace(/\.md$/, '') === doc);
      if (!d) return { isError: true, content: [{ type: 'text', text: `文档不存在：${doc}` }] };
      return { content: [{ type: 'resource', resource: { uri: `kb://star-cloud/${d.title}`, mimeType: 'text/markdown', text: d.content } }] };
    },
  );

  server.registerTool('list_documents', { description: '列出知识库中的全部文档。' }, async () => ({
    content: [{ type: 'text', text: demoDocs.map((d) => `${d.id}\t${d.title}`).join('\n') }],
  }));

  return server;
}

/** 无状态 Streamable HTTP：每个请求创建独立的 server/transport 实例 */
export async function handleDemoMcp(req: Request, res: Response) {
  if (req.method !== 'POST') {
    res.status(405).json({ jsonrpc: '2.0', error: { code: -32000, message: 'Method not allowed' }, id: null });
    return;
  }
  const server = createDemoMcpServer();
  const transport = new StreamableHTTPServerTransport({ sessionIdGenerator: undefined, enableJsonResponse: true });
  res.on('close', () => {
    void transport.close();
    void server.close();
  });
  await server.connect(transport);
  await transport.handleRequest(req, res, req.body);
}
