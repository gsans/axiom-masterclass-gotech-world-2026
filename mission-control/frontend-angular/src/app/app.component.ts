import {
  Component,
  ElementRef,
  OnDestroy,
  OnInit,
  ViewChild,
  computed,
  inject,
  signal,
} from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { Store } from '@ngrx/store';
import { Subject, takeUntil } from 'rxjs';
import { GeminiLiveAudioService, GeminiLiveEnvelope } from './gemini-live-audio.service';
import { AudioPulseComponent } from './audio-pulse.component';
import { LoggerService } from './logger.service';
import { LoggerComponent } from './logger.component';
import { ScreenCaptureService } from './screen-capture.service';
import { WebcamService } from './webcam.service';
import { AgUiChatComponent } from './ag-ui-chat.component';
import {
  ActiveWorkspaceTab,
  AgUiChatTurn,
  BoundaryRule,
  DeterministicOraclesReport,
  ElicitationState,
  FactorySnapshot,
  FencesLedger,
  INBOX_SECTIONS,
  InboxItem,
  OracleCheck,
  TokenWeather,
  ToolboxConfig,
  TrustedSkill,
  VerificationReport,
  WhiteboardSynthesisPlan,
  WorktreeData,
} from './store/factory.models';
import { FactoryActions, ToolboxActions, WhiteboardActions } from './store/factory.actions';
import { factoryFeature } from './store/factory.reducer';

export type {
  ActiveWorkspaceTab,
  BoundaryRule,
  DeterministicOraclesReport,
  ElicitationState,
  FactorySnapshot,
  FencesLedger,
  InboxItem,
  OracleCheck,
  TokenWeather,
  ToolboxConfig,
  TrustedSkill,
  VerificationReport,
  WhiteboardSynthesisPlan,
  WorktreeData,
};

import { MarkdownPipe } from './markdown.pipe';
import { SCENARIOS, Scenario } from './scenarios';

@Component({
  selector: 'app-root',
  standalone: true,
  imports: [CommonModule, FormsModule, AudioPulseComponent, LoggerComponent, AgUiChatComponent, MarkdownPipe],
  templateUrl: './app.component.html',
  styleUrls: ['./app.component.css'],
})
export class AppComponent implements OnInit, OnDestroy {
  private readonly store = inject(Store);
  liveAudio = inject(GeminiLiveAudioService);
  logger = inject(LoggerService);
  webcamService = inject(WebcamService);
  screenCaptureService = inject(ScreenCaptureService);

  @ViewChild('myVideo') myVideoRef?: ElementRef<HTMLVideoElement>;
  @ViewChild('renderCanvas') renderCanvasRef?: ElementRef<HTMLCanvasElement>;

  // Browser hardware stream reference (non-serializable MediaStream stays local to component)
  activeVideoStream = signal<MediaStream | null>(null);
  private videoFrameTimer: any = null;
  private ngUnsubscribe = new Subject<void>();
  private lastNarratedPhase = '';

  // ============================================================================
  // NgRx Store Signal Selectors (`store.selectSignal`)
  // Adapted from https://github.com/gsans/gemini-3-live-angular NgRx Store pattern
  // ============================================================================
  whiteboardPlan = this.store.selectSignal(factoryFeature.selectWhiteboardPlan);
  whiteboardScanning = this.store.selectSignal(factoryFeature.selectWhiteboardScanning);
  whiteboardPreviewDataUrl = this.store.selectSignal(
    factoryFeature.selectWhiteboardPreviewDataUrl
  );

  targetRepo = this.store.selectSignal(factoryFeature.selectTargetRepo);
  taskPrompt = this.store.selectSignal(factoryFeature.selectTaskPrompt);
  snapshot = this.store.selectSignal(factoryFeature.selectSnapshot);
  streamedMarkdown = this.store.selectSignal(factoryFeature.selectStreamedMarkdown);
  agUiEvents = this.store.selectSignal(factoryFeature.selectAgUiEvents);
  chatThread = this.store.selectSignal(factoryFeature.selectChatThread);
  isRunning = this.store.selectSignal(factoryFeature.selectIsRunning);
  lastVoiceTranscript = this.store.selectSignal(factoryFeature.selectLastVoiceTranscript);

  selectedTaskId = this.store.selectSignal(factoryFeature.selectSelectedTaskId);
  activeTab = this.store.selectSignal(factoryFeature.selectActiveTab);
  showNewTaskComposer = this.store.selectSignal(factoryFeature.selectShowNewTaskComposer);
  shiftTaskCounter = this.store.selectSignal(factoryFeature.selectShiftTaskCounter);
  currentShiftCode = this.store.selectSignal(factoryFeature.selectCurrentShiftCode);

