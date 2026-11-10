// Mock search engine as an MCP server. Results are canned, so runs are repeatable.
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { z } from 'zod';

const PAGES = [
  { url: 'mock://mcp/overview', title: 'What is MCP?', text: 'The Model Context Protocol (MCP) is an open standard for connecting AI applications to tools and data. A client connects to servers that expose tools, resources and prompts.' },
  { url: 'mock://mcp/transports', title: 'MCP transports', text: 'MCP messages use JSON-RPC. Local servers commonly use stdio, and remote servers commonly use Streamable HTTP.' },
  { url: 'mock://a2a/overview', title: 'What is A2A?', text: 'The Agent2Agent (A2A) protocol lets independent agents communicate and delegate work to each other across vendors and frameworks.' },
  { url: 'mock://a2a/agent-cards', title: 'A2A Agent Cards', text: 'An A2A Agent Card is a JSON document describing what an agent can do and how to reach it, which lets clients discover agents.' },
  { url: 'mock://compare/mcp-vs-a2a', title: 'MCP and A2A compared', text: 'MCP connects an agent to its tools, while A2A connects an agent to other agents. The two are complementary, and one system can use both.' },
  { url: 'mock://adk/overview', title: 'Agent Development Kit', text: 'The Agent Development Kit (ADK) is a code-first framework for building agents, with workflow agents for sequential, parallel and loop orchestration.' },
];

const STOP_WORDS = new Set(['the', 'and', 'for', 'what', 'how', 'are', 'with', 'between', 'does']);

function search(query: string) {
  const words = query.toLowerCase().split(/\W+/).filter((w) => w.length > 2 && !STOP_WORDS.has(w));
  return PAGES
    .map((page) => ({
      page,
      score: words.filter((w) => `${page.title} ${page.text}`.toLowerCase().includes(w)).length,
    }))
    .filter((r) => r.score > 0)
    .sort((a, b) => b.score - a.score)
    .slice(0, 3)
    .map((r) => r.page);
}

const server = new McpServer({ name: 'mock-search', version: '1.0.0' });

server.registerTool(
  'web_search',
  {
    description: 'Searches the web and returns up to 3 pages with url, title and text.',
    inputSchema: { query: z.string().min(1).describe('The search query.') },
  },
  async ({ query }) => ({
    content: [{ type: 'text', text: JSON.stringify({ query, results: search(query) }) }],
  }),
);

await server.connect(new StdioServerTransport());
