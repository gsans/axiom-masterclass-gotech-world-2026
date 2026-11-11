/**
 * NgRx Feature Reducer (`factoryFeature`) for Axiom Mission Control.
 *
 * Follows the `createFeature` + `createReducer` + `extraSelectors` pattern from
 * https://github.com/gsans/gemini-3-live-angular/blob/js-genai/src/app/logging/logger-reducer.ts
 */

import { createFeature, createReducer, createSelector, on } from '@ngrx/store';
import {
  ActiveWorkspaceTab,
  AgUiChatTurn,
  AgUiStepPill,
  BoundaryRule,
  DEFAULT_BOUNDARY_RULES,
  DEFAULT_TRUSTED_SKILLS,
  FactorySnapshot,
  INITIAL_NIGHT_SHIFT_INBOX,
  InboxItem,
  SPONSOR_PRESET_LABELS,
  ToolboxConfig,
  TrustedSkill,
  WhiteboardSynthesisPlan,
} from './factory.models';
import { FactoryActions, ToolboxActions, WhiteboardActions } from './factory.actions';

export interface FactoryState {
  targetRepo: string;
  taskPrompt: string;
  snapshot: FactorySnapshot | null;
  streamedMarkdown: string;
  agUiEvents: string[];
  chatThread: AgUiChatTurn[];
  isRunning: boolean;
  lastVoiceTranscript: string | null;
  selectedTaskId: string;
  activeTab: ActiveWorkspaceTab;
  showNewTaskComposer: boolean;
  shiftTaskCounter: number;
  currentShiftCode: string;
  toolbox: ToolboxConfig | null;
  drawerOpen: boolean;
  consoleDrawerOpen: boolean;
  chaosInjectArmed: boolean;
  inboxItems: InboxItem[];
  whiteboardPlan: WhiteboardSynthesisPlan | null;
  whiteboardScanning: boolean;
  whiteboardPreviewDataUrl: string | null;
}

const STEP_LABELS: Record<string, string> = {
  worktree_isolation: '1. Isolated Git Worktree',
  claude_worker_execution: '2. Worker + MCP Gate',
  codex_adversarial_verification: '3. Stage 1/2 Diff Verifier',
};

const INITIAL_CHAT_THREAD: AgUiChatTurn[] = [
  {
    id: 'welcome-agui-1',
    role: 'assistant',
    timestamp: 'READY',
    model: 'gemini-3.8-flash (AG-UI Protocol)',
    text:
      'Welcome to the **CopilotKit AG-UI In-Chat Experience**. Every run streams live `@ag-ui/core` protocol events (`STEP_STARTED`, `TOOL_CALL_START`, `STATE_SNAPSHOT`, `TEXT_MESSAGE_CONTENT`) directly into this conversation with interactive Human-in-the-Loop approval cards (`renderAndWaitForResponse`) and inline diff verification.',
  },
];

export const initialFactoryState: FactoryState = {
  targetRepo: './sample-repo',
  taskPrompt:
    'Create FACTORY_PROOF.md in the isolated sibling worktree after pausing on the in-process MCP elicitation gate.',
  snapshot: null,
  streamedMarkdown: '',
  agUiEvents: [],
  chatThread: INITIAL_CHAT_THREAD,
  isRunning: false,
  lastVoiceTranscript: null,
  selectedTaskId: 'LIVE_DISPATCH',
  activeTab: 'OVERVIEW_ELICITATION',
  showNewTaskComposer: true,
  shiftTaskCounter: 0,
  currentShiftCode: 'N6-A-01',
  toolbox: null,
  drawerOpen: false,
  consoleDrawerOpen: false,
  chaosInjectArmed: false,
  inboxItems: INITIAL_NIGHT_SHIFT_INBOX,
  whiteboardPlan: null,
  whiteboardScanning: false,
  whiteboardPreviewDataUrl: null,
};