  toolbox = this.store.selectSignal(factoryFeature.selectToolbox);
  drawerOpen = this.store.selectSignal(factoryFeature.selectDrawerOpen);
  consoleDrawerOpen = this.store.selectSignal(factoryFeature.selectConsoleDrawerOpen);
  chaosInjectArmed = this.store.selectSignal(factoryFeature.selectChaosInjectArmed);
  inboxItems = this.store.selectSignal(factoryFeature.selectInboxItems);

  // Memoized extraSelectors from `factoryFeature`
  isWaitingForElicitation = this.store.selectSignal(
    factoryFeature.selectIsWaitingForElicitation
  );
  selectedInboxItem = this.store.selectSignal(factoryFeature.selectSelectedInboxItem);
  isViewingHistoricalTask = this.store.selectSignal(
    factoryFeature.selectIsViewingHistoricalTask
  );
  activePresetKey = this.store.selectSignal(factoryFeature.selectActivePresetKey);
  activePreset = this.store.selectSignal(factoryFeature.selectActivePreset);
  activeGateway = this.store.selectSignal(factoryFeature.selectActiveGateway);
  tokenWeather = this.store.selectSignal(factoryFeature.selectTokenWeather);
  activeFences = this.store.selectSignal(factoryFeature.selectActiveFences);
  activeShift = this.store.selectSignal(factoryFeature.selectActiveShift);
  activeLens = this.store.selectSignal(factoryFeature.selectActiveLens);
  boundaryRules = this.store.selectSignal(factoryFeature.selectBoundaryRules);
  trustedSkills = this.store.selectSignal(factoryFeature.selectTrustedSkills);

  readonly inboxSections = INBOX_SECTIONS;
  readonly objectKeys = Object.keys;

  isGeminiLiveConnected = computed(
    () => this.liveAudio.connectionState() === 'CONNECTED'
  );

  isGeminiLiveConnecting = computed(
    () => this.liveAudio.connectionState() === 'CONNECTING'
  );

  // ---- View-only helpers for the redesigned UI (derived from existing state) ----
  readonly scenarios = SCENARIOS;
  activeScenario = signal<Scenario | null>(null);

  runModels = computed(() => {
    const snap = this.snapshot();
    const configured = this.toolbox()?.activeModels;
    const mode = snap?.workerMode ?? '';
    const worker = mode.includes('(live)')
      ? 'Claude Code'
      : mode.includes('in-process')
      ? 'scripted, no model'
      : mode.includes('airgap')
      ? 'local model'
      : configured?.worker ?? 'checking...';
    const model = snap?.verification?.model;
    const reviewer =
      model === 'deterministic-ast-sec-oracle-v1'
        ? 'not needed, Stage 1 blocked it'
        : model ?? configured?.reviewer ?? 'checking...';
    return { worker, reviewer };
  });

  mandatePercent = computed(() => {
    const mandate = this.activeFences()?.mandate;
    const budget = mandate?.token_budget_usd ?? 50;
    return budget > 0 ? Math.min(100, ((mandate?.burn_usd ?? 4.12) / budget) * 100) : 0;
  });

  contextPercent = computed(() =>
    Math.min(100, ((this.tokenWeather()?.tokensUsed || 4200) / 150000) * 100)
  );

  phaseTone = computed<'idle' | 'run' | 'gate' | 'go' | 'stop'>(() => {
    const phase = this.snapshot()?.phase;
    if (!phase) return 'idle';
    if (phase === 'PAUSED_FOR_ELICITATION') return 'gate';
    if (phase === 'COMPLETED') return 'go';
    if (phase === 'BLOCKED_BY_VERIFIER' || phase === 'ERROR') return 'stop';
    return 'run';
  });

  phaseTitle = computed(() => {
    const titles: Record<string, string> = {
      INITIALIZING: 'Provisioning worktree',
      WORKTREE_READY: 'Worktree isolated',
      WORKER_RUNNING: 'Agent at work',
      PAUSED_FOR_ELICITATION: 'Waiting on a human',
      WORKER_RESUMED: 'Agent resumed',
      VERIFYING_DIFF: 'Checking the work',
      COMPLETED: 'Verified. Ready for review.',
      BLOCKED_BY_VERIFIER: 'Blocked by the verifier',
      ERROR: 'Run failed',
    };
    const phase = this.snapshot()?.phase;
    return phase ? titles[phase] ?? phase : 'Ready to dispatch';
  });

  pipeline = computed(() => {
    const names = ['Dispatch', 'Worktree', 'Agent', 'Human gate', 'Checks', 'Verdict'];
    const phase = this.snapshot()?.phase;
    const order: Record<string, number> = {
      INITIALIZING: 0,
      WORKTREE_READY: 1,
      WORKER_RUNNING: 2,
      PAUSED_FOR_ELICITATION: 3,
      WORKER_RESUMED: 4,
      VERIFYING_DIFF: 4,
      COMPLETED: 5,
      BLOCKED_BY_VERIFIER: 5,
      ERROR: 2,
    };
    const current = phase ? order[phase] ?? -1 : -1;
    return names.map((name, index) => {
      let state = 'idle';
      if (index < current) state = 'done';
      if (index === current) {
        state =
          phase === 'PAUSED_FOR_ELICITATION'
            ? 'gate'
            : phase === 'COMPLETED'
            ? 'done'
            : phase === 'BLOCKED_BY_VERIFIER' || phase === 'ERROR'
            ? 'fail'
            : 'active';
      }
      return { name, state };
    });
  });

