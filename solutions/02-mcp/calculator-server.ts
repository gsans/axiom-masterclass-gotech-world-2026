// MCP server exposing the add tool. It talks over stdin/stdout,
// so never console.log here: use console.error for debugging.
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { z } from 'zod';

const server = new McpServer({ name: 'calculator', version: '1.0.0' });

server.registerTool(
  'add',
  {
    description: 'Adds two numbers and returns the sum.',
    inputSchema: {
      a: z.number().max(1000).describe('The first number, up to 1000.'),
      b: z.number().max(1000).describe('The second number, up to 1000.'),
    },
  },
  async ({ a, b }) => ({
    content: [{ type: 'text', text: JSON.stringify({ result: a + b }) }],
  }),
);

await server.connect(new StdioServerTransport());
