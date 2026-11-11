import { FunctionTool, LlmAgent } from '@google/adk';
import { z } from 'zod';

const MODEL = process.env.GEMINI_MODEL ?? 'gemini-3.5-flash-lite';

// Tool 1: a real calculation, so the model doesn't do the arithmetic itself.
const add = new FunctionTool({
  name: 'add',
  description: 'Adds two numbers and returns the sum.',
  parameters: z.object({
    a: z.number().max(1000).describe('The first number, up to 1000.'),
    b: z.number().max(1000).describe('The second number, up to 1000.'),
  }),
  execute: ({ a, b }) => ({ result: a + b }),
});

// Tool 2: a mock. Same answer every time, no API key, no network.
const WEATHER: Record<string, { tempC: number; condition: string }> = {
  london: { tempC: 11, condition: 'cloudy' },
  bucharest: { tempC: 14, condition: 'sunny' },
  paris: { tempC: 13, condition: 'rainy' },
  tokyo: { tempC: 18, condition: 'clear' },
};

const getWeather = new FunctionTool({
  name: 'get_weather',
  description: 'Returns the current weather for a city.',
  parameters: z.object({
    city: z.string().describe('City name, for example "London".'),
    unit: z.enum(['C', 'F']).optional().describe('Temperature unit. Defaults to C.'),
  }),
  execute: ({ city, unit = 'C' }) => {
    const weather = WEATHER[city.toLowerCase()];
    if (!weather) return { error: `No weather data for ${city}.` };
    const temperature = unit === 'F' ? Math.round((weather.tempC * 9) / 5 + 32) : weather.tempC;
    return { temperature, unit, condition: weather.condition };
  },
});

export const rootAgent = new LlmAgent({
  name: 'tools_agent',
  model: MODEL,
  description: 'Answers arithmetic and weather questions using tools.',
  instruction:
    'Use the add tool for any addition and get_weather for any weather question. ' +
    'Never work out sums or guess the weather yourself.',
  tools: [add, getWeather],
});