  statusTone(status: InboxItem['status']): 'gate' | 'stop' | 'go' | 'run' {
    if (status === 'WAITING_FOR_SIGNAL') return 'gate';
    if (status === 'BLOCKED_BY_ORACLE') return 'stop';
    if (status === 'PASS') return 'go';
    return 'run';
  }

  diffLines(diff: string): Array<{ text: string; kind: string }> {
    return diff.split('\n').map((text) => ({
      text,
      kind:
        text.startsWith('@@')
          ? 'hunk'
          : text.startsWith('+') && !text.startsWith('+++')
          ? 'add'
          : text.startsWith('-') && !text.startsWith('---')
          ? 'del'
          : '',
    }));
  }

  ngOnInit(): void {
    fetch(`${this.getBackendUrl()}/api/toolbox/config`)
      .then((r) => r.json())
      .then((toolbox: ToolboxConfig) =>
        this.store.dispatch(ToolboxActions.configLoaded({ toolbox }))
      )
      .catch(() => {});
    this.liveAudio.fetchServerConfig(this.getBackendUrl());

    this.webcamService.stream$.pipe(takeUntil(this.ngUnsubscribe)).subscribe((stream) => {
      if (stream || !this.screenCaptureService.isStreaming) {
        this.changeActiveVideoStream(stream);
      }
    });

    this.screenCaptureService.stream$.pipe(takeUntil(this.ngUnsubscribe)).subscribe((stream) => {
      if (stream || !this.webcamService.isStreaming) {
        this.changeActiveVideoStream(stream);
      }
    });
  }

  ngOnDestroy(): void {
    this.ngUnsubscribe.next();
    this.ngUnsubscribe.complete();
    clearTimeout(this.videoFrameTimer);
    this.webcamService.stop();
    this.screenCaptureService.stop();
  }

  setTargetRepo(targetRepo: string): void {
    this.store.dispatch(FactoryActions.setTargetRepo({ targetRepo }));
  }

  setTaskPrompt(taskPrompt: string): void {
    this.activeScenario.set(null);
    this.store.dispatch(FactoryActions.setTaskPrompt({ taskPrompt }));
  }

  pickScenario(scenario: Scenario): void {
    this.activeScenario.set(scenario);
    this.store.dispatch(FactoryActions.setTaskPrompt({ taskPrompt: scenario.prompt }));
  }

  rollScenario(): void {
    const others = this.scenarios.filter((s) => s.id !== this.activeScenario()?.id);
    this.pickScenario(others[Math.floor(Math.random() * others.length)]);
  }

  changeActiveVideoStream(stream: MediaStream | null): void {
    if (this.activeVideoStream() !== stream) {
      this.activeVideoStream.set(stream);
      setTimeout(() => {
        const videoEl = this.myVideoRef?.nativeElement;
        if (videoEl) {
          videoEl.srcObject = stream;
          if (stream) {
            videoEl.play().catch(() => {});
          }
        }
        this.initVideoStream();
      });
    }
  }

  private initVideoStream(): void {
    clearTimeout(this.videoFrameTimer);
    if (this.isGeminiLiveConnected() && this.activeVideoStream()) {
      requestAnimationFrame(this.sendVideoFrame);
    }
  }

  async toggleWebCamStream(): Promise<void> {
    if (this.webcamService.isStreaming) {
      this.webcamService.stop();
      this.changeActiveVideoStream(null);
      this.pushAgEvent('📷 Webcam stream stopped');
    } else {
      if (this.screenCaptureService.isStreaming) {
        this.screenCaptureService.stop();
        this.changeActiveVideoStream(null);
      }
      const stream = await this.webcamService.start();
      this.changeActiveVideoStream(stream);
      if (stream) {
        this.pushAgEvent('📷 Webcam stream active (streaming JPEG frames to Gemini 3.8 Live)');
      }
    }
  }

  async toggleScreenCaptureStream(): Promise<void> {
    if (this.screenCaptureService.isStreaming) {
      this.screenCaptureService.stop();
      this.changeActiveVideoStream(null);
      this.pushAgEvent('🖥️ Screen capture stream stopped');
    } else {
      if (this.webcamService.isStreaming) {
        this.webcamService.stop();
        this.changeActiveVideoStream(null);
      }
      const stream = await this.screenCaptureService.start();
      this.changeActiveVideoStream(stream);
      if (stream) {
        this.pushAgEvent('🖥️ Screen capture active (streaming JPEG frames to Gemini 3.8 Live)');
      }
    }
  }

