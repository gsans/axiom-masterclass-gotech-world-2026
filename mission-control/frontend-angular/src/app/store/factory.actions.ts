/**
 * NgRx Action Groups for Axiom Mission Control (`FactoryActions`, `WhiteboardActions`, `ToolboxActions`).
 *
 * Follows the `createActionGroup` pattern from https://github.com/gsans/gemini-3-live-angular/blob/js-genai/src/app/logging/logger-actions.ts
 */

import { createActionGroup, emptyProps, props } from '@ngrx/store';
import {
  ActiveWorkspaceTab,
  AgUiChatTurn,
  FactorySnapshot,
  FencesLedger,
  ToolboxConfig,
  WhiteboardSynthesisPlan,
} from './factory.models';

export const FactoryActions = createActionGroup({
  source: 'Factory',
  events: {
    'Set Target Repo': props<{ targetRepo: string }>(),
    'Set Task Prompt': props<{ taskPrompt: string }>(),
    'Dispatch Run Started': props<{
      shortCode: string;
      runId?: string;
      prompt?: string;
      whiteboardPlan?: WhiteboardSynthesisPlan | null;
      keepActiveTab?: boolean;
    }>(),
    'Dispatch Run Finished': emptyProps(),
    'Snapshot Received': props<{ snapshot: FactorySnapshot }>(),
    'Append Streamed Markdown': props<{ delta: string }>(),
    'Push Ag Event': props<{ entry: string }>(),
    'Set Voice Transcript': props<{ transcript: string | null }>(),
    'Select Task': props<{ taskId: string; activeTab: ActiveWorkspaceTab }>(),
    'Select New Dispatch': emptyProps(),
    'Set Active Tab': props<{ tab: ActiveWorkspaceTab }>(),
    'Toggle Drawer': emptyProps(),
    'Toggle Console Drawer': emptyProps(),
    'Toggle Chaos Armed': emptyProps(),
    'Step Started': props<{ stepName: string }>(),
    'Step Finished': props<{ stepName: string }>(),
    'Tool Call Started': props<{ toolCallId: string; toolCallName: string }>(),
    'Tool Call Ended': props<{ toolCallId?: string }>(),
    'Append Chat Turn': props<{ turn: AgUiChatTurn }>(),
    'Clear Chat Thread': emptyProps(),
  },
});

export const WhiteboardActions = createActionGroup({
  source: 'Whiteboard',
  events: {
    'Set Preview Data Url': props<{ dataUrl: string | null }>(),
    'Scan Started': emptyProps(),
    'Scan Succeeded': props<{ plan: WhiteboardSynthesisPlan }>(),
    'Scan Finished': emptyProps(),
  },
});

export const ToolboxActions = createActionGroup({
  source: 'Toolbox',
  events: {
    'Config Loaded': props<{ toolbox: ToolboxConfig }>(),
    'Fences Ledger Updated': props<{ fencesLedger: FencesLedger }>(),
  },
});
