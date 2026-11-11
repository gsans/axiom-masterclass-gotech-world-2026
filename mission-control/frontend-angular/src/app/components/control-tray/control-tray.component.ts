import { Component, input, output, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { PresetPrompt } from '../../../agent/adk-mock.service';

@Component({
  selector: 'app-control-tray',
  standalone: true,
  imports: [CommonModule, FormsModule],
  template: `
    <div class="control-tray glass-card">
      <div class="tray-top">
        <div class="tray-brand">
          <div class="brand-logo">
            <span class="logo-sparkle">✦</span>
          </div>
          <div class="brand-text">
            <h2>gemini-4-adk-live-angular</h2>
            <span class="brand-subtitle">ADK TypeScript • A2A Multi-Agent • Model Context Protocol • A2UI</span>
          </div>
        </div>

        <!-- Model Selection Dropdown -->
        <div class="model-picker-group">
          <label for="modelSelect">Target Live Model:</label>
          <select
            id="modelSelect"
            [ngModel]="selectedModel()"
            (ngModelChange)="onModelChange($event)"
            class="model-select"
          >
            <option value="gemini-3.8-flash-live-preview">Gemini 3.8 Live (Latest)</option>
            <option value="gemini-3.1-flash-live-preview">Gemini 3.1 Flash Live (Reference)</option>
          </select>
        </div>
      </div>

      <!-- Preset Prompt Chips -->
      <div class="preset-chips-section">
        <span class="chips-label">Quick Scenarios:</span>
        <div class="chips-list">
          @for (preset of presetPrompts(); track preset.id) {
            <button
              type="button"
              class="chip-button"
              [disabled]="isRunning()"
              (click)="selectPreset(preset)"
            >
              <span class="chip-icon">{{ preset.icon }}</span>
              <span class="chip-name">{{ preset.label }}</span>
              <span class="chip-badge">{{ preset.badge }}</span>
            </button>
          }
        </div>
      </div>

      <!-- Prompt Input & Controls -->
      <div class="prompt-input-row">
        <div class="input-container">
          <span class="input-icon">💬</span>
          <input
            id="promptInput"
            type="text"
            [(ngModel)]="userPrompt"
            [placeholder]="'Ask the ADK Agent (e.g., What time is it in Tokyo?)...'"
            (keydown.enter)="triggerRun()"
            [disabled]="isRunning()"
          />
        </div>
        <div class="action-buttons">
          <button
            id="runAgentBtn"
            type="button"
            class="btn-primary"
            [disabled]="isRunning() || !userPrompt.trim()"
            (click)="triggerRun()"
          >
            @if (isRunning()) {
              <span class="spinner"></span>
              <span>Reasoning...</span>
            } @else {
              <span>Run Agent ⚡</span>
            }
          </button>
          <button
            id="clearLogsBtn"
            type="button"
            class="btn-secondary"
            [disabled]="isRunning()"
            (click)="onClear()"
          >
            Reset
          </button>
        </div>
      </div>

      <!-- Agent Final Output Alert -->
      @if (summaryResponse()) {
        <div class="summary-box">
          <div class="summary-header">
            <span class="summary-tag">Final Agent Output</span>
            <span class="summary-check">✓ Verified</span>
          </div>
          <div class="summary-text">{{ summaryResponse() }}</div>
        </div>
      }
    </div>
  `,
  styles: [`
    .control-tray {
      padding: 1.5rem;
      border-radius: 18px;
      background: rgba(15, 23, 42, 0.75);
      backdrop-filter: blur(20px);
      border: 1px solid rgba(255, 255, 255, 0.1);
      box-shadow: 0 10px 40px rgba(0, 0, 0, 0.4);
      display: flex;
      flex-direction: column;
      gap: 1.25rem;
    }

    .tray-top {
      display: flex;
      justify-content: space-between;
      align-items: center;
      flex-wrap: wrap;
      gap: 1rem;
    }

    .tray-brand {
      display: flex;
      align-items: center;
      gap: 0.85rem;
    }

    .brand-logo {
      width: 40px;
      height: 40px;
      border-radius: 12px;
      background: linear-gradient(135deg, #06b6d4 0%, #8b5cf6 50%, #ec4899 100%);
      display: flex;
      align-items: center;
      justify-content: center;
      box-shadow: 0 0 20px rgba(139, 92, 246, 0.4);
    }

    .logo-sparkle {
      font-size: 1.3rem;
      color: #ffffff;
      animation: rotate 6s linear infinite;
    }

    @keyframes rotate {
      from { transform: rotate(0deg); }
      to { transform: rotate(360deg); }
    }

    .brand-text h2 {
      margin: 0;
      font-size: 1.25rem;
      font-weight: 700;
      color: #f8fafc;
      letter-spacing: -0.02em;
    }

    .brand-subtitle {
      font-size: 0.75rem;
      color: #94a3b8;
    }

    .model-picker-group {
      display: flex;
      align-items: center;
      gap: 0.6rem;
    }

    .model-picker-group label {
      font-size: 0.8rem;
      color: #94a3b8;
    }

    .model-select {
      background: #0f172a;
      color: #e2e8f0;
      border: 1px solid rgba(139, 92, 246, 0.4);
      padding: 0.5rem 0.85rem;
      border-radius: 8px;
      font-size: 0.8rem;
      font-family: inherit;
      outline: none;
      cursor: pointer;
      transition: border-color 0.2s;
    }

    .model-select:focus {
      border-color: #38bdf8;
    }

    .preset-chips-section {
      display: flex;
      align-items: center;
      gap: 0.75rem;
      flex-wrap: wrap;
    }

    .chips-label {
      font-size: 0.75rem;
      color: #64748b;
      font-weight: 600;
      text-transform: uppercase;
      letter-spacing: 0.05em;
    }

    .chips-list {
      display: flex;
      gap: 0.5rem;
      flex-wrap: wrap;
    }

    .chip-button {
      display: flex;
      align-items: center;
      gap: 0.45rem;
      background: rgba(255, 255, 255, 0.04);
      border: 1px solid rgba(255, 255, 255, 0.08);
      border-radius: 9999px;
      padding: 0.35rem 0.8rem;
      color: #cbd5e1;
      font-size: 0.78rem;
      cursor: pointer;
      transition: all 0.2s ease;
    }

    .chip-button:hover:not(:disabled) {
      background: rgba(56, 189, 248, 0.12);
      border-color: rgba(56, 189, 248, 0.4);
      color: #f1f5f9;
      transform: translateY(-1px);
    }

    .chip-badge {
      background: rgba(255, 255, 255, 0.08);
      color: #94a3b8;
      font-size: 0.65rem;
      padding: 0.1rem 0.4rem;
      border-radius: 6px;
      font-family: 'JetBrains Mono', monospace;
    }

    .prompt-input-row {
      display: flex;
      gap: 0.75rem;
      flex-wrap: wrap;
    }

    .input-container {
      flex: 1;
      min-width: 280px;
      position: relative;
      display: flex;
      align-items: center;
    }

    .input-icon {
      position: absolute;
      left: 1rem;
      color: #64748b;
      font-size: 1rem;
    }

    .input-container input {
      width: 100%;
      background: rgba(2, 6, 23, 0.65);
      border: 1px solid rgba(255, 255, 255, 0.1);
      border-radius: 12px;
      padding: 0.75rem 1rem 0.75rem 2.8rem;
      color: #f8fafc;
      font-size: 0.9rem;
      font-family: inherit;
      outline: none;
      transition: all 0.2s ease;
    }

    .input-container input:focus {
      border-color: #8b5cf6;
      box-shadow: 0 0 16px rgba(139, 92, 246, 0.3);
    }

    .action-buttons {
      display: flex;
      gap: 0.5rem;
    }

    .btn-primary {
      display: flex;
      align-items: center;
      gap: 0.5rem;
      background: linear-gradient(135deg, #38bdf8 0%, #8b5cf6 100%);
      color: #ffffff;
      border: none;
      border-radius: 12px;
      padding: 0.75rem 1.4rem;
      font-weight: 600;
      font-size: 0.88rem;
      cursor: pointer;
      box-shadow: 0 4px 14px rgba(56, 189, 248, 0.3);
      transition: all 0.2s ease;
    }

    .btn-primary:hover:not(:disabled) {
      transform: translateY(-2px);
      box-shadow: 0 6px 20px rgba(139, 92, 246, 0.45);
    }

    .btn-primary:disabled {
      opacity: 0.5;
      cursor: not-allowed;
    }

    .btn-secondary {
      background: rgba(255, 255, 255, 0.05);
      color: #94a3b8;
      border: 1px solid rgba(255, 255, 255, 0.1);
      border-radius: 12px;
      padding: 0.75rem 1rem;
      font-size: 0.88rem;
      cursor: pointer;
      transition: all 0.2s ease;
    }

    .btn-secondary:hover:not(:disabled) {
      background: rgba(255, 255, 255, 0.1);
      color: #f1f5f9;
    }

    .spinner {
      width: 14px;
      height: 14px;
      border: 2px solid rgba(255, 255, 255, 0.3);
      border-top-color: #ffffff;
      border-radius: 50%;
      animation: spin 0.8s linear infinite;
    }

    @keyframes spin {
      to { transform: rotate(360deg); }
    }

    .summary-box {
      background: rgba(16, 185, 129, 0.1);
      border: 1px solid rgba(16, 185, 129, 0.3);
      border-radius: 12px;
      padding: 0.9rem 1.1rem;
    }

    .summary-header {
      display: flex;
      justify-content: space-between;
      align-items: center;
      margin-bottom: 0.35rem;
    }

    .summary-tag {
      font-size: 0.72rem;
      font-weight: 700;
      text-transform: uppercase;
      letter-spacing: 0.05em;
      color: #34d399;
    }

    .summary-check {
      font-size: 0.72rem;
      color: #10b981;
      font-family: 'JetBrains Mono', monospace;
    }

    .summary-text {
      color: #e2e8f0;
      font-size: 0.88rem;
      line-height: 1.45;
    }
  `]
})
export class ControlTrayComponent {
  isRunning = input<boolean>(false);
  selectedModel = input<'gemini-3.8-flash-live-preview' | 'gemini-3.1-flash-live-preview'>('gemini-3.8-flash-live-preview');
  presetPrompts = input<PresetPrompt[]>([]);
  summaryResponse = input<string>('');

  modelChange = output<'gemini-3.8-flash-live-preview' | 'gemini-3.1-flash-live-preview'>();
  runPrompt = output<string>();
  clear = output<void>();

  userPrompt: string = 'What time is it in Tokyo right now?';

  onModelChange(newModel: string) {
    this.modelChange.emit(newModel as any);
  }

  selectPreset(preset: PresetPrompt) {
    this.userPrompt = preset.prompt;
    this.triggerRun();
  }

  triggerRun() {
    if (this.isRunning() || !this.userPrompt.trim()) return;
    this.runPrompt.emit(this.userPrompt.trim());
  }

  onClear() {
    this.userPrompt = '';
    this.clear.emit();
  }
}
