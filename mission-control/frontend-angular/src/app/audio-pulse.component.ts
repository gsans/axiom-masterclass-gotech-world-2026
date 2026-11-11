/**
 * Real-time 3-bar Audio Pulse Visualizer for Gemini 3.8 Live.
 *
 * Adapted from https://github.com/gsans/gemini-3-live-angular (`src/app/audio-pulse/audio-pulse.component.ts`):
 *  - Renders 3 vertical pill bars driven by RMS volume (`[volume]`) and connection state (`[active]`).
 *  - Uses compositor-friendly `scaleY` transforms and respects `@media (prefers-reduced-motion: reduce)`.
 */

import { Component, Input } from '@angular/core';
import { CommonModule } from '@angular/common';

const LINE_COUNT = 5;

@Component({
  selector: 'app-audio-pulse',
  standalone: true,
  imports: [CommonModule],
  template: `
    <div
      class="audioPulse"
      [class.active]="active"
      [class.hover]="hover"
      aria-hidden="true"
    >
      @for (line of lines; track $index) {
        <div
          class="audioPulseLine"
          [style.animationDelay]="getAnimationDelay($index)"
          [style.transform]="'scaleY(' + getBarScale($index) + ')'"
        ></div>
      }
    </div>
  `,
  styles: [
    `
      .audioPulse {
        display: inline-flex;
        width: 34px;
        height: 26px;
        justify-content: space-evenly;
        align-items: center;
        opacity: 0.45;
        transition: opacity 0.25s ease;
      }

      .audioPulse.active {
        opacity: 1;
      }

      .audioPulseLine {
        background-color: var(--text-3);
        border-radius: 1000px;
        width: 3.5px;
        height: 24px;
        transform: scaleY(0.22);
        transform-origin: center;
        transition: transform 0.08s ease-out, background-color 0.2s ease;
      }

      .audioPulse.active .audioPulseLine {
        background-color: var(--go);
      }

      .audioPulse.hover .audioPulseLine {
        animation: hover 1.4s infinite alternate ease-in-out;
        @media (prefers-reduced-motion: reduce) {
          animation: none;
        }
      }

      @keyframes hover {
        from {
          translate: 0 0;
        }
        to {
          translate: 0 -2.5px;
        }
      }
    `,
  ],
})
export class AudioPulseComponent {
  @Input() active = false;
  @Input() volume = 0;
  @Input() hover = false;

  readonly lines = Array(LINE_COUNT).fill(null);

  getAnimationDelay(index: number): string {
    return `${index * 133}ms`;
  }

  /**
   * Maps RMS volume (0.0 -> 1.0) to a vertical scale factor between 0.22 (4px) and 1.0 (18px),
   * matching the center-weighted sensitivity `(i === 1 ? 400 : 60)` from `gsans/gemini-3-live-angular`.
   */
  getBarScale(index: number): number {
    if (!this.active) return 0.22;
    const heightPx = Math.min(20, 4 + this.volume * (index === 2 ? 400 : index % 2 ? 180 : 80));
    return Number((heightPx / 20).toFixed(3));
  }
}
