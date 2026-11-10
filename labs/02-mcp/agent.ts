import { fileURLToPath } from 'node:url';
import { LlmAgent, MCPToolset } from '@google/adk';

const MODEL = process.env.GEMINI_MODEL ?? 'gemini-3.5-flash-lite';

// ADK starts each server as a child process and discovers its tools.
const mcpServer = (file: string) =>
  new MCPToolset({
    type: 'StdioConnectionParams',
    serverParams: {
      command: 'npx',
      args: ['tsx', fileURLToPath(new URL(file, import.meta.url))],
    },
  });

// Same instruction as 01. Only where the tools live has changed.
export const rootAgent = new LlmAgent({
  name: 'mcp_agent',
  model: MODEL,
  description: 'Answers arithmetic and weather questions using MCP servers.',
  instruction:
    'Use the add tool for any addition and get_weather for any weather question. ' +
    'Never work out sums or guess the weather yourself.',
  tools: [mcpServer('./calculator-server.ts'), mcpServer('./weather-server.ts')],
});