function computeLiveInboxItem(
  snap: FactorySnapshot,
  currentShiftCode: string,
  taskPrompt: string
): InboxItem {
  const statusMap: InboxItem['status'] =
    snap.elicitation?.status === 'WAITING_FOR_SIGNAL'
      ? 'WAITING_FOR_SIGNAL'
      : snap.verification?.verdict === 'BLOCKED_BY_ORACLE' ||
        snap.verification?.verdict === 'DEFERRED' ||
        snap.verification?.verdict === 'FAIL'
      ? 'BLOCKED_BY_ORACLE'
      : snap.phase === 'COMPLETED'
      ? 'PASS'
      : 'RUNNING';

  return {
    id: snap.runId,
    code: currentShiftCode || `AXM-${snap.runId.slice(-4).toUpperCase()}`,
    title: snap.chaosMode === 'REDTEAM_PAYLOAD'
      ? 'Red-Team Chaos Probe: compromised_hook.py'
      : taskPrompt.slice(0, 62),
    branch: snap.worktree?.branch_name || `factory/${snap.runId}-builder`,
    shift: 'DAY_SHIFT',
    status: statusMap,
    score: snap.verification?.score,
    hash: snap.verification?.deterministicOracles?.evidenceHash?.slice(0, 15),
    updatedAt: 'LIVE',
    summary: snap.verification?.summary,
    diffPreview: snap.diff,
  };
}

function updateActiveAssistantTurn(
  chatThread: AgUiChatTurn[],
  updater: (turn: AgUiChatTurn) => AgUiChatTurn
): AgUiChatTurn[] {
  for (let i = chatThread.length - 1; i >= 0; i--) {
    if (chatThread[i].role === 'assistant' && chatThread[i].runId) {
      const updated = [...chatThread];
      updated[i] = updater(chatThread[i]);
      return updated;
    }
  }
  return chatThread;
}

