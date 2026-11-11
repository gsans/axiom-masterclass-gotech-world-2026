/**
 * CopilotKit AG-UI In-Chat Experience Component (`<app-ag-ui-chat>`).
 *
 * Uses official `@ag-ui/core` + `@ag-ui/client` protocol semantics and `@ngrx/store` (`factoryFeature`)
 * to render an in-chat Generative UI experience alongside the Linear-style Mission Control views:
 *  - Live AG-UI Step Progress Pills (`STEP_STARTED` / `STEP_FINISHED`)
 *  - Inline Human-in-the-Loop Tool Call Card (`TOOL_CALL_START`: `mcp__axiom_gate__request_human_elicitation`
 *    modeling CopilotKit's `renderAndWaitForResponse` pattern with inline Approve / Promote / Reject buttons)
 *  - Inline Worktree Isolation Card & Stage 1/2 Verification + Unified Diff Card (`STATE_SNAPSHOT`)
 *  - Direct conversational Q&A powered by the Google GenAI Interactions API (`/api/interactions/query`)
 *    plus one-click or in-chat Worktree Run Dispatch (`/api/factory/run`).
 */

import { Component, EventEmitter, Output, inject, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { Store } from '@ngrx/store';
import { EventType, PROTOCOL_VERSION } from '@ag-ui/core';
import { factoryFeature } from './store/factory.reducer';
import { FactoryActions } from './store/factory.actions';

import { MarkdownPipe } from './markdown.pipe';

@Component({
  selector: 'app-ag-ui-chat',
  standalone: true,
  imports: [CommonModule, FormsModule, MarkdownPipe],
  template: `
    <div class="card chat">
      <div class="chat-bar between">
        <div class="row">
          <span class="tag">AG-UI v{{ protocolVersion }}</span>
          <span class="card-title">In-chat generative UI</span>
        </div>

        <div class="row">
          <span class="label">
            {{
              isWaitingForElicitation()
                ? 'Waiting for your decision'
                : isRunning()
                ? 'Streaming AG-UI SSE...'
                : 'Ready'
            }}
          </span>
          <button type="button" class="btn btn-sm" (click)="clearChat()">Clear thread</button>
        </div>
      </div>

      <div class="chips">
        <span class="label">Quick actions</span>
        <button
          type="button"
          class="chip"
          (click)="triggerQuickDispatch('Implement Cloud Run ADK service and write FACTORY_PROOF.md after MCP operator approval.')"
          [disabled]="isRunning()"
        >
          <svg class="i"><use href="#i-rocket" /></svg>
          Dispatch worktree run
        </button>
        <button
          type="button"
          class="chip"
          (click)="triggerWhiteboardInChat()"
          [disabled]="isRunning()"
        >
          <svg class="i"><use href="#i-presentation" /></svg>
          Synthesize whiteboard to PR
        </button>
        <button
          type="button"
          class="chip"
          (click)="askCopilotQuestion('Summarize the active FENCE-001 boundary state, token weather, and latest verification status.')"
        >
          <svg class="i"><use href="#i-brain" /></svg>
          Ask the copilot
        </button>
      </div>

      <div class="thread">
        @for (turn of chatThread(); track turn.id) {
          @if (turn.role === 'user') {
            <div class="msg-user">
              <div class="label">
                <span>Operator, {{ turn.shiftCode || 'chat' }}</span>
                <span>{{ turn.timestamp }}</span>
              </div>
              <div class="md" [innerHTML]="turn.text | md"></div>
            </div>
          }

          @if (turn.role === 'assistant') {
            <div class="msg-agent">
              <div class="between">
                <div class="row">
                  <span class="label" style="color: var(--primary)">Axiom agent</span>
                  @if (turn.shiftCode) {
                    <span class="tag">{{ turn.shiftCode }}</span>
                  }
                  @if (turn.model) {
                    <span class="label">{{ turn.model }}</span>
                  }
                </div>
                <span class="label">{{ turn.timestamp }}</span>
              </div>

              @if (turn.steps && turn.steps.length > 0) {
                <div class="tags">
                  @for (step of turn.steps; track step.name) {
                    <span class="step" [attr.data-tone]="step.status === 'FINISHED' ? 'go' : 'gate'">
                      <svg class="i"><use [attr.href]="step.status === 'FINISHED' ? '#i-check' : '#i-activity'" /></svg>
                      {{ step.label }}
                    </span>
                  }
                </div>
              }

              @if (turn.whiteboardPlan; as wb) {
                <div class="well wb-banner">
                  <div class="between">
                    <span class="label" style="color: var(--info)">Whiteboard to PR</span>
                    <span class="tag">Target: {{ wb.targetFile }}</span>
                  </div>
                  <div class="card-title">{{ wb.prTitle }}</div>
                  <div class="tags">
                    @for (comp of wb.detectedComponents; track comp) {
                      <span class="tag tag-info">{{ comp }}</span>
                    }
                  </div>
                </div>
              }

              @if (turn.snapshot?.worktree; as wt) {
                <div class="well between kv">
                  <span>Worktree: {{ wt.worktree_path }}</span>
                  <span class="branch">{{ wt.branch_name }} ({{ wt.base_commit }})</span>
                </div>
              }

              @if (turn.toolCall; as tc) {
                <div class="tool" [attr.data-tone]="tc.status === 'WAITING_FOR_SIGNAL' ? 'gate' : 'go'">
                  <div class="between">
                    <span class="label tone">
                      {{
                        tc.status === 'WAITING_FOR_SIGNAL'
                          ? 'AG-UI TOOL_CALL_START: renderAndWaitForResponse'
                          : 'AG-UI TOOL_CALL_RESULT: gate resolved'
                      }}
                    </span>
                    <span class="label">{{ tc.name }}</span>
                  </div>

                  <div class="gate-q">
                    “<span
                      class="md-inline"
                      [innerHTML]="(tc.question ||
                        turn.snapshot?.elicitation?.question ||
                        'Approve autonomous write inside isolated worktree?') | md: 'inline'"
                    ></span>”
                  </div>

                  @if (tc.status === 'WAITING_FOR_SIGNAL') {
                    <div class="decisions">
                      <button
                        type="button"
                        class="decision approve"
                        (click)="
                          resolveGate.emit({
                            decision: 'APPROVE',
                            source: 'AG_UI_COPILOT_CHAT',
                            notes: 'Approved inline via CopilotKit AG-UI Chat Card'
                          })
                        "
                      >
                        <b><svg class="i"><use href="#i-check" /></svg>Approve in chat</b>
                      </button>
                      <button
                        type="button"
                        class="decision promote"
                        (click)="
                          resolveGate.emit({
                            decision: 'PROMOTE_TO_SKILL',
                            source: 'AG_UI_COPILOT_CHAT',
                            notes: 'Promoted to Layer 1 Skill via CopilotKit AG-UI Chat Card'
                          })
                        "
                      >
                        <b><svg class="i"><use href="#i-zap" /></svg>Approve and promote</b>
                      </button>
                      <button
                        type="button"
                        class="decision reject"
                        (click)="
                          resolveGate.emit({
                            decision: 'REJECT_AND_HARDEN',
                            source: 'AG_UI_COPILOT_CHAT',
                            notes: 'Rejected & hardened FENCE-001 via CopilotKit AG-UI Chat Card'
                          })
                        "
                      >
                        <b><svg class="i"><use href="#i-lock" /></svg>Reject and harden</b>
                      </button>
                    </div>
                  } @else if (tc.resolution || turn.snapshot?.elicitation?.resolution; as res) {
                    <div class="resolved">
                      <svg class="i"><use href="#i-check" /></svg>
                      Decision: {{ res.decision }} (via {{ res.source }})
                    </div>
                  }
                </div>
              }

              @if (turn.text) {
                <div class="msg-text md" [innerHTML]="turn.text | md"></div>
              }

              @if (turn.snapshot?.verification; as v) {
                <div class="well oracles stack" [attr.data-tone]="v.verdict === 'PASS' ? 'go' : 'stop'">
                  <div class="between">
                    <span class="label tone">Stage 1 and 2 verification: {{ v.verdict }}, {{ v.score }}/100</span>
                    <span class="label">{{ v.provider }}</span>
                  </div>

                  <div class="body md" [innerHTML]="v.summary | md"></div>

                  @if (turn.snapshot?.diff) {
                    <details>
                      <summary>View unified git diff ({{ (turn.snapshot?.diff || '').split('\\n').length }} lines)</summary>
                      <pre class="diff">{{ turn.snapshot?.diff }}</pre>
                    </details>
                  }
                </div>
              }
            </div>
          }
        }
      </div>

      <div class="chat-input">
        <input
          type="text"
          class="input"
          [ngModel]="chatInput()"
          (ngModelChange)="chatInput.set($event)"
          (keydown.enter)="handleEnterSend()"
          placeholder="Message Axiom Copilot or describe a task to run in an isolated worktree..."
          aria-label="Message Axiom Copilot or dispatch an AG-UI worktree run"
        />

        <button
          type="button"
          class="btn btn-info"
          (click)="sendConversationalTurn()"
          [disabled]="!chatInput().trim() || askingCopilot()"
        >
          {{ askingCopilot() ? 'Thinking...' : 'Ask copilot' }}
        </button>

        <button
          type="button"
          class="btn btn-go"
          (click)="dispatchFromChatInput()"
          [disabled]="isRunning()"
        >
          <svg class="i"><use href="#i-rocket" /></svg>
          Run in worktree
        </button>
      </div>
    </div>
  `,
})
export class AgUiChatComponent {
  private readonly store = inject(Store);

  @Output() dispatchRun = new EventEmitter<string>();
  @Output() scanWhiteboard = new EventEmitter<void>();
  @Output() askCopilot = new EventEmitter<string>();
  @Output() resolveGate = new EventEmitter<{
    decision: string;
    source: string;
    notes: string;
  }>();

  readonly protocolVersion = PROTOCOL_VERSION || '0.1.0';
  readonly eventTypes = EventType;

  chatThread = this.store.selectSignal(factoryFeature.selectChatThread);
  isRunning = this.store.selectSignal(factoryFeature.selectIsRunning);
  isWaitingForElicitation = this.store.selectSignal(
    factoryFeature.selectIsWaitingForElicitation
  );
  taskPrompt = this.store.selectSignal(factoryFeature.selectTaskPrompt);

  chatInput = signal<string>('');
  askingCopilot = signal<boolean>(false);

  handleEnterSend(): void {
    const text = this.chatInput().trim();
    if (!text) return;
    if (
      text.toLowerCase().startsWith('implement ') ||
      text.toLowerCase().startsWith('create ') ||
      text.toLowerCase().startsWith('build ') ||
      text.toLowerCase().includes('worktree') ||
      text.toLowerCase().includes('pr')
    ) {
      this.dispatchFromChatInput();
    } else {
      this.sendConversationalTurn();
    }
  }

  sendConversationalTurn(): void {
    const prompt = this.chatInput().trim();
    if (!prompt) return;
    this.chatInput.set('');
    this.askCopilot.emit(prompt);
  }

  dispatchFromChatInput(): void {
    const prompt = this.chatInput().trim() || this.taskPrompt();
    this.chatInput.set('');
    this.dispatchRun.emit(prompt);
  }

  triggerQuickDispatch(prompt: string): void {
    this.dispatchRun.emit(prompt);
  }

  triggerWhiteboardInChat(): void {
    this.scanWhiteboard.emit();
  }

  askCopilotQuestion(prompt: string): void {
    this.askCopilot.emit(prompt);
  }

  clearChat(): void {
    this.store.dispatch(FactoryActions.clearChatThread());
  }
}
