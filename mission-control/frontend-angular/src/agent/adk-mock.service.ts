import { Injectable, signal, inject } from '@angular/core';
import { getCurrentTime, calculateMetrics, executeCurrentTime, executeCalculateMetrics, rootAgent, timeSubAgent, metricsSubAgent } from './agent';
import { A2uiRendererService } from '@a2ui/angular/v0_9';

export interface AdkLogEntry {
  id: string;
  timestamp: string;
  stage: 'perceive' | 'think' | 'act' | 'check' | 'system';
  agent: string;
  title: string;
  detail: string;
  data?: unknown;
}

export interface PresetPrompt {
  id: string;
  label: string;
  prompt: string;
  icon: string;
  badge: string;
}

@Injectable({
  providedIn: 'root',
})
export class AdkMockService {
  private a2uiRenderer = inject(A2uiRendererService, { optional: true });

  // Core Reactive Signals
  readonly isRunning = signal<boolean>(false);
  readonly currentStage = signal<'idle' | 'perceive' | 'think' | 'act' | 'check' | 'complete'>('idle');
  readonly activeAgent = signal<string>(rootAgent.name);
  readonly selectedModel = signal<'gemini-3.8-flash-live-preview' | 'gemini-3.1-flash-live-preview'>('gemini-3.8-flash-live-preview');
  readonly logs = signal<AdkLogEntry[]>([]);
  readonly currentA2UiPayload = signal<unknown | null>(null);
  readonly summaryResponse = signal<string>('');
  readonly lastPrompt = signal<string>('What time is it in Tokyo right now?');

  // Sample prompt options highlighting ADK features
  readonly presetPrompts: PresetPrompt[] = [
    {
      id: 'time-tokyo',
      label: 'Tokyo World Clock',
      prompt: 'What time is it in Tokyo right now, and what is its UTC offset?',
      icon: '🕒',
      badge: 'FunctionTool',
    },
    {
      id: 'metrics-yield',
      label: 'Calculate ROI & Yield',
      prompt: 'Calculate projected yield for a principal of 25,000 with a 3x multiplier and 14.5% interest rate.',
      icon: '📊',
      badge: 'Zod Validation',
    },
    {
      id: 'a2a-workflow',
      label: 'Multi-Agent Delegation (A2A)',
      prompt: 'Coordinate time across London & San Francisco and project server uptime metrics.',
      icon: '🤖',
      badge: 'A2A Orchestration',
    },
    {
      id: 'a2ui-dashboard',
      label: 'Generate A2UI Card',
      prompt: 'Create a dynamic A2UI generative card with live system metrics and quick action buttons.',
      icon: '✨',
      badge: 'A2UI Protocol',
    },
  ];

  setModel(model: 'gemini-3.8-flash-live-preview' | 'gemini-3.1-flash-live-preview') {
    this.selectedModel.set(model);
    this.addLog('system', 'System', `Model updated to ${model === 'gemini-3.8-flash-live-preview' ? 'Gemini 3.8 Live (Latest)' : 'Gemini 3.1 Flash Live (Reference)'}`);
  }

  clearLogs() {
    this.logs.set([]);
    this.summaryResponse.set('');
    this.currentA2UiPayload.set(null);
    this.currentStage.set('idle');
    this.activeAgent.set(rootAgent.name);
  }

  /**
   * Re-evaluates the active prompt, demonstrating A2UI clientAction feedback loop.
   */
  async reEvaluate() {
    if (this.isRunning()) return;
    const prompt = this.lastPrompt();
    this.addLog('system', 'A2UI Protocol', `[ClientAction: 're-evaluate'] User requested fresh state evaluation for: "${prompt}"`);
    await this.runPrompt(prompt, true);
  }

