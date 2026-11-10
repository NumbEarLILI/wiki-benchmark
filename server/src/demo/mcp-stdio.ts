import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { createDemoMcpServer } from './mcp-server.js';

await createDemoMcpServer().connect(new StdioServerTransport());
