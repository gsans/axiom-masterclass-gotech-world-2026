/**
 * WebcamService (adapted from `gsans/gemini-3-live-angular/src/gemini/webcam.service.ts`).
 *
 * Manages `navigator.mediaDevices.getUserMedia({ video: true })` stream lifecycle,
 * track-ended listener cleanup, and both RxJS (`stream$`, `isStreaming$`) and Angular Signal (`isStreamingSignal`) state.
 */

import { Injectable, OnDestroy, signal } from '@angular/core';
import { BehaviorSubject, Observable, Subject, takeUntil } from 'rxjs';

export interface UseMediaStreamResult {
  isStreaming: Observable<boolean>;
  start: () => Promise<MediaStream | null>;
  stop: () => void;
}

@Injectable({
  providedIn: 'root',
})
export class WebcamService implements OnDestroy {
  private streamSubject = new BehaviorSubject<MediaStream | null>(null);
  stream$ = this.streamSubject.asObservable();
  private isStreamingSubject = new BehaviorSubject<boolean>(false);
  isStreaming$ = this.isStreamingSubject.asObservable();
  isStreamingSignal = signal<boolean>(false);
  private ngUnsubscribe = new Subject<void>();

  constructor() {
    this.stream$.pipe(takeUntil(this.ngUnsubscribe)).subscribe((stream) => {
      if (stream) {
        const handleStreamEnded = () => {
          this.isStreamingSubject.next(false);
          this.isStreamingSignal.set(false);
          this.streamSubject.next(null);
        };

        stream.getTracks().forEach((track) => {
          track.addEventListener('ended', handleStreamEnded);
          const originalStop = track.stop;
          track.stop = () => {
            originalStop.apply(track);
            handleStreamEnded();
          };
        });
      }
    });
  }

  ngOnDestroy(): void {
    this.ngUnsubscribe.next();
    this.ngUnsubscribe.complete();
    this.stop();
  }

  get isStreaming(): boolean {
    return this.isStreamingSubject.value;
  }

  start(): Promise<MediaStream | null> {
    return navigator.mediaDevices
      .getUserMedia({ video: true })
      .then((mediaStream) => {
        this.streamSubject.next(mediaStream);
        this.isStreamingSubject.next(true);
        this.isStreamingSignal.set(true);
        return mediaStream;
      })
      .catch((error) => {
        console.error('Error starting webcam:', error);
        this.isStreamingSubject.next(false);
        this.isStreamingSignal.set(false);
        return null;
      });
  }

  stop(): void {
    const stream = this.streamSubject.value;
    if (stream) {
      stream.getTracks().forEach((track) => track.stop());
      this.streamSubject.next(null);
      this.isStreamingSubject.next(false);
      this.isStreamingSignal.set(false);
    }
  }
}
