import { fileURLToPath } from 'node:url';
import { LlmAgent, MCPToolset, SequentialAgent } from '@google/adk';

const MODEL = process.env.GEMINI_MODEL ?? 'gemini-3.5-flash-lite';

const searchTools = new MCPToolset({
  type: 'StdioConnectionParams',
  serverParams: {
    command: 'npx',
    args: ['tsx', fileURLToPath(new URL('./search-server.ts', import.meta.url))],
  },
});

const plannerAgent = new LlmAgent({
  name: 'planner_agent',
  model: MODEL,
  instruction:
    'You plan research. Turn the question into exactly 3 short web search queries, ' +
    'as a numbered list. Do not answer the question.',
  outputKey: 'research_plan',
});

const researcherAgent = new LlmAgent({
  name: 'researcher_agent',
  model: MODEL,
  instruction:
    'Research plan:\n{research_plan}\n\n' +
    'Call web_search once for each query, with max_results set to 2. Then write bullet-point notes using only ' +
    'the search results, ending each bullet with its source URL. ' +
    'If a query finds nothing, say so.',
  tools: [searchTools],
  outputKey: 'research_notes',
});

const writerAgent = new LlmAgent({
  name: 'writer_agent',
  model: MODEL,
  instruction:
    'Research notes:\n{research_notes}\n\n' +
    'Write the report in Markdown, using only these notes: a # title, a short summary, ' +
    '## sections with numbered citations like [1], and a ## Sources list of the URLs. ' +
    'Do not add facts. Output only the Markdown.',
  outputKey: 'final_report',
});

export const rootAgent = new SequentialAgent({
  name: 'deep_research_extended',
  description: 'Plans, searches a mock web, and writes a cited Markdown report.',
  subAgents: [plannerAgent, researcherAgent, writerAgent],
});
