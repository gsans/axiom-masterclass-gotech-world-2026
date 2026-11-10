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
      a: z.number().describe('The first number.'),
      b: z.number().describe('The second number.'),
    },
  },
  async ({ a, b }) => ({
    content: [{ type: 'text', text: JSON.stringify({ result: a + b }) }],
  }),
);

await server.connect(new StdioServerTransport());