  /**
   * Executes the ADK Perceive -> Think -> Act -> Check loop
   */
  async runPrompt(promptText: string, isReevaluation: boolean = false) {
    if (this.isRunning()) return;

    this.isRunning.set(true);
    if (!isReevaluation) {
      this.clearLogs();
    }
    this.lastPrompt.set(promptText);
    const model = this.selectedModel();

    try {
      // 1. PERCEIVE
      this.currentStage.set('perceive');
      this.activeAgent.set(rootAgent.name);
      this.addLog(
        'perceive',
        rootAgent.name,
        isReevaluation
          ? `Perceiving re-evaluate action trigger for active query with model: ${model}`
          : `Perceiving user input with model: ${model}`,
        { prompt: promptText, isReevaluation }
      );
      await this.delay(500);

      // 2. THINK & DYNAMIC ROUTING
      this.currentStage.set('think');
      const lower = promptText.toLowerCase();

      // Check whether this is a multi-agent A2A workflow scenario
      const isMultiAgentWorkflow =
        (lower.includes('london') && lower.includes('francisco')) ||
        (lower.includes('coordinate') && lower.includes('metrics')) ||
        lower.includes('multi-agent') ||
        lower.includes('a2a');

      // Check whether this is purely a metrics/calculation query
      const isMetricsOnly =
        !isMultiAgentWorkflow &&
        (lower.includes('yield') ||
         lower.includes('calculate') ||
         lower.includes('calculatemetrics') ||
         lower.includes('metric') ||
         lower.includes('roi') ||
         lower.includes('interest'));

      let delegatedAgent = rootAgent.name;
      let toolToCall = '';
      let toolArgs: Record<string, unknown> = {};

      if (isMultiAgentWorkflow) {
        // Multi-Agent Workflow: Sequential A2A Delegation
        this.addLog(
          'think',
          rootAgent.name,
          `Reasoning: Multi-agent workflow detected. Decomposing task: step 1 -> '${timeSubAgent.name}', step 2 -> '${metricsSubAgent.name}'.`,
          { subAgents: [timeSubAgent.name, metricsSubAgent.name] }
        );
        await this.delay(600);

        // 3. ACT: Multi-agent sequence
        this.currentStage.set('act');

        // Step 1: Time Specialist
        this.activeAgent.set(timeSubAgent.name);
        this.addLog('act', timeSubAgent.name, `[A2A Step 1] Invoking 'getCurrentTime' for London & SF`);
        const timeResult1 = await executeCurrentTime({ city: 'London' });
        const timeResult2 = await executeCurrentTime({ city: 'San Francisco' });
        this.addLog('act', timeSubAgent.name, `[A2A Step 1 Result]`, { london: timeResult1, sanFrancisco: timeResult2 });
        await this.delay(500);

        // Step 2: Metrics Specialist
        this.activeAgent.set(metricsSubAgent.name);
        this.addLog('act', metricsSubAgent.name, `[A2A Step 2] Invoking 'calculateMetrics' for 99.9% uptime yield`);
        const metricsResult = await executeCalculateMetrics({ principal: 10000, multiplier: 4, ratePercent: 9.9 });
        this.addLog('act', metricsSubAgent.name, `[A2A Step 2 Result]`, metricsResult);
        await this.delay(500);

        // Step 3: Synthesis by Root Orchestrator
        this.activeAgent.set(rootAgent.name);
        const multiResult = {
          london: timeResult1.time,
          sanFrancisco: timeResult2.time,
          projectedUptimeYield: `$${metricsResult.projectedYield.toLocaleString()}`,
          timestamp: new Date().toISOString(),
        };

        const a2uiEnvelope = this.buildMultiAgentA2UiPayload(multiResult);
        this.currentA2UiPayload.set(a2uiEnvelope);
        if (this.a2uiRenderer) {
          try {
            this.a2uiRenderer.processMessages(a2uiEnvelope);
          } catch (e: any) {
            console.warn('A2UI Renderer warning:', e?.message);
          }
        }

        // 4. CHECK
        this.currentStage.set('check');
        this.addLog('check', rootAgent.name, `Checking output: Both sub-agent outputs synthesized and verified against SLA.`);
        await this.delay(400);

        this.currentStage.set('complete');
        const summary = `[A2A Multi-Agent Orchestration] London: ${timeResult1.time} | SF: ${timeResult2.time}. Uptime Projected Yield: $${metricsResult.projectedYield.toLocaleString()} (Verified by ${rootAgent.name}).`;
        this.summaryResponse.set(summary);
        this.addLog('system', rootAgent.name, `Turn completed. Response ready.`, { summary });
        return;

      } else if (isMetricsOnly) {
        // Pure Metrics Specialist Delegation
        delegatedAgent = metricsSubAgent.name;
        toolToCall = 'calculate_metrics';
        toolArgs = { principal: 25000, multiplier: 3, ratePercent: 14.5 };
        this.addLog(
          'think',
          rootAgent.name,
          `Reasoning: Quantitative modeling needed. Delegating via A2A to '${metricsSubAgent.name}'.`,
          { subAgent: metricsSubAgent.name, targetTool: toolToCall }
        );
      } else {
        // Geographic / Temporal Specialist Delegation
        delegatedAgent = timeSubAgent.name;
        toolToCall = 'get_current_time';
        const city = lower.includes('tokyo') ? 'Tokyo' : lower.includes('london') ? 'London' : lower.includes('paris') ? 'Paris' : 'Tokyo';
        toolArgs = { city };
        this.addLog(
          'think',
          rootAgent.name,
          `Reasoning: Query involves geographic time. Delegating via A2A to '${timeSubAgent.name}'.`,
          { subAgent: timeSubAgent.name, targetTool: toolToCall }
        );
      }
      await this.delay(600);

      // 3. ACT (Tool Execution & A2UI generation)
      this.currentStage.set('act');
      this.activeAgent.set(delegatedAgent);

      let toolResult: unknown;
      if (toolToCall === 'get_current_time') {
        this.addLog('act', delegatedAgent, `Invoking tool 'getCurrentTime' with city="${toolArgs['city']}"`, toolArgs);
        toolResult = await executeCurrentTime({ city: (toolArgs['city'] as string) || 'Tokyo' });
      } else {
        this.addLog('act', delegatedAgent, `Invoking tool 'calculateMetrics' with parameters`, toolArgs);
        toolResult = await executeCalculateMetrics({
          principal: (toolArgs['principal'] as number) || 25000,
          multiplier: (toolArgs['multiplier'] as number) || 3,
          ratePercent: (toolArgs['ratePercent'] as number) || 14.5,
        });
      }
      this.addLog('act', delegatedAgent, `Tool execution returned verified payload:`, toolResult);
      await this.delay(500);

      // Generate A2UI v0.9 Payload
      const a2uiEnvelope = this.buildA2UiPayload(toolToCall, toolResult, delegatedAgent);
      this.currentA2UiPayload.set(a2uiEnvelope);

      if (this.a2uiRenderer) {
        try {
          this.a2uiRenderer.processMessages(a2uiEnvelope);
          this.addLog('act', 'A2UI Renderer', `Dispatched A2UI v0.9 messages to surface 'agent-surface'`, a2uiEnvelope);
        } catch (err: any) {
          console.warn('A2UI Renderer processing notice:', err?.message);
        }
      }
      await this.delay(400);

      // 4. CHECK
      this.currentStage.set('check');
      this.activeAgent.set(rootAgent.name);
      this.addLog(
        'check',
        rootAgent.name,
        `Checking output constraints: Hallucination score: 0.00, Schema conformity: 100%.`,
        { verifiedBy: rootAgent.name, confidence: 0.99 }
      );
      await this.delay(400);

      // Final summary
      this.currentStage.set('complete');
      const summary = this.buildFinalSummary(toolToCall, toolResult, delegatedAgent);
      this.summaryResponse.set(summary);
      this.addLog('system', rootAgent.name, `Turn completed successfully. Response ready.`, { summary });
    } catch (error: any) {
      this.addLog('system', 'Error', `Agent execution failed: ${error?.message || error}`);
    } finally {
      this.isRunning.set(false);
    }
  }

