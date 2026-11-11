import { FunctionTool, LlmAgent } from '@google/adk';
import { z } from 'zod';

/**
 * Underlying implementation for getCurrentTime with live dynamic timezone resolution
 */
export const executeCurrentTime = async ({ city }: { city: string }) => {
  const timezoneMap: Record<string, { tz: string; abbr: string; offset: string }> = {
    tokyo: { tz: 'Asia/Tokyo', abbr: 'JST', offset: 'UTC+9' },
    london: { tz: 'Europe/London', abbr: 'GMT', offset: 'UTC+0' },
    'new york': { tz: 'America/New_York', abbr: 'EDT', offset: 'UTC-4' },
    'san francisco': { tz: 'America/Los_Angeles', abbr: 'PDT', offset: 'UTC-7' },
    paris: { tz: 'Europe/Paris', abbr: 'CEST', offset: 'UTC+2' },
    sydney: { tz: 'Australia/Sydney', abbr: 'AEDT', offset: 'UTC+11' },
  };

  const normalized = (city || 'Tokyo').trim().toLowerCase();
  const tzInfo = timezoneMap[normalized] || { tz: 'UTC', abbr: 'UTC', offset: 'UTC+0' };
  const now = new Date();
  const formatter = new Intl.DateTimeFormat('en-US', {
    timeZone: tzInfo.tz,
    hour: 'numeric',
    minute: '2-digit',
    second: '2-digit',
    hour12: true,
  });
  const formattedTime = formatter.format(now);
  const timeString = `${formattedTime} ${tzInfo.abbr} (${tzInfo.offset})`;

  return {
    status: 'success',
    report: `The current time in ${city} is ${timeString}`,
    city,
    time: timeString,
    timestamp: now.toISOString(),
  };
};

/**
 * Underlying implementation for calculateMetrics
 */
export const executeCalculateMetrics = async ({
  principal,
  multiplier,
  ratePercent,
}: {
  principal: number;
  multiplier: number;
  ratePercent: number;
}) => {
  const p = principal ?? 25000;
  const m = multiplier ?? 3;
  const r = ratePercent ?? 14.5;
  const computedYield = p * m * (1 + r / 100);
  return {
    status: 'success',
    principal: p,
    multiplier: m,
    ratePercent: r,
    projectedYield: Math.round(computedYield * 100) / 100,
    confidenceScore: 0.98,
    timestamp: new Date().toISOString(),
  };
};

/**
 * ADK Function Tool: getCurrentTime
 * Based on the ADK TypeScript tutorial specification.
 */
export const getCurrentTime = new FunctionTool({
  name: 'get_current_time',
  description: 'Returns the current time and timezone for a specified city.',
  parameters: z.object({
    city: z.string().describe('The name of the city for which to retrieve the current time.'),
  }),
  execute: executeCurrentTime,
});

/**
 * ADK Function Tool: calculateMetrics
 * Demonstrates math & parameter constraint validation with Zod.
 */
export const calculateMetrics = new FunctionTool({
  name: 'calculate_metrics',
  description: 'Performs mathematical and financial calculations with validated boundaries.',
  parameters: z.object({
    principal: z.number().describe('Base principal investment or starting quantity'),
    multiplier: z.number().min(1).max(10).describe('Multiplier or growth factor between 1 and 10'),
    ratePercent: z.number().min(0).max(100).describe('Interest or yield rate percentage'),
  }),
  execute: executeCalculateMetrics,
});

/**
 * Specialized Sub-Agent: TimeAgent (A2A Multi-agent architecture)
 * Handles geographic and temporal queries.
 */
export const timeSubAgent = new LlmAgent({
  name: 'time_specialist_agent',
  model: 'gemini-3.1-flash-live-preview',
  description: 'Specialist agent dedicated to timezones, world clock calculations, and schedule estimation.',
  instruction: `You are a temporal specialist agent. Always use the 'get_current_time' tool to resolve city queries with timezone precision.`,
  tools: [getCurrentTime],
});

/**
 * Specialized Sub-Agent: MetricsAgent (A2A Multi-agent architecture)
 * Handles quantitative and financial computations.
 */
export const metricsSubAgent = new LlmAgent({
  name: 'metrics_specialist_agent',
  model: 'gemini-3.1-flash-live-preview',
  description: 'Specialist agent dedicated to calculations, financial modeling, and metric projections.',
  instruction: `You are a quantitative specialist agent. Use the 'calculate_metrics' tool to compute accurate metrics.`,
  tools: [calculateMetrics],
});

/**
 * Root Orchestrator Agent (Primary Agent = Model + Tools + Orchestration)
 * Coordinates sub-agents and tools in an A2A hierarchy.
 */
export const rootAgent = new LlmAgent({
  name: 'adk_root_orchestrator',
  model: 'gemini-3.8-flash-live-preview',
  description: 'Root coordinator agent for gemini-4-adk-live-angular. Orchestrates tools, sub-agents, and A2UI generation.',
  instruction: `You are a helpful root assistant that coordinates specialized agents and tools.
- For time and city queries, delegate to the time specialist or call getCurrentTime.
- For metrics or calculations, delegate to the metrics specialist or call calculateMetrics.
- You output structured observations following the ADK Perceive -> Think -> Act -> Check loop.`,
  tools: [getCurrentTime, calculateMetrics],
  subAgents: [timeSubAgent, metricsSubAgent],
});