  private sendVideoFrame = (): void => {
    clearTimeout(this.videoFrameTimer);
    if (!this.webcamService.isStreaming && !this.screenCaptureService.isStreaming) {
      return;
    }

    const video = this.myVideoRef?.nativeElement;
    const canvas = this.renderCanvasRef?.nativeElement;
    const ctx = canvas?.getContext('2d');
    if (video && canvas && ctx) {
      canvas.width = video.videoWidth * 0.25;
      canvas.height = video.videoHeight * 0.25;

      if (canvas.width + canvas.height > 0) {
        ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
        const base64 = canvas.toDataURL('image/jpeg', 1.0);
        const data = base64.slice(base64.indexOf(',') + 1);
        this.liveAudio.sendRealtimeInput([{ mimeType: 'image/jpeg', data }]);
      }
    }

    if (this.isGeminiLiveConnected()) {
      this.videoFrameTimer = setTimeout(this.sendVideoFrame, 1000 / 0.5);
    }
  };

  getBackendUrl(): string {
    if (typeof window !== 'undefined') {
      return `${window.location.protocol}//${window.location.hostname}:8000`;
    }
    return 'http://localhost:8000';
  }

  pushAgEvent(label: string): void {
    const entry = `${new Date().toLocaleTimeString()} · ${label}`;
    this.store.dispatch(FactoryActions.pushAgEvent({ entry }));
    const isGateOrTool =
      label.includes('Gate') ||
      label.includes('Elicitation') ||
      label.includes('TOOL_CALL') ||
      label.includes('Dispatching') ||
      label.includes('STATE_SNAPSHOT');
    this.logger.log({
      type: isGateOrTool ? 'factory.gate' : 'factory.event',
      message: label,
    });
  }

  itemsForSection(statuses: InboxItem['status'][]): InboxItem[] {
    return this.inboxItems().filter((item) => statuses.includes(item.status));
  }

  selectTask(item: InboxItem): void {
    this.store.dispatch(
      FactoryActions.selectTask({
        taskId: item.id,
        activeTab: 'OVERVIEW_ELICITATION',
      })
    );
  }

  selectNewDispatch(): void {
    this.store.dispatch(FactoryActions.selectNewDispatch());
  }

  setTab(tab: ActiveWorkspaceTab): void {
    this.store.dispatch(FactoryActions.setActiveTab({ tab }));
  }

  statusDot(status: InboxItem['status']): { color: string; label: string } {
    if (status === 'WAITING_FOR_SIGNAL') return { color: '#f59e0b', label: 'Needs input' };
    if (status === 'BLOCKED_BY_ORACLE')
      return { color: '#ef4444', label: 'Soft-failed · next shift' };
    if (status === 'PASS') return { color: '#10b981', label: 'Ready for review' };
    return { color: '#6366f1', label: 'Working' };
  }

