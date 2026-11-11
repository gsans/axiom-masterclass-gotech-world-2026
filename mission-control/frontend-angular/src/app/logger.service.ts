/**
 * NgRx Store-Backed Structured Streaming Logger Service for Gemini 3.8 Live & Mission Control.
 *
 * Adapted from https://github.com/gsans/gemini-3-live-angular/blob/js-genai/src/app/logging/logger.service.ts:
 *  - `src/app/logging/logger-actions.ts` (`LoggerActions`)
 *  - `src/app/logging/logger-reducer.ts` (`loggerFeature` reducer + selectors)
 *  - `src/app/logging/logger.service.ts` (`store.select(...)` & `store.selectSignal(...)` facade)
 */

import { Injectable, Signal, inject } from '@angular/core';
import { Store } from '@ngrx/store';
import { Observable } from 'rxjs';
import { LoggerActions } from './logging/logger-actions';
import { loggerFeature } from './logging/logger-reducer';

export type LoggerFilterType = 'all' | 'conversations' | 'tools' | 'errors';

export interface StreamingLog {
  date: Date;
  type: string;
  count?: number;
  message: any;
}

@Injectable({ providedIn: 'root' })
export class LoggerService {
  private readonly store = inject(Store);

  // Observable selectors matching gsans/gemini-3-live-angular/src/app/logging/logger.service.ts
  readonly logs$: Observable<StreamingLog[]> = this.store.select(loggerFeature.selectLogs);
  readonly maxLogs$: Observable<number> = this.store.select(loggerFeature.selectMaxLogs);

  // Signal selectors (`store.selectSignal`) for Angular 21 templates & components
  readonly maxLogs: Signal<number> = this.store.selectSignal(loggerFeature.selectMaxLogs);
  readonly logs: Signal<StreamingLog[]> = this.store.selectSignal(loggerFeature.selectLogs);
  readonly filter: Signal<LoggerFilterType> = this.store.selectSignal(loggerFeature.selectFilter);
  readonly filteredLogs: Signal<StreamingLog[]> = this.store.selectSignal(
    loggerFeature.selectFilteredLogs
  );

  /**
   * Dispatches `LoggerActions.logMessage` into the NgRx store, coalescing consecutive identical
   * `(type, message)` frames with a `count` badge inside `loggerFeature.reducer`.
   */
  log(entry: { type: string; message: any; date?: Date }): void {
    const log: StreamingLog = {
      date: entry.date ?? new Date(),
      type: entry.type,
      message: entry.message,
    };
    this.store.dispatch(LoggerActions.logMessage({ log }));
  }

  clearLogs(): void {
    this.store.dispatch(LoggerActions.clearLogs());
  }

  setFilter(filter: LoggerFilterType): void {
    this.store.dispatch(LoggerActions.setFilter({ filter }));
  }

  setMaxLogs(maxLogs: number): void {
    this.store.dispatch(LoggerActions.setMaxLogs({ maxLogs }));
  }
}