  private buildA2UiPayload(toolName: string, result: any, agentName: string) {
    const isTime = toolName === 'get_current_time';
    const titleText = isTime
      ? `⏰ World Clock: ${result.city}`
      : `📈 Quantitative Projections`;
    const bodyText = isTime
      ? `${result.report} (Live Timezone resolved via ADK FunctionTool)`
      : `Principal: $${result.principal.toLocaleString()} | Multiplier: ${result.multiplier}x | Projected Yield: $${result.projectedYield.toLocaleString()}`;

    return [
      {
        version: 'v0.9',
        createSurface: {
          surfaceId: 'agent-surface',
          catalogId: 'https://a2ui.org/specification/v0_9/catalogs/basic/catalog.json',
        },
      },
      {
        version: 'v0.9',
        updateComponents: {
          surfaceId: 'agent-surface',
          components: [
            {
              id: 'root',
              component: 'Card',
              child: 'card-column',
            },
            {
              id: 'card-column',
              component: 'Column',
              children: ['heading-text', 'body-text', 'meta-text'],
            },
            {
              id: 'heading-text',
              component: 'Text',
              text: titleText,
              variant: 'h2',
            },
            {
              id: 'body-text',
              component: 'Text',
              text: bodyText,
              variant: 'body',
            },
            {
              id: 'meta-text',
              component: 'Text',
              text: `Generated by ${agentName} via Google ADK TypeScript at ${result.timestamp || new Date().toISOString()}`,
              variant: 'caption',
            },
          ],
        },
      },
    ];
  }

