import { fileURLToPath } from 'node:url';
import { LlmAgent, MCPToolset, SequentialAgent, type SingleAgentCallback } from '@google/adk';

const MODEL = process.env.GEMINI_MODEL ?? 'gemini-3.5-flash-lite';

const mcpServer = (file: string) =>
  new MCPToolset({
    type: 'StdioConnectionParams',
    serverParams: {
      command: 'npx',
      args: ['tsx', fileURLToPath(new URL(file, import.meta.url))],
    },
  });

// A condition in code: returning content skips the agent, and costs no model call.
const skipIfNoData = (message: string): SingleAgentCallback => (context) => {
  const report = context.state.get<string>('weather_report') ?? '';
  if (!report.includes('NO_DATA')) return undefined;
  return { role: 'model', parts: [{ text: message }] };
};

// Step 1: outputKey saves this agent's final answer in session state.
const weatherAgent = new LlmAgent({
  name: 'weather_agent',
  model: MODEL,
  instruction:
    'Call get_weather for every city in the request. ' +
    'Reply with one line per city: city, temperature in C, condition. ' +
    'If a city has no data, write NO_DATA on its line.',
  tools: [mcpServer('./weather-server.ts')],
  outputKey: 'weather_report',
});

// Step 2: {weather_report} is filled in from session state.
const calculatorAgent = new LlmAgent({
  name: 'calculator_agent',
  model: MODEL,
  instruction:
    'Weather report:\n{weather_report}\n\n' +
    'Use the add tool to add the temperatures together, chaining calls if there are ' +
    'more than two cities. Reply with only the total.',
  tools: [mcpServer('./calculator-server.ts')],
  outputKey: 'total_temp',
  beforeAgentCallback: skipIfNoData('Skipped the sum: a city has no weather data.'),
});

// Step 3: no tools, just writes up what the earlier steps produced.
const reporterAgent = new LlmAgent({
  name: 'reporter_agent',
  model: MODEL,
  instruction:
    'Weather report:\n{weather_report}\n\nCombined temperature: {total_temp}\n\n' +
    'Write a two-sentence summary for the user.',
  beforeAgentCallback: skipIfNoData('No summary: I need weather data for every city.'),
});

export const rootAgent = new SequentialAgent({
  name: 'sequential_agent',
  description: 'Looks up weather, adds the temperatures, then writes a summary.',
  subAgents: [weatherAgent, calculatorAgent, reporterAgent],
});
