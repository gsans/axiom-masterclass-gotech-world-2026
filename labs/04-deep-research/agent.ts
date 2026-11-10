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

// Step 1 is done for you.
const plannerAgent = new LlmAgent({
  name: 'planner_agent',
  model: MODEL,
  instruction:
    'You plan research. Turn the question into exactly 3 short web search queries, ' +
    'as a numbered list. Do not answer the question.',
  outputKey: 'research_plan',
});

// TODO 1: create researcherAgent.
//   - tools: [searchTools]
//   - instruction: run web_search once per query in {research_plan}, then write
//     bullet-point notes using only the results, with the source URL on each bullet
//   - outputKey: 'research_notes'

// TODO 2: create writerAgent.
//   - no tools
//   - instruction: write the report in Markdown using only {research_notes}, with a
//     title, a short summary, sections, numbered citations and a Sources list
//   - outputKey: 'final_report'

export const rootAgent = new SequentialAgent({
  name: 'deep_research_exercise',
  description: 'Exercise: finish the Deep Research pipeline.',
  // TODO 3: add your two agents, in order.
  subAgents: [plannerAgent],
});

void searchTools; // Remove this line once researcherAgent uses searchTools.