  private buildMultiAgentA2UiPayload(multiResult: any) {
    return [
      {
        version: 'v0.9',
        createSurface: {
          surfaceId: 'agent-surface',
          catalogId: 'https://a2ui.org/specification/v0_9/catalogs/basic/catalog.json',
        },
      },
      {
        version: 'v0.9',
        updateComponents: {
          surfaceId: 'agent-surface',
          components: [
            {
              id: 'root',
              component: 'Card',
              child: 'card-column',
            },
            {
              id: 'card-column',
              component: 'Column',
              children: ['heading-text', 'body-text', 'meta-text'],
            },
            {
              id: 'heading-text',
              component: 'Text',
              text: '🌐 A2A Multi-Agent Joint Workflow',
              variant: 'h2',
            },
            {
              id: 'body-text',
              component: 'Text',
              text: `London: ${multiResult.london} | SF: ${multiResult.sanFrancisco} | Server Projected Yield: ${multiResult.projectedUptimeYield}`,
              variant: 'body',
            },
            {
              id: 'meta-text',
              component: 'Text',
              text: `Orchestrated by ${rootAgent.name} coordinating ${timeSubAgent.name} & ${metricsSubAgent.name}`,
              variant: 'caption',
            },
          ],
        },
      },
    ];
  }

  private buildFinalSummary(toolName: string, result: any, agentName: string): string {
    if (toolName === 'get_current_time') {
      return `[${agentName}] ${result.report}. Data verified by ADK FunctionTool running locally.`;
    }
    return `[${agentName}] Financial projection computed: Starting base $${result.principal.toLocaleString()} with a ${result.multiplier}x multiplier and ${result.ratePercent}% yield yields $${result.projectedYield.toLocaleString()}.`;
  }

  private addLog(stage: AdkLogEntry['stage'], agent: string, title: string, data?: unknown) {
    const now = new Date();
    const timeStr = `${now.getHours().toString().padStart(2, '0')}:${now.getMinutes().toString().padStart(2, '0')}:${now.getSeconds().toString().padStart(2, '0')}.${now.getMilliseconds().toString().padStart(3, '0')}`;
    const entry: AdkLogEntry = {
      id: Math.random().toString(36).substring(2, 9),
      timestamp: timeStr,
      stage,
      agent,
      title,
      detail: title,
      data,
    };
    this.logs.update((current) => [...current, entry]);
  }

  private delay(ms: number) {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }
}