  async updateBackendToolbox(patch: {
    gateway_mode?: string;
    sponsor_preset?: string;
    hard_budget_usd?: number;
    active_shift?: string;
    active_lens?: string;
    reset_fences?: boolean;
  }): Promise<void> {
    try {
      const res = await fetch(`${this.getBackendUrl()}/api/toolbox/config`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(patch),
      });
      const data = await res.json();
      if (data.toolbox) {
        this.store.dispatch(ToolboxActions.configLoaded({ toolbox: data.toolbox }));
        this.pushAgEvent(
          `🎩 HUD -> Shift=${data.toolbox.fencesLedger?.active_shift} | Lens=${data.toolbox.fencesLedger?.active_lens} | Gateway=${data.toolbox.gatewayMode}`
        );
      }
    } catch (err: any) {
      this.pushAgEvent(`Toolbox error: ${err?.message}`);
    }
  }

  /**
   * Dedicated Gemini Live Connection Toggle (Green = Live Connected, Gray = Offline).
   * Uses pure 16kHz/24kHz PCM AudioWorklets over WebSocket to Gemini Live API (`v1beta`)
   * without falling back to browser Web Speech API.
   */
  async toggleGeminiLiveConnection(): Promise<void> {
    if (this.liveAudio.connectionState() !== 'DISCONNECTED') {
      if (this.screenCaptureService.isStreaming) {
        this.screenCaptureService.stop();
      }
      if (this.webcamService.isStreaming) {
        this.webcamService.stop();
      }
      this.changeActiveVideoStream(null);
      this.liveAudio.disconnect();
      this.pushAgEvent('🔌 Gemini Live AudioWorklet connection closed (Offline)');
      return;
    }

    await this.liveAudio.connect(this.getBackendUrl(), {
      lens: this.activeLens(),
      mandateId: this.activeFences()?.mandate?.id || 'MND-2027-Q4',
      onEvent: (msg: GeminiLiveEnvelope) => {
        if (msg.type === 'sessionReady') {
          this.pushAgEvent(
            `🟢 Gemini 3.8 Live Connected (${msg.model} · Voice: ${msg.voice} · ${msg.mode})`
          );
        }
        if (msg.interrupted) {
          this.pushAgEvent('🛑 Gemini 3.8 Live Barge-In Interruption (Audio buffer flushed)');
        }
        if (msg.inputTranscription?.text && msg.inputTranscription.finished) {
          this.store.dispatch(
            FactoryActions.setVoiceTranscript({
              transcript: msg.inputTranscription.text,
            })
          );
          this.pushAgEvent(`🗣️ Operator (16kHz PCM): "${msg.inputTranscription.text}"`);
        }
        if (msg.outputTranscription?.text && msg.outputTranscription.finished) {
          this.pushAgEvent(
            `🤖 Gemini Live (${this.liveAudio.selectedVoice()}): "${msg.outputTranscription.text}"`
          );
        }
        if (msg.voiceWorkflowCommand) {
          this.pushAgEvent(`🎙️ Voice Workflow Command -> ${msg.voiceWorkflowCommand}`);
          void this.handleVoiceWorkflowCommand(msg.voiceWorkflowCommand);
        }
        if (msg.voiceDecision) {
          const dec =
            typeof msg.voiceDecision === 'string'
              ? msg.voiceDecision
              : msg.voiceDecision.decision;
          const status =
            typeof msg.voiceDecision === 'object' ? msg.voiceDecision.status : undefined;
          this.pushAgEvent(`⚡ Gemini Live Gate Trigger -> ${dec} (${status || 'triggered'})`);
          if (this.isWaitingForElicitation() && status !== 'resumed') {
            void this.sendResumeSignal(
              dec,
              'GEMINI_3_8_LIVE_VOICE',
              `Voice command via Gemini 3.8 Live (${dec})`
            );
          }
        }
      },
    });
  }

  private captureCurrentVideoFrameDataUrl(): { dataUrl: string; mimeType: string } | null {
    const video = this.myVideoRef?.nativeElement;
    const canvas = this.renderCanvasRef?.nativeElement;
    const ctx = canvas?.getContext('2d');
    if (video && canvas && ctx && video.videoWidth > 0 && video.videoHeight > 0) {
      canvas.width = Math.max(320, Math.floor(video.videoWidth * 0.5));
      canvas.height = Math.max(240, Math.floor(video.videoHeight * 0.5));
      ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
      const dataUrl = canvas.toDataURL('image/jpeg', 0.92);
      return { dataUrl, mimeType: 'image/jpeg' };
    }
    if (this.whiteboardPreviewDataUrl()) {
      return { dataUrl: this.whiteboardPreviewDataUrl()!, mimeType: 'image/png' };
    }
    return null;
  }

  async onWhiteboardFileSelected(event: Event): Promise<void> {
    const input = event.target as HTMLInputElement;
    const file = input?.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => {
      const dataUrl = String(reader.result || '');
      if (dataUrl) {
        this.store.dispatch(WhiteboardActions.setPreviewDataUrl({ dataUrl }));
        this.store.dispatch(FactoryActions.setActiveTab({ tab: 'WHITEBOARD_TO_PR' }));
        void this.scanWhiteboardDiagram({
          autoDispatch: true,
          sourceLabel: `UPLOADED_IMAGE (${file.name})`,
          overrideDataUrl: dataUrl,
          overrideMimeType: file.type || 'image/png',
        });
      }
      input.value = '';
    };
    reader.readAsDataURL(file);
  }

  async scanWhiteboardDiagram(opts?: {
    autoDispatch?: boolean;
    sourceLabel?: string;
    overrideDataUrl?: string;
    overrideMimeType?: string;
  }): Promise<WhiteboardSynthesisPlan | null> {
    const autoDispatch = opts?.autoDispatch ?? true;
    this.store.dispatch(WhiteboardActions.scanStarted());

    const captured = opts?.overrideDataUrl
      ? { dataUrl: opts.overrideDataUrl, mimeType: opts.overrideMimeType || 'image/png' }
      : this.captureCurrentVideoFrameDataUrl();

    if (captured?.dataUrl) {
      this.store.dispatch(
        WhiteboardActions.setPreviewDataUrl({ dataUrl: captured.dataUrl })
      );
    }

    const activeSource =
      opts?.sourceLabel ||
      (this.screenCaptureService.isStreaming
        ? 'SCREEN_CAPTURE_TAB'
        : this.webcamService.isStreaming
        ? 'WEBCAM_OR_MOBILE_CAMERA'
        : captured
        ? 'UPLOADED_STAGE_FALLBACK'
        : 'VOICE_DIAGRAM_SEARCH');

    this.pushAgEvent(`📐 Scanning diagram from ${activeSource} via GenAI Interactions API...`);
    this.logger.log({
      type: 'client.whiteboardScan',
      message: `Synthesizing Whiteboard -> PR (source=${activeSource}, autoDispatch=${autoDispatch})`,
    });

    try {
      const res = await fetch(`${this.getBackendUrl()}/api/whiteboard/synthesize`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          image_base64: captured?.dataUrl || null,
          mime_type: captured?.mimeType || 'image/jpeg',
          source: activeSource,
        }),
      });
      const plan = (await res.json()) as WhiteboardSynthesisPlan;
      this.store.dispatch(WhiteboardActions.scanSucceeded({ plan }));
      this.pushAgEvent(
        `✨ Whiteboard Synthesized: "${plan.diagramTitle}" (${plan.detectedComponents.length} components) -> PR "${plan.prTitle}"`
      );
      if (!autoDispatch) {
        this.liveAudio.narrate(
          `Diagram found: ${plan.diagramTitle}. Extracted ${plan.detectedComponents.length} components.`
        );
      }
      if (autoDispatch) {
        await this.startFactoryRun();
      }
      return plan;
    } catch (err: any) {
      this.pushAgEvent(`Whiteboard scan error: ${err?.message || err}`);
      return null;
    } finally {
      this.store.dispatch(WhiteboardActions.scanFinished());
    }
  }

  async dispatchWhiteboardToPr(): Promise<void> {
    if (!this.whiteboardPlan()) {
      await this.scanWhiteboardDiagram({ autoDispatch: true });
      return;
    }
    const plan = this.whiteboardPlan()!;
    this.store.dispatch(FactoryActions.setTaskPrompt({ taskPrompt: plan.taskPrompt }));
    await this.startFactoryRun();
  }

  private async handleVoiceWorkflowCommand(cmd: string): Promise<void> {
    if (cmd === 'SCAN_WHITEBOARD' || cmd === 'WHITEBOARD_TO_PR_DISPATCH') {
      await this.scanWhiteboardDiagram({
        autoDispatch: true,
        sourceLabel: 'VOICE_WHITEBOARD_TO_PR_DISPATCH',
      });
    } else if (cmd === 'DISPATCH_RUN') {
      if (!this.isRunning()) {
        await this.startFactoryRun();
      }
    }
  }

  async sendVoicePromptOverGeminiLive(commandText: string): Promise<void> {
    if (this.liveAudio.connectionState() === 'CONNECTED') {
      this.liveAudio.sendTextCommand(commandText);
    } else {
      await this.sendResumeSignal('APPROVE', 'GEMINI_LIVE_QUICK_ACTION', commandText);
    }
  }

  async sendResumeSignal(decision: string, source: string, notes: string): Promise<void> {
    try {
      const res = await fetch(`${this.getBackendUrl()}/api/elicitation/resume`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          run_id: this.snapshot()?.runId ?? null,
          decision,
          source,
          notes,
        }),
      });
      const data = await res.json();
      if (data.fencesLedger) {
        this.store.dispatch(
          ToolboxActions.fencesLedgerUpdated({ fencesLedger: data.fencesLedger })
        );
      }
      this.pushAgEvent(`Elicitation Signal Sent (${decision} via ${source}) -> ${data.status}`);
      if (!source.toUpperCase().includes('GEMINI')) {
        const spokenMap: Record<string, string> = {
          APPROVE: `Approved exception for ${this.currentShiftCode()}. Resuming worktree lane.`,
          PROMOTE_TO_SKILL: `Promoting Layer 2 trace from ${this.currentShiftCode()} into a Layer 1 trusted skill.`,
          REJECT_AND_HARDEN: `Rejected ${this.currentShiftCode()} and hardened FENCE-001 into a permanent lock.`,
        };
        this.liveAudio.narrate(spokenMap[decision] || `Decision ${decision} applied.`);
      }
    } catch (err: any) {
      this.pushAgEvent(`Resume error: ${err?.message}`);
    }
  }

  private computeNextShiftTaskCode(): { shortCode: string; longLabel: string } {
    const nextIdx = this.shiftTaskCounter() + 1;
    const numStr = String(nextIdx).padStart(2, '0');
    const now = new Date();
    const monthInitial = now.toLocaleString('en-US', { month: 'short' }).charAt(0).toUpperCase();
    const monthShort = now.toLocaleString('en-US', { month: 'short' });
    const day = now.getDate();
    const shift = this.activeShift();
    const shiftLetter =
      shift === 'SHIFT_2_SWING' ? 'B' : shift === 'SHIFT_3_NIGHT' ? 'C' : 'A';
    const shiftWord =
      shift === 'SHIFT_2_SWING'
        ? 'Swing'
        : shift === 'SHIFT_3_NIGHT'
        ? 'Night'
        : 'Morning';
    return {
      shortCode: `${monthInitial}${day}-${shiftLetter}-${numStr}`,
      longLabel: `${monthShort}${day}-${shiftWord}-${numStr}`,
    };
  }

  async startFactoryRun(overrideChaos?: boolean, opts?: { keepActiveTab?: boolean }): Promise<void> {
    this.lastNarratedPhase = '';
    if (!this.taskPrompt().trim()) {
      this.store.dispatch(FactoryActions.setTaskPrompt({ taskPrompt: SCENARIOS[0].prompt }));
    }
    const { shortCode, longLabel } = this.computeNextShiftTaskCode();
    const runId = `run-${Math.random().toString(36).slice(2, 7)}`;
    const threadId = `thread-${Math.random().toString(36).slice(2, 7)}`;
    const useChaos = overrideChaos !== undefined ? overrideChaos : this.chaosInjectArmed();
    const wbPlan = this.whiteboardPlan();
    const matchedWbPlan =
      wbPlan && wbPlan.taskPrompt === this.taskPrompt() ? wbPlan : null;

    this.store.dispatch(
      FactoryActions.dispatchRunStarted({
        shortCode,
        runId,
        prompt: this.taskPrompt(),
        whiteboardPlan: matchedWbPlan,
        keepActiveTab: opts?.keepActiveTab ?? this.activeTab() === 'AGUI_CHAT',
      })
    );

    const briefSummary = useChaos
      ? 'Red-team chaos probe inside isolated worktree'
      : this.taskPrompt().split('.')[0].slice(0, 68);
    this.pushAgEvent(`📢 Dispatching ${shortCode} (${longLabel}) · ${briefSummary}`);
    this.logger.log({
      type: 'client.narrate',
      message: `Running ${shortCode} (${longLabel}) · ${briefSummary}`,
    });

    try {
      const response = await fetch(`${this.getBackendUrl()}/api/factory/run`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Accept: 'text/event-stream',
        },
        body: JSON.stringify({
          runId,
          threadId,
          messages: [{ id: 'u-1', role: 'user', content: this.taskPrompt() }],
          context: [
            { description: 'targetRepoPath', value: this.targetRepo() },
            {
              description: 'chaosMode',
              value: useChaos ? 'REDTEAM_PAYLOAD' : this.activeScenario()?.probe ?? '',
            },
            {
              description: 'whiteboardPlan',
              value: matchedWbPlan ? JSON.stringify(matchedWbPlan) : '',
            },
          ],
        }),
      });

      if (!response.body) {
        throw new Error('SSE stream body not available');
      }

      const reader = response.body.getReader();
      const decoder = new TextDecoder();
      let buffer = '';

      while (true) {
        const { value, done } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split('\n');
        buffer = lines.pop() || '';

        for (const rawLine of lines) {
          const line = rawLine.trim();
          if (!line.startsWith('data: ')) continue;
          const jsonStr = line.slice(6);
          try {
            const ev = JSON.parse(jsonStr);
            this.handleAgUiSseEvent(ev);
          } catch {
            // Ignore malformed SSE frame
          }
        }
      }
    } catch (err: any) {
      this.pushAgEvent(`Stream Notice: ${err?.message || 'Completed'}`);
    } finally {
      this.store.dispatch(FactoryActions.dispatchRunFinished());
      const phase = this.snapshot()?.phase;
      if (phase === 'COMPLETED' || phase === 'BLOCKED_BY_VERIFIER') {
        this.setTaskPrompt('');
      }
    }
  }

  async handleChatDispatch(prompt: string): Promise<void> {
    if (prompt.trim()) {
      this.store.dispatch(FactoryActions.setTaskPrompt({ taskPrompt: prompt.trim() }));
    }
    this.store.dispatch(FactoryActions.setActiveTab({ tab: 'AGUI_CHAT' }));
    await this.startFactoryRun(undefined, { keepActiveTab: true });
  }

  async handleChatWhiteboardScan(): Promise<void> {
    const plan = await this.scanWhiteboardDiagram({ autoDispatch: false });
    this.store.dispatch(FactoryActions.setActiveTab({ tab: 'AGUI_CHAT' }));
    if (plan) {
      await this.startFactoryRun(undefined, { keepActiveTab: true });
    }
  }

  async handleAskCopilot(prompt: string): Promise<void> {
    const nowTime = new Date().toLocaleTimeString();
    const userTurn: AgUiChatTurn = {
      id: `chat-u-${Date.now()}`,
      role: 'user',
      timestamp: nowTime,
      text: prompt,
    };
    this.store.dispatch(FactoryActions.appendChatTurn({ turn: userTurn }));

    try {
      const res = await fetch(`${this.getBackendUrl()}/api/interactions/query`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ prompt }),
      });
      const data = await res.json();
      const assistantTurn: AgUiChatTurn = {
        id: data.id || `chat-a-${Date.now()}`,
        role: 'assistant',
        timestamp: new Date().toLocaleTimeString(),
        model: `${data.model || 'gemini-3.8-flash'} (GenAI Interactions API)`,
        interactionId: data.id,
        text: data.outputText || 'Completed.',
      };
      this.store.dispatch(FactoryActions.appendChatTurn({ turn: assistantTurn }));
      this.pushAgEvent(`💬 Copilot Interaction (${data.id?.slice(0, 14)}...) completed`);
    } catch (err: any) {
      this.store.dispatch(
        FactoryActions.appendChatTurn({
          turn: {
            id: `chat-err-${Date.now()}`,
            role: 'assistant',
            timestamp: new Date().toLocaleTimeString(),
            text: `Error querying GenAI Interactions API: ${err?.message || err}`,
          },
        })
      );
    }
  }

  private handleAgUiSseEvent(ev: any): void {
    switch (ev.type) {
      case 'RUN_STARTED':
        this.pushAgEvent('RUN_STARTED');
        break;
      case 'STEP_STARTED':
        this.store.dispatch(FactoryActions.stepStarted({ stepName: ev.stepName }));
        this.pushAgEvent(`STEP_STARTED · ${ev.stepName}`);
        break;
      case 'STEP_FINISHED':
        this.store.dispatch(FactoryActions.stepFinished({ stepName: ev.stepName }));
        this.pushAgEvent(`STEP_FINISHED · ${ev.stepName}`);
        break;
      case 'TOOL_CALL_START':
        this.store.dispatch(
          FactoryActions.toolCallStarted({
            toolCallId: ev.toolCallId || 'tc-elicit',
            toolCallName: ev.toolCallName || 'mcp__axiom_gate__request_human_elicitation',
          })
        );
        this.pushAgEvent(`TOOL_CALL_START · ${ev.toolCallName}`);
        break;
      case 'TOOL_CALL_END':
        this.store.dispatch(FactoryActions.toolCallEnded({ toolCallId: ev.toolCallId }));
        this.pushAgEvent('TOOL_CALL_END');
        break;
      case 'STATE_SNAPSHOT':
        if (ev.snapshot) {
          const snap = ev.snapshot as FactorySnapshot;
          this.store.dispatch(FactoryActions.snapshotReceived({ snapshot: snap }));
          this.narrateSnapshotTransition(snap);
        }
        this.pushAgEvent(`STATE_SNAPSHOT · ${ev.snapshot?.phase}`);
        break;
      case 'TEXT_MESSAGE_CONTENT':
        if (ev.delta) {
          this.store.dispatch(
            FactoryActions.appendStreamedMarkdown({ delta: ev.delta })
          );
        }
        break;
      case 'RUN_FINISHED':
        this.pushAgEvent('RUN_FINISHED');
        break;
    }
  }

  private narrateSnapshotTransition(snap: FactorySnapshot): void {
    const code = this.currentShiftCode();
    const briefSummary = snap.chaosMode
      ? 'Red-team chaos probe'
      : this.taskPrompt().split('.')[0].slice(0, 56);
    if (
      snap.elicitation?.status === 'WAITING_FOR_SIGNAL' &&
      this.lastNarratedPhase !== 'WAITING_FOR_SIGNAL'
    ) {
      this.lastNarratedPhase = 'WAITING_FOR_SIGNAL';
      this.liveAudio.narrate(
        `Running ${code}: ${briefSummary}. Paused on boundary gate, awaiting operator decision.`
      );
      return;
    }

    if (
      (snap.phase === 'COMPLETED' || snap.phase === 'BLOCKED_BY_VERIFIER') &&
      this.lastNarratedPhase !== snap.phase
    ) {
      const hadGateNarration = this.lastNarratedPhase === 'WAITING_FOR_SIGNAL';
      this.lastNarratedPhase = snap.phase;
      const prefix = hadGateNarration ? `${code}` : `Running ${code}: ${briefSummary}. ${code}`;
      const verdict = snap.verification?.verdict || snap.phase;
      const cue =
        verdict === 'PASS'
          ? `${prefix} completed. Verification passed with score ${snap.verification?.score ?? 96}.`
          : verdict === 'BLOCKED_BY_ORACLE'
          ? `Alert: ${prefix} blocked at Stage 1 deterministic oracle. Zero tokens spent.`
          : `${prefix} finished with status ${verdict}.`;

      const resolvedByVoice = snap.elicitation?.resolution?.source
        ?.toUpperCase()
        .includes('GEMINI');
      if (resolvedByVoice) {
        setTimeout(() => this.liveAudio.narrate(cue), 2200);
      } else {
        this.liveAudio.narrate(cue);
      }
    }
  }

  toggleDrawer(): void {
    this.store.dispatch(FactoryActions.toggleDrawer());
  }

  toggleConsoleDrawer(): void {
    this.store.dispatch(FactoryActions.toggleConsoleDrawer());
  }

  toggleChaosArmed(): void {
    this.store.dispatch(FactoryActions.toggleChaosArmed());
  }
}
