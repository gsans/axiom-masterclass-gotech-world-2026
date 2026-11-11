/**
 * NgRx Logger Action Group (`LoggerActions`).
 *
 * Adapted from https://github.com/gsans/gemini-3-live-angular/blob/js-genai/src/app/logging/logger-actions.ts
 */

import { createActionGroup, emptyProps, props } from '@ngrx/store';
import { LoggerFilterType, StreamingLog } from '../logger.service';

export const LoggerActions = createActionGroup({
  source: 'Logger',
  events: {
    'Log Message': props<{ log: StreamingLog }>(),
    'Clear Logs': emptyProps(),
    'Set Max Logs': props<{ maxLogs: number }>(),
    'Set Filter': props<{ filter: LoggerFilterType }>(),
  },
});
