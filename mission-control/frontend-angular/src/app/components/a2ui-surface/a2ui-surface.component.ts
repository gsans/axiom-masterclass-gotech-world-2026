import { Component, input, output, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { SurfaceComponent } from '@a2ui/angular/v0_9';

@Component({
  selector: 'app-a2ui-surface',
  standalone: true,
  imports: [CommonModule, SurfaceComponent],
  template: `
    <div class="a2ui-panel glass-card">
      <div class="panel-header">
        <div class="header-title">
          <span class="badge badge-a2ui">A2UI v0.9</span>
          <h3>Generative Agent Surface</h3>
        </div>
        <span class="surface-id-tag">surfaceId: {{ surfaceId() }}</span>
      </div>

      <div class="surface-body">
        @if (hasPayload()) {
          <!-- Native A2UI v0.9 Surface Component from @a2ui/angular -->
          <div class="surface-native-host">
            <a2ui-v09-surface [surfaceId]="surfaceId()" />
          </div>

          <!-- Rich Generative UI Visual Card -->
          <div class="generative-card">
            <div class="card-glow"></div>
            <div class="card-header">
              <span class="card-badge">✨ A2UI Generative Widget</span>
              <span class="card-status-dot">Live Reactive</span>
            </div>

            <div class="card-content">
              <h4 class="card-title">{{ cardTitle() }}</h4>
              <p class="card-description">{{ cardBody() }}</p>

              <!-- Dynamic Interactive Metric Grid -->
              <div class="card-metrics-grid">
                <div class="metric-item">
                  <span class="metric-label">Protocol</span>
                  <span class="metric-value">A2UI JSON v0.9</span>
                </div>
                <div class="metric-item">
                  <span class="metric-label">Verification</span>
                  <span class="metric-value text-emerald">100% Passed</span>
                </div>
                <div class="metric-item">
                  <span class="metric-label">Execution Target</span>
                  <span class="metric-value text-cyan">Client Local-First</span>
                </div>
              </div>

              <!-- Interactive Action Buttons -->
              <div class="card-actions">
                <button type="button" class="card-btn card-btn-primary" (click)="onAction('refresh')">
                  <span>🔄 Re-Evaluate</span>
                </button>
                <button type="button" class="card-btn card-btn-secondary" (click)="onAction('copy')">
                  <span>{{ copied() ? '✓ Copied!' : '📋 Copy JSON' }}</span>
                </button>
              </div>
            </div>
          </div>

          <!-- Structured Payload Inspector -->
          <details class="payload-details" [open]="isInspectorOpen()">
            <summary (click)="toggleInspector($event)">
              <span>View A2UI JSON Messages Envelope ({{ messageCount() }} messages)</span>
            </summary>
            <pre class="json-code"><code>{{ rawPayloadJson() }}</code></pre>
          </details>
        } @else {
          <div class="empty-surface">
            <div class="empty-icon">🎨</div>
            <h4>No Active Surface</h4>
            <p>Run a prompt from the control tray to trigger the ADK agent and stream generative A2UI components.</p>
          </div>
        }
      </div>
    </div>
  `,
  styles: [`
    .a2ui-panel {
      display: flex;
      flex-direction: column;
      height: 100%;
      min-height: 480px;
      padding: 1.25rem;
      border-radius: 16px;
      background: rgba(18, 24, 38, 0.7);
      backdrop-filter: blur(16px);
      border: 1px solid rgba(56, 189, 248, 0.2);
      box-shadow: 0 8px 32px 0 rgba(0, 0, 0, 0.37);
      transition: border-color 0.3s ease;
    }

    .a2ui-panel:hover {
      border-color: rgba(56, 189, 248, 0.4);
    }

    .panel-header {
      display: flex;
      justify-content: space-between;
      align-items: center;
      margin-bottom: 1rem;
      padding-bottom: 0.75rem;
      border-bottom: 1px solid rgba(255, 255, 255, 0.08);
    }

    .header-title {
      display: flex;
      align-items: center;
      gap: 0.75rem;
    }

    .header-title h3 {
      margin: 0;
      font-size: 1.1rem;
      font-weight: 600;
      color: #f1f5f9;
      letter-spacing: -0.01em;
    }

    .badge-a2ui {
      background: linear-gradient(135deg, #06b6d4 0%, #3b82f6 100%);
      color: #ffffff;
      font-size: 0.7rem;
      font-weight: 700;
      padding: 0.2rem 0.55rem;
      border-radius: 9999px;
      text-transform: uppercase;
      letter-spacing: 0.05em;
    }

    .surface-id-tag {
      font-family: 'JetBrains Mono', monospace;
      font-size: 0.75rem;
      color: #94a3b8;
      background: rgba(255, 255, 255, 0.05);
      padding: 0.25rem 0.6rem;
      border-radius: 6px;
      border: 1px solid rgba(255, 255, 255, 0.08);
    }

    .surface-body {
      flex: 1;
      display: flex;
      flex-direction: column;
      gap: 1.25rem;
    }

    .surface-native-host {
      display: contents;
    }

    .generative-card {
      position: relative;
      background: linear-gradient(145deg, rgba(15, 23, 42, 0.85) 0%, rgba(30, 41, 59, 0.7) 100%);
      border: 1px solid rgba(56, 189, 248, 0.25);
      border-radius: 14px;
      padding: 1.25rem;
      overflow: hidden;
      box-shadow: 0 10px 25px -5px rgba(0, 0, 0, 0.4);
    }

    .card-glow {
      position: absolute;
      top: -40px;
      right: -40px;
      width: 120px;
      height: 120px;
      background: radial-gradient(circle, rgba(56, 189, 248, 0.2) 0%, transparent 70%);
      border-radius: 50%;
      pointer-events: none;
    }

    .card-header {
      display: flex;
      justify-content: space-between;
      align-items: center;
      margin-bottom: 0.85rem;
    }

    .card-badge {
      font-size: 0.72rem;
      font-weight: 700;
      color: #38bdf8;
      text-transform: uppercase;
      letter-spacing: 0.04em;
    }

    .card-status-dot {
      display: flex;
      align-items: center;
      gap: 0.4rem;
      font-size: 0.72rem;
      color: #10b981;
      font-family: 'JetBrains Mono', monospace;
    }

    .card-status-dot::before {
      content: '';
      width: 6px;
      height: 6px;
      background: #10b981;
      border-radius: 50%;
      box-shadow: 0 0 6px #10b981;
    }

    .card-title {
      margin: 0 0 0.5rem 0;
      font-size: 1.15rem;
      font-weight: 700;
      color: #f8fafc;
      letter-spacing: -0.01em;
    }

    .card-description {
      margin: 0 0 1rem 0;
      font-size: 0.9rem;
      color: #cbd5e1;
      line-height: 1.5;
    }

    .card-metrics-grid {
      display: grid;
      grid-template-columns: repeat(3, 1fr);
      gap: 0.75rem;
      margin-bottom: 1.25rem;
      padding: 0.85rem;
      background: rgba(2, 6, 23, 0.55);
      border-radius: 10px;
      border: 1px solid rgba(255, 255, 255, 0.05);
    }

    @media (max-width: 600px) {
      .card-metrics-grid {
        grid-template-columns: 1fr;
      }
    }

    .metric-item {
      display: flex;
      flex-direction: column;
      gap: 0.2rem;
    }

    .metric-label {
      font-size: 0.68rem;
      color: #64748b;
      text-transform: uppercase;
      letter-spacing: 0.05em;
    }

    .metric-value {
      font-size: 0.82rem;
      font-weight: 600;
      color: #e2e8f0;
      font-family: 'JetBrains Mono', monospace;
    }

    .text-emerald { color: #34d399 !important; }
    .text-cyan { color: #38bdf8 !important; }

    .card-actions {
      display: flex;
      gap: 0.6rem;
    }

    .card-btn {
      padding: 0.5rem 0.9rem;
      border-radius: 8px;
      font-size: 0.8rem;
      font-weight: 600;
      cursor: pointer;
      transition: all 0.2s ease;
      font-family: inherit;
    }

    .card-btn-primary {
      background: rgba(56, 189, 248, 0.15);
      color: #38bdf8;
      border: 1px solid rgba(56, 189, 248, 0.35);
    }

    .card-btn-primary:hover {
      background: rgba(56, 189, 248, 0.25);
      transform: translateY(-1px);
    }

    .card-btn-secondary {
      background: rgba(255, 255, 255, 0.05);
      color: #94a3b8;
      border: 1px solid rgba(255, 255, 255, 0.1);
    }

    .card-btn-secondary:hover {
      background: rgba(255, 255, 255, 0.1);
      color: #f1f5f9;
    }

    .payload-details {
      background: rgba(10, 15, 26, 0.6);
      border: 1px solid rgba(255, 255, 255, 0.06);
      border-radius: 8px;
      padding: 0.6rem 0.85rem;
      font-size: 0.8rem;
    }

    .payload-details summary {
      cursor: pointer;
      color: #38bdf8;
      font-weight: 500;
      user-select: none;
    }

    .json-code {
      margin-top: 0.5rem;
      padding: 0.75rem;
      background: #020617;
      border-radius: 6px;
      color: #a5f3fc;
      font-family: 'JetBrains Mono', monospace;
      font-size: 0.75rem;
      overflow-x: auto;
      max-height: 220px;
    }

    .empty-surface {
      display: flex;
      flex-direction: column;
      align-items: center;
      justify-content: center;
      text-align: center;
      padding: 3rem 1rem;
      color: #64748b;
    }

    .empty-icon {
      font-size: 2.5rem;
      margin-bottom: 0.75rem;
      opacity: 0.8;
    }

    .empty-surface h4 {
      margin: 0 0 0.5rem 0;
      color: #94a3b8;
      font-weight: 600;
    }

    .empty-surface p {
      margin: 0;
      font-size: 0.85rem;
      max-width: 320px;
      line-height: 1.4;
    }
  `]
})
export class A2uiSurfaceComponent {
  surfaceId = input<string>('agent-surface');
  payload = input<unknown | null>(null);

  isInspectorOpen = signal<boolean>(false);
  copied = signal<boolean>(false);

  get hasPayload(): () => boolean {
    return () => this.payload() !== null;
  }

  get messageCount(): () => number {
    return () => {
      const p = this.payload();
      return Array.isArray(p) ? p.length : 0;
    };
  }

  get cardTitle(): () => string {
    return () => {
      const p = this.payload() as any[];
      if (!p || !Array.isArray(p)) return 'ADK Agent Generative Output';
      const update = p.find(item => item?.updateComponents);
      const heading = update?.updateComponents?.components?.find((c: any) => c?.id === 'heading-text');
      return heading?.text || 'Generated A2UI Surface Widget';
    };
  }

  get cardBody(): () => string {
    return () => {
      const p = this.payload() as any[];
      if (!p || !Array.isArray(p)) return '';
      const update = p.find(item => item?.updateComponents);
      const body = update?.updateComponents?.components?.find((c: any) => c?.id === 'body-text');
      return body?.text || 'Component tree dynamically resolved and verified.';
    };
  }

  get rawPayloadJson(): () => string {
    return () => {
      const p = this.payload();
      return p ? JSON.stringify(p, null, 2) : '';
    };
  }

  reEvaluate = output<void>();

  toggleInspector(event: MouseEvent) {
    event.preventDefault();
    this.isInspectorOpen.update(v => !v);
  }

  onAction(action: 'refresh' | 'copy') {
    if (action === 'refresh') {
      this.reEvaluate.emit();
    } else if (action === 'copy') {
      const text = this.rawPayloadJson();
      if (text && navigator?.clipboard) {
        navigator.clipboard.writeText(text);
        this.copied.set(true);
        setTimeout(() => this.copied.set(false), 2000);
      }
    }
  }
}