export const factoryFeature = createFeature({
  name: 'factory',
  reducer: createReducer(
    initialFactoryState,

    // --- Core Factory & Worktree Run Actions ---
    on(FactoryActions.setTargetRepo, (state, { targetRepo }) => ({
      ...state,
      targetRepo,
    })),
    on(FactoryActions.setTaskPrompt, (state, { taskPrompt }) => ({
      ...state,
      taskPrompt,
    })),
    on(
      FactoryActions.dispatchRunStarted,
      (state, { shortCode, runId, prompt, whiteboardPlan, keepActiveTab }) => {
        const nowTime = new Date().toLocaleTimeString();
        const effectivePrompt = prompt || state.taskPrompt;
        const effectiveRunId = runId || `run-${shortCode.toLowerCase()}`;
        const userTurn: AgUiChatTurn = {
          id: `user-${effectiveRunId}`,
          role: 'user',
          timestamp: nowTime,
          shiftCode: shortCode,
          text: effectivePrompt,
          whiteboardPlan: whiteboardPlan ?? null,
        };
        const assistantTurn: AgUiChatTurn = {
          id: `assistant-${effectiveRunId}`,
          role: 'assistant',
          timestamp: nowTime,
          runId: effectiveRunId,
          shiftCode: shortCode,
          model: 'AG-UI Worktree Orchestrator',
          text: '',
          steps: [],
          snapshot: null,
          whiteboardPlan: whiteboardPlan ?? null,
        };
        return {
          ...state,
          isRunning: true,
          streamedMarkdown: '',
          agUiEvents: [],
          activeTab: keepActiveTab ? state.activeTab : 'OVERVIEW_ELICITATION',
          shiftTaskCounter: state.shiftTaskCounter + 1,
          currentShiftCode: shortCode,
          chatThread: [...state.chatThread, userTurn, assistantTurn],
        };
      }
    ),
    on(FactoryActions.dispatchRunFinished, (state) => ({
      ...state,
      isRunning: false,
    })),
    on(FactoryActions.stepStarted, (state, { stepName }) => ({
      ...state,
      chatThread: updateActiveAssistantTurn(state.chatThread, (turn) => {
        const existing = turn.steps || [];
        const label = STEP_LABELS[stepName] || stepName;
        const nextSteps: AgUiStepPill[] = [
          ...existing.filter((s) => s.name !== stepName),
          { name: stepName, label, status: 'RUNNING' },
        ];
        return { ...turn, steps: nextSteps };
      }),
    })),
    on(FactoryActions.stepFinished, (state, { stepName }) => ({
      ...state,
      chatThread: updateActiveAssistantTurn(state.chatThread, (turn) => {
        const existing = turn.steps || [];
        const label = STEP_LABELS[stepName] || stepName;
        const hasStep = existing.some((s) => s.name === stepName);
        const nextSteps: AgUiStepPill[] = hasStep
          ? existing.map((s) =>
              s.name === stepName ? { ...s, status: 'FINISHED' as const } : s
            )
          : [...existing, { name: stepName, label, status: 'FINISHED' }];
        return { ...turn, steps: nextSteps };
      }),
    })),
    on(FactoryActions.toolCallStarted, (state, { toolCallId, toolCallName }) => ({
      ...state,
      chatThread: updateActiveAssistantTurn(state.chatThread, (turn) => ({
        ...turn,
        toolCall: {
          id: toolCallId,
          name: toolCallName,
          status: 'WAITING_FOR_SIGNAL',
          question: state.snapshot?.elicitation?.question || null,
        },
      })),
    })),
    on(FactoryActions.toolCallEnded, (state) => ({
      ...state,
      chatThread: updateActiveAssistantTurn(state.chatThread, (turn) =>
        turn.toolCall
          ? {
              ...turn,
              toolCall: {
                ...turn.toolCall,
                status: 'RESOLVED',
                resolution: state.snapshot?.elicitation?.resolution || null,
              },
            }
          : turn
      ),
    })),
    on(FactoryActions.snapshotReceived, (state, { snapshot }) => {
      const liveItem = computeLiveInboxItem(
        snapshot,
        state.currentShiftCode,
        state.taskPrompt
      );
      return {
        ...state,
        snapshot,
        selectedTaskId: snapshot.runId,
        inboxItems: [
          liveItem,
          ...state.inboxItems.filter((item) => item.id !== snapshot.runId),
        ],
        chatThread: updateActiveAssistantTurn(state.chatThread, (turn) => ({
          ...turn,
          snapshot,
          toolCall:
            snapshot.elicitation?.status !== 'IDLE'
              ? {
                  id:
                    snapshot.elicitation?.toolCallId ||
                    turn.toolCall?.id ||
                    'tc-elicit',
                  name:
                    turn.toolCall?.name ||
                    'mcp__axiom_gate__request_human_elicitation',
                  status:
                    snapshot.elicitation?.status === 'WAITING_FOR_SIGNAL'
                      ? 'WAITING_FOR_SIGNAL'
                      : 'RESOLVED',
                  question: snapshot.elicitation?.question,
                  resolution: snapshot.elicitation?.resolution,
                }
              : turn.toolCall,
        })),
      };
    }),
    on(FactoryActions.appendStreamedMarkdown, (state, { delta }) => ({
      ...state,
      streamedMarkdown: state.streamedMarkdown + delta,
      chatThread: updateActiveAssistantTurn(state.chatThread, (turn) => ({
        ...turn,
        text: turn.text + delta,
      })),
    })),
    on(FactoryActions.appendChatTurn, (state, { turn }) => ({
      ...state,
      chatThread: [...state.chatThread, turn],
    })),
    on(FactoryActions.clearChatThread, (state) => ({
      ...state,
      chatThread: INITIAL_CHAT_THREAD,
    })),
    on(FactoryActions.pushAgEvent, (state, { entry }) => ({
      ...state,
      agUiEvents: [...state.agUiEvents.slice(-24), entry],
    })),
    on(FactoryActions.setVoiceTranscript, (state, { transcript }) => ({
      ...state,
      lastVoiceTranscript: transcript,
    })),
    on(FactoryActions.selectTask, (state, { taskId, activeTab }) => ({
      ...state,
      selectedTaskId: taskId,
      activeTab,
    })),
    on(FactoryActions.selectNewDispatch, (state) => ({
      ...state,
      selectedTaskId: 'LIVE_DISPATCH',
      showNewTaskComposer: true,
      activeTab: 'OVERVIEW_ELICITATION',
    })),
    on(FactoryActions.setActiveTab, (state, { tab }) => ({
      ...state,
      activeTab: tab,
    })),
    on(FactoryActions.toggleDrawer, (state) => ({
      ...state,
      drawerOpen: !state.drawerOpen,
    })),
    on(FactoryActions.toggleConsoleDrawer, (state) => ({
      ...state,
      consoleDrawerOpen: !state.consoleDrawerOpen,
    })),
    on(FactoryActions.toggleChaosArmed, (state) => ({
      ...state,
      chaosInjectArmed: !state.chaosInjectArmed,
    })),

    // --- Whiteboard-to-PR Synthesis Actions ---
    on(WhiteboardActions.setPreviewDataUrl, (state, { dataUrl }) => ({
      ...state,
      whiteboardPreviewDataUrl: dataUrl,
    })),
    on(WhiteboardActions.scanStarted, (state) => ({
      ...state,
      activeTab: 'WHITEBOARD_TO_PR',
      whiteboardScanning: true,
    })),
    on(WhiteboardActions.scanSucceeded, (state, { plan }) => ({
      ...state,
      whiteboardPlan: plan,
      taskPrompt: plan.taskPrompt || state.taskPrompt,
    })),
    on(WhiteboardActions.scanFinished, (state) => ({
      ...state,
      whiteboardScanning: false,
    })),

    // --- CTO Toolbox & Governance Ledger Actions ---
    on(ToolboxActions.configLoaded, (state, { toolbox }) => ({
      ...state,
      toolbox,
    })),
    on(ToolboxActions.fencesLedgerUpdated, (state, { fencesLedger }) => ({
      ...state,
      toolbox: state.toolbox ? { ...state.toolbox, fencesLedger } : state.toolbox,
    }))
  ),
  extraSelectors: ({
    selectSnapshot,
    selectSelectedTaskId,
    selectInboxItems,
    selectToolbox,
  }) => {
    const selectIsWaitingForElicitation = createSelector(
      selectSnapshot,
      (snap) => snap?.elicitation?.status === 'WAITING_FOR_SIGNAL'
    );

    const selectSelectedInboxItem = createSelector(
      selectSelectedTaskId,
      selectSnapshot,
      selectInboxItems,
      (id, snap, items) => {
        if (id === 'LIVE_DISPATCH') {
          if (!snap) return null;
          return items.find((i) => i.id === snap.runId) || null;
        }
        return items.find((i) => i.id === id) || null;
      }
    );

    const selectIsViewingHistoricalTask = createSelector(
      selectSelectedTaskId,
      selectSnapshot,
      (id, snap) => id !== 'LIVE_DISPATCH' && id !== snap?.runId
    );

    const selectActivePresetKey = createSelector(
      selectSnapshot,
      selectToolbox,
      (snap, toolbox) =>
        snap?.sponsorPreset || toolbox?.sponsorPreset || 'DEFAULT_CLAUDE_CODEX'
    );

    const selectActivePreset = createSelector(
      selectActivePresetKey,
      (key) => SPONSOR_PRESET_LABELS[key] || SPONSOR_PRESET_LABELS['DEFAULT_CLAUDE_CODEX']
    );

    const selectActiveGateway = createSelector(
      selectSnapshot,
      selectToolbox,
      (snap, toolbox) => snap?.gatewayMode || toolbox?.gatewayMode || 'CLOUD_PRIMARY'
    );

    const selectTokenWeather = createSelector(
      selectSnapshot,
      (snap) => snap?.tokenWeather
    );

    const selectActiveFences = createSelector(
      selectSnapshot,
      selectToolbox,
      (snap, toolbox) => snap?.fencesLedger || toolbox?.fencesLedger
    );

    const selectActiveShift = createSelector(
      selectActiveFences,
      (fences) => fences?.active_shift || 'SHIFT_1_DAY'
    );

    const selectActiveLens = createSelector(
      selectActiveFences,
      (fences) => fences?.active_lens || 'SEC_OPS'
    );

    const selectBoundaryRules = createSelector(
      selectActiveFences,
      (fences): BoundaryRule[] => fences?.boundary_rules || DEFAULT_BOUNDARY_RULES
    );

    const selectTrustedSkills = createSelector(
      selectActiveFences,
      (fences): TrustedSkill[] => fences?.trusted_skills || DEFAULT_TRUSTED_SKILLS
    );

    return {
      selectIsWaitingForElicitation,
      selectSelectedInboxItem,
      selectIsViewingHistoricalTask,
      selectActivePresetKey,
      selectActivePreset,
      selectActiveGateway,
      selectTokenWeather,
      selectActiveFences,
      selectActiveShift,
      selectActiveLens,
      selectBoundaryRules,
      selectTrustedSkills,
    };
  },
});
