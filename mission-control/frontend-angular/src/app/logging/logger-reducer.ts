/**
 * NgRx Logger Feature Reducer (`loggerFeature`).
 *
 * Adapted from https://github.com/gsans/gemini-3-live-angular/blob/js-genai/src/app/logging/logger-reducer.ts
 * Coalesces consecutive identical `(type, message)` frames with a `count` badge and caps length at `maxLogs`.
 */

import { createFeature, createReducer, createSelector, on } from '@ngrx/store';
import { LoggerActions } from './logger-actions';
import { LoggerFilterType, StreamingLog } from '../logger.service';

export interface LoggerState {
  maxLogs: number;
  logs: StreamingLog[];
  filter: LoggerFilterType;
}

export const initialState: LoggerState = {
  maxLogs: 500,
  logs: [],
  filter: 'all',
};

function serializeMessage(msg: any): string {
  if (typeof msg === 'string') return msg;
  try {
    return JSON.stringify(msg);
  } catch {
    return String(msg);
  }
}

export const loggerFeature = createFeature({
  name: 'logger',
  reducer: createReducer(
    initialState,
    on(LoggerActions.logMessage, (state, { log }) => {
      const prevLog = state.logs.at(-1);

      if (
        prevLog &&
        prevLog.type === log.type &&
        serializeMessage(prevLog.message) === serializeMessage(log.message)
      ) {
        return {
          ...state,
          logs: [
            ...state.logs.slice(0, -1),
            {
              ...log,
              count: (prevLog.count || 1) + 1,
            },
          ].slice(-state.maxLogs),
        };
      }

      return {
        ...state,
        logs: [...state.logs.slice(-(state.maxLogs - 1)), log],
      };
    }),
    on(LoggerActions.clearLogs, (state) => ({
      ...state,
      logs: [],
    })),
    on(LoggerActions.setMaxLogs, (state, { maxLogs }) => ({
      ...state,
      maxLogs,
    })),
    on(LoggerActions.setFilter, (state, { filter }) => ({
      ...state,
      filter,
    }))
  ),
  extraSelectors: ({ selectLogs, selectFilter }) => ({
    selectFilteredLogs: createSelector(selectLogs, selectFilter, (all, f) => {
      if (f === 'all') return all;
      if (f === 'conversations') {
        return all.filter(
          (l) =>
            l.type === 'user-transcript' ||
            l.type === 'model-transcript' ||
            l.type.startsWith('client.narrate') ||
            l.type.startsWith('client.send') ||
            l.type.startsWith('server.content') ||
            l.type.startsWith('server.turnComplete')
        );
      }
      if (f === 'tools') {
        return all.filter(
          (l) =>
            l.type.includes('tool') ||
            l.type.includes('gate') ||
            l.type.includes('factory') ||
            l.type.includes('elicitation')
        );
      }
      if (f === 'errors') {
        return all.filter(
          (l) =>
            l.type.includes('error') ||
            l.type.includes('interrupted') ||
            l.type.includes('close')
        );
      }
      return all;
    }),
  }),
});
