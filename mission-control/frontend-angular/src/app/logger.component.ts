/**
 * Live Debugging Console & Structured Logger Component (`<app-logger>`).
 *
 * Adapted from https://github.com/gsans/gemini-3-live-angular:
 *  - `src/app/logger/logger.component.{ts,html,css}`
 *  - `src/app/side-panel/side-panel.component.{ts,html}`
 *
 * Provides:
 *  - Filter bar (`All`, `Conversations`, `Tools & Gates`, `Errors`)
 *  - Streaming indicator (`🔵 Streaming` / `⏸️ Paused`)
 *  - Deduplicated count badges (`x12`) for high-frequency `client.realtimeInput` / `server.audio` frames
 *  - Color-coded `source-client` (Green), `source-server` (Blue), and `source-error` (Red) entries
 *  - Rich cards for `User (transcript)`, `Model (transcript)`, `Narration Cue`, and `Gate / Tool` payloads
 *  - Direct text/narration test prompt input at the bottom of the console for live debugging
 */

import { Component, ElementRef, ViewChild, inject, signal, effect } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { LoggerService, LoggerFilterType, StreamingLog } from './logger.service';
import { GeminiLiveAudioService } from './gemini-live-audio.service';

import { MarkdownPipe } from './markdown.pipe';

@Component({
  selector: 'app-logger',
  standalone: true,
  imports: [CommonModule, FormsModule, MarkdownPipe],
  template: `
    <div class="logger-console">
      <!-- Top Console Toolbar (Adapted from gsans/gemini-3-live-angular side-panel indicators) -->
      <div class="logger-toolbar">
        <div class="logger-toolbar-left">
          <span class="console-title">Gemini 3.8 Live console</span>
          <div
            class="streaming-indicator"
            [class.connected]="liveAudio.connectionState() === 'CONNECTED'"
          >
            {{ liveAudio.connectionState() === 'CONNECTED' ? 'Streaming' : 'Paused' }}
          </div>
        </div>

        <div class="logger-toolbar-right">
          @for (opt of filterOptions; track opt.value) {
            <button
              type="button"
              class="filter-btn"
              [class.active]="logger.filter() === opt.value"
              [attr.aria-pressed]="logger.filter() === opt.value"
              (click)="logger.setFilter(opt.value)"
            >
              {{ opt.label }}
            </button>
          }
          <button type="button" class="clear-btn" (click)="logger.clearLogs()">
            Clear ({{ logger.logs().length }})
          </button>
        </div>
      </div>

      <!-- Scrollable Log List (Adapted from gsans/gemini-3-live-angular logger.component.html) -->
      <div #scrollContainer class="logger-list-container">
        @if (logger.filteredLogs().length === 0) {
          <div class="logger-empty">
            No debug logs for filter "{{ logger.filter() }}" yet. Click "Connect Live" or "Dispatch Run" to inspect frames.
          </div>
        } @else {
          <ul class="logger-list" role="list">
            @for (log of logger.filteredLogs(); track $index) {
              <li class="log-row" [ngClass]="getLogClasses(log)">
                <span class="timestamp">{{ formatTime(log.date) }}</span>
                <span class="source">{{ log.type }}</span>

                <div class="message">
                  @if (log.type === 'user-transcript') {
                    <div class="rich-log user-card">
                      <div class="role-header role-user">You said</div>
                      <div class="md md-log" [innerHTML]="log.message | md"></div>
                    </div>
                  } @else if (log.type === 'model-transcript') {
                    <div class="rich-log model-card">
                      <div class="role-header role-model">Model said</div>
                      <div class="md md-log" [innerHTML]="log.message | md"></div>
                    </div>
                  } @else if (log.type === 'client.narrate') {
                    <div class="rich-log narrate-card">
                      <div class="role-header role-narrate">Narration cue</div>
                      <div class="md md-log" [innerHTML]="log.message | md"></div>
                    </div>
                  } @else if (isObject(log.message)) {
                    <pre class="json-payload">{{ formatJson(log.message) }}</pre>
                  } @else {
                    <div class="md md-log" [innerHTML]="log.message | md"></div>
                  }
                </div>

                @if (log.count && log.count > 1) {
                  <span class="count-badge">{{ log.count }}</span>
                }
              </li>
            }
          </ul>
        }
      </div>

      <!-- Bottom Live Debug Prompt Bar (Adapted from gsans/gemini-3-live-angular side-panel input-container) -->
      <div class="logger-input-bar">
        <input
          type="text"
          [(ngModel)]="debugPrompt"
          (keydown.enter)="sendDebugPrompt()"
          placeholder="Send live debug text or narration cue to Gemini 3.8 Live (Enter to send)..."
          aria-label="Send live debug text or narration cue to Gemini 3.8 Live"
          class="debug-input"
        />
        <button
          type="button"
          class="debug-send-btn"
          [disabled]="!debugPrompt().trim()"
          (click)="sendDebugPrompt()"
        >
          Send text
        </button>
        <button
          type="button"
          class="debug-narrate-btn"
          [disabled]="!debugPrompt().trim()"
          (click)="sendDebugNarration()"
        >
          Test narration
        </button>
      </div>
    </div>
  `,
  styles: [
    `
      .logger-console {
        background-color: var(--ink-0);
        border: 1px solid var(--line);
        border-radius: var(--r-l);
        display: flex;
        flex-direction: column;
        overflow: hidden;
      }

      .logger-toolbar {
        display: flex;
        justify-content: space-between;
        align-items: center;
        padding: 8px 12px;
        background-color: var(--ink-1);
        border-bottom: 1px solid var(--line);
        gap: 10px;
        flex-wrap: wrap;
      }

      .logger-toolbar-left {
        display: flex;
        align-items: center;
        gap: 10px;
      }

      .console-title {
        font-size: 0.72rem;
        font-weight: 700;
        letter-spacing: 0.04em;
        color: var(--text);
        font-family: var(--font-mono); font-stretch: 85%;
      }

      .streaming-indicator {
        font-size: 0.72rem;
        font-family: var(--font-mono); font-stretch: 85%;
        padding: 2px 8px;
        border-radius: var(--r-s);
        background-color: var(--ink-2);
        color: var(--text-3);
        border: 1px solid var(--line);
      }

      .streaming-indicator.connected {
        color: var(--info);
        border-color: rgba(124, 196, 255, 0.45);
        background-color: rgba(124, 196, 255, 0.1);
      }

      .logger-toolbar-right {
        display: flex;
        align-items: center;
        gap: 6px;
        flex-wrap: wrap;
      }

      .filter-btn,
      .clear-btn {
        padding: 3px 8px;
        border-radius: var(--r-s);
        border: 1px solid var(--line);
        background-color: var(--ink-2);
        color: var(--text-2);
        font-size: 0.72rem;
        cursor: pointer;
        font-family: var(--font-mono); font-stretch: 85%;
      }

      .filter-btn.active {
        background-color: rgb(var(--primary-rgb) / 0.1);
        border-color: var(--primary);
        color: var(--primary);
        font-weight: 600;
      }

      .clear-btn:hover {
        color: var(--stop);
        border-color: rgba(255, 90, 71, 0.45);
      }

      .logger-list-container {
        max-height: 320px;
        min-height: 200px;
        overflow-y: auto;
        padding: 8px 12px;
      }

      .logger-empty {
        color: var(--text-3);
        font-size: 0.72rem;
        font-family: var(--font-mono); font-stretch: 85%;
        padding: 20px 4px;
      }

      .logger-list {
        list-style: none;
        margin: 0;
        padding: 0;
        display: grid;
        gap: 6px;
      }

      .log-row {
        display: flex;
        align-items: flex-start;
        gap: 10px;
        padding: 4px 6px;
        border-radius: var(--r-s);
        font-family: var(--font-mono); font-stretch: 85%;
        font-size: 0.72rem;
        line-height: 1.4;
        color: var(--text-2);
      }

      .log-row.source-client {
        color: var(--primary);
      }

      .log-row.source-server {
        color: var(--info);
      }

      .log-row.source-error {
        background-color: rgba(255, 90, 71, 0.1);
        border: 1px solid rgba(255, 90, 71, 0.45);
        color: var(--stop);
      }

      .timestamp {
        width: 68px;
        flex-shrink: 0;
        color: var(--text-3);
      }

      .source {
        min-width: 145px;
        flex-shrink: 0;
        font-weight: 700;
      }

      .message {
        flex-grow: 1;
        color: var(--text-2);
        word-break: break-word;
      }

      .count-badge {
        background-color: var(--ink-2);
        border: 1px solid var(--line-2);
        color: var(--primary);
        font-size: 0.72rem;
        font-weight: 700;
        padding: 1px 6px;
        border-radius: 999px;
        flex-shrink: 0;
      }

      .rich-log {
        padding: 6px 10px;
        border-radius: var(--r-m);
        background-color: var(--ink-1);
        border: 1px solid var(--line);
      }

      .user-card {
        border-left: 3px solid var(--primary);
      }

      .model-card {
        border-left: 3px solid var(--info);
      }

      .narrate-card {
        border-left: 3px solid var(--gate);
      }

      .role-header {
        font-size: 0.72rem;
        font-weight: 700;
        margin-bottom: 2px;
      }

      .role-user {
        color: var(--primary);
      }

      .role-model {
        color: var(--info);
      }

      .role-narrate {
        color: var(--gate);
      }

      .json-payload {
        margin: 0;
        padding: 6px 8px;
        background-color: var(--ink-1);
        border-radius: var(--r-s);
        font-size: 0.72rem;
        color: var(--info);
        overflow-x: auto;
      }

      .logger-input-bar {
        display: flex;
        gap: 8px;
        padding: 8px 12px;
        background-color: var(--ink-1);
        border-top: 1px solid var(--line);
      }

      .debug-input {
        flex: 1;
        padding: 6px 10px;
        border-radius: var(--r-s);
        background-color: var(--ink-0);
        border: 1px solid var(--line);
        color: var(--text);
        font-size: 0.72rem;
        font-family: var(--font-mono); font-stretch: 85%;
      }

      .debug-send-btn,
      .debug-narrate-btn {
        padding: 6px 10px;
        border-radius: var(--r-s);
        border: 1px solid var(--line-2);
        background-color: var(--ink-2);
        color: var(--text);
        font-size: 0.72rem;
        font-weight: 600;
        cursor: pointer;
      }

      .debug-narrate-btn {
        border-color: var(--gate);
        background-color: rgba(255, 176, 32, 0.1);
        color: var(--gate);
      }
    `,
  ],
})
export class LoggerComponent {
  logger = inject(LoggerService);
  liveAudio = inject(GeminiLiveAudioService);

