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
      unit: z.enum(['C', 'F']).optional().describe('Temperature unit. Defaults to C.'),
    },
  },
  async ({ city, unit = 'C' }) => {
    const weather = WEATHER[city.toLowerCase()];
    if (!weather) {
      return {
        content: [{ type: 'text', text: JSON.stringify({ error: `No weather data for ${city}.` }) }],
        isError: true,
      };
    }
    const temperature = unit === 'F' ? Math.round((weather.tempC * 9) / 5 + 32) : weather.tempC;
    return {
      content: [{ type: 'text', text: JSON.stringify({ temperature, unit, condition: weather.condition }) }],
    };
  },
);

await server.connect(new StdioServerTransport());
