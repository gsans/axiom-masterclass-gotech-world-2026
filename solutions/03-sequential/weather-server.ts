// MCP server exposing the mock get_weather tool.
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { z } from 'zod';

const WEATHER: Record<string, { tempC: number; condition: string }> = {
  london: { tempC: 11, condition: 'cloudy' },
  bucharest: { tempC: 14, condition: 'sunny' },
  paris: { tempC: 13, condition: 'rainy' },
  tokyo: { tempC: 18, condition: 'clear' },
};

const server = new McpServer({ name: 'weather', version: '1.0.0' });

server.registerTool(
  'get_weather',
  {
    description: 'Returns the current weather for a city.',
    inputSchema: {
      city: z.string().describe('City name, for example "London".'),
    },
  },
  async ({ city }) => {
    const weather = WEATHER[city.toLowerCase()];
    return {
      content: [
        { type: 'text', text: JSON.stringify(weather ?? { error: `No weather data for ${city}.` }) },
      ],
      isError: !weather,
    };
  },
);

await server.connect(new StdioServerTransport());