  @ViewChild('scrollContainer') scrollContainer?: ElementRef<HTMLDivElement>;

  debugPrompt = signal<string>('');

  readonly filterOptions: Array<{ value: LoggerFilterType; label: string }> = [
    { value: 'all', label: 'All' },
    { value: 'conversations', label: 'Conversations' },
    { value: 'tools', label: 'Tools & Gates' },
    { value: 'errors', label: 'Errors' },
  ];

  constructor() {
    effect(() => {
      // Auto-scroll when logs update
      this.logger.filteredLogs();
      setTimeout(() => {
        const el = this.scrollContainer?.nativeElement;
        if (el) {
          el.scrollTop = el.scrollHeight;
        }
      }, 20);
    });
  }

  formatTime(d: Date): string {
    return d.toLocaleTimeString();
  }

  isObject(val: any): boolean {
    return val !== null && typeof val === 'object';
  }

  formatJson(val: any): string {
    try {
      return JSON.stringify(val, null, 2);
    } catch {
      return String(val);
    }
  }

  getLogClasses(log: StreamingLog): Record<string, boolean> {
    const t = log.type.toLowerCase();
    const isError = t.includes('error') || t.includes('interrupted') || t.includes('close');
    const isClient = t.startsWith('client') || t === 'user-transcript';
    const isServer = t.startsWith('server') || t === 'model-transcript';
    return {
      'source-error': isError,
      'source-client': !isError && isClient,
      'source-server': !isError && isServer,
    };
  }

  sendDebugPrompt(): void {
    const txt = this.debugPrompt().trim();
    if (!txt) return;
    this.liveAudio.sendTextCommand(txt);
    this.debugPrompt.set('');
  }

  sendDebugNarration(): void {
    const txt = this.debugPrompt().trim();
    if (!txt) return;
    this.liveAudio.narrate(txt, true);
    this.debugPrompt.set('');
  }
}
