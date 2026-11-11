import { Component, input } from '@angular/core';
import { CommonModule } from '@angular/common';
import { AdkLogEntry } from '../../../agent/adk-mock.service';

@Component({
  selector: 'app-agent-inspector',
  standalone: true,
  imports: [CommonModule],
  template: `
    <div class="inspector-panel glass-card">
      <div class="panel-header">
        <div class="header-left">
          <span class="badge badge-adk">ADK TypeScript</span>
          <h3>Agent Orchestration Loop</h3>
        </div>
        <div class="active-agent-badge">
          <span class="pulse-dot"></span>
          <span>{{ activeAgent() }}</span>
        </div>
      </div>

      <!-- ADK 4-Stage Trajectory Bar -->
      <div class="stages-indicator">
        <div class="stage-step" [class.active]="currentStage() === 'perceive'" [class.done]="isStagePassed('perceive')">
          <div class="stage-circle">1</div>
          <span class="stage-name">Perceive</span>
        </div>
        <div class="stage-line" [class.done]="isStagePassed('perceive')"></div>
        <div class="stage-step" [class.active]="currentStage() === 'think'" [class.done]="isStagePassed('think')">
          <div class="stage-circle">2</div>
          <span class="stage-name">Think</span>
        </div>
        <div class="stage-line" [class.done]="isStagePassed('think')"></div>
        <div class="stage-step" [class.active]="currentStage() === 'act'" [class.done]="isStagePassed('act')">
          <div class="stage-circle">3</div>
          <span class="stage-name">Act</span>
        </div>
        <div class="stage-line" [class.done]="isStagePassed('act')"></div>
        <div class="stage-step" [class.active]="currentStage() === 'check'" [class.done]="isStagePassed('check')">
          <div class="stage-circle">4</div>
          <span class="stage-name">Check</span>
        </div>
      </div>

      <!-- Multi-Agent Hierarchy (A2A Architecture) -->
      <div class="a2a-hierarchy">
        <div class="a2a-title">A2A Multi-Agent Hierarchy</div>
        <div class="agents-tree">
          <div class="agent-node root-node" [class.highlighted]="activeAgent() === 'adk_root_orchestrator'">
            <span class="agent-icon">👑</span>
            <div class="agent-meta">
              <span class="node-name">Root Agent</span>
              <span class="node-model">{{ selectedModel() }}</span>
            </div>
          </div>
          <div class="sub-agents-row">
            <div class="agent-node sub-node" [class.highlighted]="activeAgent() === 'time_specialist_agent'">
              <span class="agent-icon">🕒</span>
              <div class="agent-meta">
                <span class="node-name">Time Specialist</span>
                <span class="node-tool">getCurrentTime</span>
              </div>
            </div>
            <div class="agent-node sub-node" [class.highlighted]="activeAgent() === 'metrics_specialist_agent'">
              <span class="agent-icon">📊</span>
              <div class="agent-meta">
                <span class="node-name">Metrics Specialist</span>
                <span class="node-tool">calculateMetrics</span>
              </div>
            </div>
          </div>
        </div>
      </div>

      <!-- Execution Logs Stream -->
      <div class="logs-section">
        <div class="logs-header">
          <span>Execution Trajectory</span>
          <span class="logs-count">{{ logs().length }} events</span>
        </div>
        <div class="logs-scroller">
          @if (logs().length === 0) {
            <div class="logs-empty">
              <span>Ready. Trigger a query to watch the ADK loop execute.</span>
            </div>
          } @else {
            @for (log of logs(); track log.id) {
              <div class="log-item" [class]="'stage-' + log.stage">
                <div class="log-top">
                  <span class="log-timestamp">{{ log.timestamp }}</span>
                  <span class="log-stage-tag">{{ log.stage | uppercase }}</span>
                  <span class="log-agent-tag">{{ log.agent }}</span>
                </div>
                <div class="log-title">{{ log.title }}</div>
                @if (log.data) {
                  <pre class="log-data"><code>{{ formatData(log.data) }}</code></pre>
                }
              </div>
            }
          }
        </div>
      </div>
    </div>
  `,
  styles: [`
    .inspector-panel {
      display: flex;
      flex-direction: column;
      height: 100%;
      min-height: 480px;
      padding: 1.25rem;
      border-radius: 16px;
      background: rgba(18, 24, 38, 0.7);
      backdrop-filter: blur(16px);
      border: 1px solid rgba(139, 92, 246, 0.2);
      box-shadow: 0 8px 32px 0 rgba(0, 0, 0, 0.37);
      transition: border-color 0.3s ease;
    }

    .inspector-panel:hover {
      border-color: rgba(139, 92, 246, 0.4);
    }

    .panel-header {
      display: flex;
      justify-content: space-between;
      align-items: center;
      margin-bottom: 1.25rem;
      padding-bottom: 0.75rem;
      border-bottom: 1px solid rgba(255, 255, 255, 0.08);
    }

    .header-left {
      display: flex;
      align-items: center;
      gap: 0.75rem;
    }

    .header-left h3 {
      margin: 0;
      font-size: 1.1rem;
      font-weight: 600;
      color: #f1f5f9;
    }

    .badge-adk {
      background: linear-gradient(135deg, #8b5cf6 0%, #ec4899 100%);
      color: #ffffff;
      font-size: 0.7rem;
      font-weight: 700;
      padding: 0.2rem 0.55rem;
      border-radius: 9999px;
      text-transform: uppercase;
      letter-spacing: 0.05em;
    }

    .active-agent-badge {
      display: flex;
      align-items: center;
      gap: 0.5rem;
      background: rgba(139, 92, 246, 0.15);
      border: 1px solid rgba(139, 92, 246, 0.3);
      padding: 0.25rem 0.65rem;
      border-radius: 9999px;
      font-size: 0.75rem;
      color: #c4b5fd;
      font-family: 'JetBrains Mono', monospace;
    }

    .pulse-dot {
      width: 8px;
      height: 8px;
      border-radius: 50%;
      background: #10b981;
      box-shadow: 0 0 8px #10b981;
      animation: pulse 1.5s infinite;
    }

    @keyframes pulse {
      0%, 100% { opacity: 1; transform: scale(1); }
      50% { opacity: 0.4; transform: scale(0.85); }
    }

    .stages-indicator {
      display: flex;
      align-items: center;
      justify-content: space-between;
      margin-bottom: 1.25rem;
      padding: 0.75rem 1rem;
      background: rgba(10, 15, 26, 0.5);
      border-radius: 12px;
      border: 1px solid rgba(255, 255, 255, 0.05);
    }

    .stage-step {
      display: flex;
      align-items: center;
      gap: 0.45rem;
      color: #64748b;
      font-size: 0.8rem;
      font-weight: 500;
      transition: all 0.2s ease;
    }

    .stage-circle {
      width: 22px;
      height: 22px;
      border-radius: 50%;
      background: rgba(255, 255, 255, 0.08);
      display: flex;
      align-items: center;
      justify-content: center;
      font-size: 0.7rem;
      font-weight: 700;
    }

    .stage-step.active {
      color: #38bdf8;
    }

    .stage-step.active .stage-circle {
      background: #38bdf8;
      color: #0f172a;
      box-shadow: 0 0 10px rgba(56, 189, 248, 0.6);
    }

    .stage-step.done {
      color: #10b981;
    }

    .stage-step.done .stage-circle {
      background: #10b981;
      color: #0f172a;
    }

    .stage-line {
      flex: 1;
      height: 2px;
      margin: 0 0.5rem;
      background: rgba(255, 255, 255, 0.08);
      transition: background 0.3s ease;
    }

    .stage-line.done {
      background: #10b981;
    }

    .a2a-hierarchy {
      margin-bottom: 1.25rem;
      padding: 0.85rem;
      background: rgba(10, 15, 26, 0.4);
      border-radius: 12px;
      border: 1px solid rgba(255, 255, 255, 0.05);
    }

    .a2a-title {
      font-size: 0.75rem;
      text-transform: uppercase;
      letter-spacing: 0.05em;
      color: #94a3b8;
      margin-bottom: 0.65rem;
    }

    .agents-tree {
      display: flex;
      flex-direction: column;
      gap: 0.6rem;
    }

    .agent-node {
      display: flex;
      align-items: center;
      gap: 0.6rem;
      padding: 0.5rem 0.75rem;
      border-radius: 8px;
      background: rgba(255, 255, 255, 0.03);
      border: 1px solid rgba(255, 255, 255, 0.06);
      transition: all 0.25s ease;
    }

    .agent-node.highlighted {
      background: rgba(139, 92, 246, 0.2);
      border-color: rgba(139, 92, 246, 0.6);
      box-shadow: 0 0 12px rgba(139, 92, 246, 0.3);
    }

    .sub-agents-row {
      display: grid;
      grid-template-columns: 1fr 1fr;
      gap: 0.6rem;
    }

    .agent-meta {
      display: flex;
      flex-direction: column;
    }

    .node-name {
      font-size: 0.8rem;
      font-weight: 600;
      color: #f1f5f9;
    }

    .node-model, .node-tool {
      font-size: 0.7rem;
      color: #94a3b8;
      font-family: 'JetBrains Mono', monospace;
    }

    .logs-section {
      flex: 1;
      display: flex;
      flex-direction: column;
      min-height: 200px;
    }

    .logs-header {
      display: flex;
      justify-content: space-between;
      font-size: 0.8rem;
      color: #94a3b8;
      margin-bottom: 0.5rem;
    }

    .logs-scroller {
      flex: 1;
      max-height: 260px;
      overflow-y: auto;
      display: flex;
      flex-direction: column;
      gap: 0.5rem;
      padding-right: 0.3rem;
    }

    .logs-empty {
      text-align: center;
      padding: 2rem;
      color: #64748b;
      font-size: 0.85rem;
    }

    .log-item {
      padding: 0.6rem 0.75rem;
      background: rgba(2, 6, 23, 0.5);
      border-radius: 8px;
      border-left: 3px solid #64748b;
      font-size: 0.8rem;
    }

    .log-item.stage-perceive { border-left-color: #38bdf8; }
    .log-item.stage-think { border-left-color: #a855f7; }
    .log-item.stage-act { border-left-color: #f59e0b; }
    .log-item.stage-check { border-left-color: #10b981; }

    .log-top {
      display: flex;
      align-items: center;
      gap: 0.5rem;
      margin-bottom: 0.25rem;
      font-size: 0.7rem;
    }

    .log-timestamp {
      color: #64748b;
      font-family: 'JetBrains Mono', monospace;
    }

    .log-stage-tag {
      font-weight: 700;
      color: #94a3b8;
    }

    .log-agent-tag {
      color: #c4b5fd;
      font-family: 'JetBrains Mono', monospace;
    }

    .log-title {
      color: #e2e8f0;
      line-height: 1.35;
    }

    .log-data {
      margin: 0.35rem 0 0 0;
      padding: 0.4rem 0.5rem;
      background: #020617;
      border-radius: 4px;
      color: #93c5fd;
      font-family: 'JetBrains Mono', monospace;
      font-size: 0.7rem;
      overflow-x: auto;
    }
  `]
})
export class AgentInspectorComponent {
  currentStage = input<'idle' | 'perceive' | 'think' | 'act' | 'check' | 'complete'>('idle');
  activeAgent = input<string>('adk_root_orchestrator');
  selectedModel = input<string>('gemini-3.8-flash-live-preview');
  logs = input<AdkLogEntry[]>([]);

  isStagePassed(stage: 'perceive' | 'think' | 'act' | 'check'): boolean {
    const order = ['idle', 'perceive', 'think', 'act', 'check', 'complete'];
    const currentIdx = order.indexOf(this.currentStage());
    const stageIdx = order.indexOf(stage);
    return currentIdx > stageIdx;
  }

  formatData(data: unknown): string {
    return JSON.stringify(data, null, 2);
  }
}
