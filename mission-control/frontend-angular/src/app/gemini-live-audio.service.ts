/**
 * Angular 21 AudioWorklet + WebSocket Service for Gemini 3.8 Live.
 *
 * Combines production audio & session primitives from:
 *  1. `kazunori279/live-translator`:
 *     - `pcm-recorder-processor.js` (16kHz PCM Int16 mic capture with echoCancellation + noiseSuppression, AGC off)
 *     - `pcm-player-processor.js` (24kHz PCM ring-buffer playback with click-free exponential gain ramp mute)
 *     - WebSocket setup handshake, base64 PCM decoding, and GoAway session rotation
 *  2. `gsans/gemini-3-live-angular`:
 *     - Real-time RMS volume metering (`worklet.vol-meter.ts` formula `Math.sqrt(sum / samples.length)` with `0.7` decay)
 *       driving `<app-audio-pulse>` (`volume` signal)
 *     - Immediate barge-in interruption handling (`msg.interrupted` -> `endOfAudio` flush)
 *     - Native turn-buffered user/model transcription with 2000ms inactivity flush
 */

import { Injectable, inject, signal } from '@angular/core';
import { LoggerService } from './logger.service';

const RESUME_TIMEOUT_MS = 1500;
const OUTPUT_MUTE_RAMP_SEC = 0.015;
const OUTPUT_FLUSH_DELAY_MS = 80;
const TRANSCRIPT_FLUSH_TIMEOUT_MS = 2000;

const AUDIO_PROCESSING: MediaTrackConstraints = {
  echoCancellation: true,
  noiseSuppression: true,
  autoGainControl: false,
};

export interface GeminiLiveEnvelope {
  type?: string;
  sessionId?: string;
  model?: string;
  upstreamModel?: string;
  voice?: string;
  mode?: string;
  error?: string;
  interrupted?: boolean;
  turnComplete?: boolean;
  partial?: boolean;
  inputTranscription?: { text: string; finished: boolean };
  outputTranscription?: { text: string; finished: boolean };
  voiceDecision?: { decision: string; status?: string } | string | null;
  voiceWorkflowCommand?: string | null;
  content?: {
    role: string;
    parts: Array<{
      text?: string;
      thought?: boolean;
      inlineData?: { mimeType: string; data: string };
    }>;
  };
}

@Injectable({ providedIn: 'root' })
export class GeminiLiveAudioService {
  logger = inject(LoggerService);

  connectionState = signal<'DISCONNECTED' | 'CONNECTING' | 'CONNECTED'>('DISCONNECTED');
  liveMode = signal<string>('GEMINI_3_8_LIVE');
  selectedModel = signal<string>('gemini-3.8-flash-live-preview');
  selectedVoice = signal<string>('Puck');
  availableVoices = signal<Record<string, string>>({
    Puck: 'Upbeat',
    Aoede: 'Breezy',
    Kore: 'Firm',
    Charon: 'Informative',
    Fenrir: 'Excitable',
    Zephyr: 'Bright',
  });

  micRunning = signal<boolean>(false);
  micMuted = signal<boolean>(false);
  outputMuted = signal<boolean>(false);
  /** Toggle to enable/disable spoken narration of main Mission Control actions and responses. */
  narrationEnabled = signal<boolean>(true);
  /** Real-time smoothed RMS volume (0.0 -> 1.0) for `<app-audio-pulse>` (from `gsans/gemini-3-live-angular`). */
  volume = signal<number>(0);
  lastInputTranscript = signal<string>('');
  lastOutputTranscript = signal<string>('');

  private ws: WebSocket | null = null;
  private recorderNode: AudioWorkletNode | null = null;
  private recorderCtx: AudioContext | null = null;
  private micStream: MediaStream | null = null;
  private playerNode: AudioWorkletNode | null = null;
  private playerCtx: AudioContext | null = null;
  private playerGain: GainNode | null = null;
  private outputFlushTimer: any = null;
  private volumeDecayTimer: any = null;

  private userTranscriptBuffer = '';
  private modelTranscriptBuffer = '';
  private userTranscriptTimeout: any = null;
  private modelTranscriptTimeout: any = null;

  async fetchServerConfig(backendHttpUrl: string): Promise<void> {
    try {
      const res = await fetch(`${backendHttpUrl}/api/live/config`);
      const data = await res.json();
      if (data.voices) this.availableVoices.set(data.voices);
      if (data.model) this.selectedModel.set(data.model);
      if (data.defaultVoice) this.selectedVoice.set(data.defaultVoice);
    } catch {
      // Keep default voices when offline
    }
  }

  async connect(
    backendHttpUrl: string,
    opts: {
      lens: string;
      mandateId: string;
      onEvent?: (msg: GeminiLiveEnvelope) => void;
    }
  ): Promise<void> {
    if (this.connectionState() !== 'DISCONNECTED') {
      this.disconnect();
      return;
    }

    this.connectionState.set('CONNECTING');
    const wsBase = backendHttpUrl.replace(/^http/, 'ws');
    const sessionId = `live-${Math.random().toString(36).slice(2, 8)}`;
    const wsUrl = `${wsBase}/ws/live/${sessionId}`;

    this.ws = new WebSocket(wsUrl);
    this.ws.binaryType = 'arraybuffer';

    this.ws.onopen = async () => {
      this.connectionState.set('CONNECTED');
      const setupPayload = {
        voice: this.selectedVoice(),
        model: this.selectedModel(),
        lens: opts.lens,
        mandateId: opts.mandateId,
        narrationEnabled: this.narrationEnabled(),
      };
      this.logger.log({
        type: 'client.connect',
        message: `Connected to ${wsUrl} · setup=${JSON.stringify(setupPayload)}`,
      });
      // Send initial setup handshake (adapted from live-translator app.js)
      this.ws?.send(JSON.stringify(setupPayload));
      await this.startAudioWorklets();
    };

    this.ws.onmessage = (event) => {
      try {
        const msg: GeminiLiveEnvelope = JSON.parse(event.data);
        if (msg.type === 'sessionReady') {
          if (msg.mode) this.liveMode.set(msg.mode);
          if (msg.model) this.selectedModel.set(msg.model);
          this.logger.log({
            type: 'server.sessionReady',
            message: {
              sessionId: msg.sessionId,
              model: msg.model,
              upstreamModel: msg.upstreamModel || msg.model,
              voice: msg.voice,
              mode: msg.mode,
            },
          });
        }

        if (msg.type === 'serverError' || msg.error) {
          this.logger.log({
            type: 'server.error',
            message: msg.error || msg,
          });
        }

        // Handle barge-in interruption (ported from `gsans/gemini-3-live-angular`):
        // Immediately stop 24kHz audio playback and flush buffered transcripts when the user interrupts.
        if (msg.interrupted) {
          this.playerNode?.port.postMessage({ command: 'endOfAudio' });
          this.flushTranscripts();
          this.volume.set(0);
          this.logger.log({
            type: 'receive.serverContent',
            message: 'interrupted (barge-in audio buffer flushed)',
          });
        }

        if (msg.inputTranscription?.text) {
          this.bufferTranscript('user', msg.inputTranscription.text, msg.inputTranscription.finished);
        }
        if (msg.outputTranscription?.text) {
          this.bufferTranscript('model', msg.outputTranscription.text, msg.outputTranscription.finished);
        }

        if (msg.turnComplete) {
          this.flushTranscripts();
          this.logger.log({
            type: 'server.turnComplete',
            message: 'turnComplete',
          });
        }

        if (msg.voiceDecision) {
          this.logger.log({
            type: 'server.gateTrigger',
            message: msg.voiceDecision,
          });
        }

        if (msg.content?.parts) {
          for (const part of msg.content.parts) {
            if (part.text) {
              this.logger.log({
                type: 'server.content',
                message: part.text,
              });
            }
            if (
              part.inlineData?.data &&
              part.inlineData.mimeType?.startsWith('audio/pcm') &&
              this.playerNode &&
              !this.outputMuted()
            ) {
              const pcmBuffer = this.base64ToArrayBuffer(part.inlineData.data);
              this.updateVolumeFromPcm16(pcmBuffer);
              this.playerNode.port.postMessage(pcmBuffer);
              this.logger.log({
                type: 'server.audio',
                message: 'audio/pcm;rate=24000 buffer',
              });
            }
          }
        }
        opts.onEvent?.(msg);
      } catch (err: any) {
        this.logger.log({
          type: 'client.error',
          message: `Malformed WS frame: ${err?.message || err}`,
        });
      }
    };

    this.ws.onclose = (ev: CloseEvent) => {
      this.logger.log({
        type: 'client.close',
        message: ev.reason ? `disconnected (${ev.code}: ${ev.reason})` : `disconnected (${ev.code})`,
      });
      this.stopAudioWorklets();
      this.connectionState.set('DISCONNECTED');
    };

    this.ws.onerror = () => {
      this.logger.log({
        type: 'server.error',
        message: 'WebSocket connection error on /ws/live',
      });
      this.stopAudioWorklets();
      this.connectionState.set('DISCONNECTED');
    };
  }

  sendTextCommand(text: string): void {
    this.logger.log({
      type: 'client.send',
      message: text,
    });
    if (this.ws && this.ws.readyState === WebSocket.OPEN) {
      this.ws.send(JSON.stringify({ type: 'text', text }));
    } else {
      this.logger.log({
        type: 'client.error',
        message: `Cannot send text "${text}" while Gemini Live is DISCONNECTED`,
      });
    }
  }

  /**
   * Sends realtime media chunks (e.g. `image/jpeg` frames from Screen Capture or Webcam)
   * over the active Gemini 3.8 Live WebSocket (`gsans/gemini-3-live-angular` pattern).
   */
  sendRealtimeInput(chunks: Array<{ mimeType: string; data: string }>): void {
    if (!this.ws || this.ws.readyState !== WebSocket.OPEN || !chunks.length) return;
    let hasAudio = false;
    let hasVideo = false;
    for (const chunk of chunks) {
      if (chunk.mimeType?.includes('audio')) hasAudio = true;
      if (chunk.mimeType?.includes('image') || chunk.mimeType?.includes('video')) hasVideo = true;
    }
    const label =
      hasAudio && hasVideo
        ? 'audio + video'
        : hasAudio
        ? 'audio'
        : hasVideo
        ? 'video (image/jpeg)'
        : 'media';
    this.logger.log({
      type: 'client.realtimeInput',
      message: label,
    });
    this.ws.send(JSON.stringify({ type: 'realtimeInput', chunks }));
  }

  /**
   * Sends a narration cue over Gemini 3.8 Live so the voice copilot speaks main actions and responses.
   */
  narrate(text: string, force = false): void {
    if (!force && !this.narrationEnabled()) return;
    this.logger.log({
      type: 'client.narrate',
      message: text,
    });
    if (this.ws && this.ws.readyState === WebSocket.OPEN) {
      this.ws.send(JSON.stringify({ type: 'narrate', text }));
    } else {
      this.logger.log({
        type: 'client.narrate.skipped',
        message: `(Offline) Narration queued only in log: "${text}"`,
      });
    }
  }

  toggleNarration(): void {
    const next = !this.narrationEnabled();
    this.narrationEnabled.set(next);
    if (next) {
      this.narrate('Voice narration enabled.', true);
    }
  }

  toggleMicMute(): void {
    this.micMuted.update((m) => !m);
    if (this.micMuted()) {
      this.volume.set(0);
    }
  }

  toggleOutputMute(): void {
    const next = !this.outputMuted();
    this.outputMuted.set(next);
    this.applyOutputGain();
    clearTimeout(this.outputFlushTimer);
    if (next) {
      this.outputFlushTimer = setTimeout(() => {
        this.playerNode?.port.postMessage({ command: 'endOfAudio' });
      }, OUTPUT_FLUSH_DELAY_MS);
    }
  }

  disconnect(): void {
    this.flushTranscripts();
    this.stopAudioWorklets();
    if (this.ws) {
      this.ws.onclose = null;
      this.ws.close();
      this.ws = null;
    }
    this.connectionState.set('DISCONNECTED');
  }

  private bufferTranscript(source: 'user' | 'model', text: string, finished?: boolean): void {
    if (source === 'user') {
      if (finished) {
        const finalMsg = (this.userTranscriptBuffer + text).trim() || text.trim();
        this.userTranscriptBuffer = '';
        this.lastInputTranscript.set(finalMsg);
        if (finalMsg) {
          this.logger.log({ type: 'user-transcript', message: finalMsg });
        }
        clearTimeout(this.userTranscriptTimeout);
      } else {
        this.userTranscriptBuffer += text;
        this.lastInputTranscript.set(this.userTranscriptBuffer.trim());
        clearTimeout(this.userTranscriptTimeout);
        this.userTranscriptTimeout = setTimeout(() => {
          this.flushUserTranscript();
        }, TRANSCRIPT_FLUSH_TIMEOUT_MS);
      }
    } else {
      if (finished) {
        const finalMsg = (this.modelTranscriptBuffer + text).trim() || text.trim();
        this.modelTranscriptBuffer = '';
        this.lastOutputTranscript.set(finalMsg);
        if (finalMsg) {
          this.logger.log({ type: 'model-transcript', message: finalMsg });
        }
        clearTimeout(this.modelTranscriptTimeout);
      } else {
        this.modelTranscriptBuffer += text;
        this.lastOutputTranscript.set(this.modelTranscriptBuffer.trim());
        clearTimeout(this.modelTranscriptTimeout);
        this.modelTranscriptTimeout = setTimeout(() => {
          this.flushModelTranscript();
        }, TRANSCRIPT_FLUSH_TIMEOUT_MS);
      }
    }
  }

  private flushUserTranscript(): void {
    const msg = this.userTranscriptBuffer.trim();
    if (msg) {
      this.logger.log({ type: 'user-transcript', message: msg });
    }
    this.userTranscriptBuffer = '';
    clearTimeout(this.userTranscriptTimeout);
    this.userTranscriptTimeout = null;
  }

  private flushModelTranscript(): void {
    const msg = this.modelTranscriptBuffer.trim();
    if (msg) {
      this.logger.log({ type: 'model-transcript', message: msg });
    }
    this.modelTranscriptBuffer = '';
    clearTimeout(this.modelTranscriptTimeout);
    this.modelTranscriptTimeout = null;
  }

  private flushTranscripts(): void {
    this.flushUserTranscript();
    this.flushModelTranscript();
  }

  /**
   * Computes RMS volume with 0.7 smoothing decay (ported from `gsans/gemini-3-live-angular/src/gemini/worklet.vol-meter.ts`).
   */
  private updateVolumeFromFloat32(samples: Float32Array): void {
    if (!samples || samples.length === 0) return;
    let sum = 0;
    for (let i = 0; i < samples.length; i++) {
      sum += samples[i] * samples[i];
    }
    const rms = Math.sqrt(sum / samples.length);
    this.volume.update((prev) => Math.max(rms, prev * 0.7));
    this.scheduleVolumeDecay();
  }

  private updateVolumeFromPcm16(buffer: ArrayBuffer): void {
    const int16 = new Int16Array(buffer);
    if (int16.length === 0) return;
    let sum = 0;
    for (let i = 0; i < int16.length; i++) {
      const normalized = int16[i] / 0x7fff;
      sum += normalized * normalized;
    }
    const rms = Math.sqrt(sum / int16.length);
    this.volume.update((prev) => Math.max(rms, prev * 0.7));
    this.scheduleVolumeDecay();
  }

  private scheduleVolumeDecay(): void {
    clearTimeout(this.volumeDecayTimer);
    this.volumeDecayTimer = setTimeout(() => {
      this.volume.set(0);
    }, 180);
  }

  private async startAudioWorklets(): Promise<void> {
    try {
      // 1. Start 24kHz PCM Player Worklet (live-translator/audio-player.js)
      this.playerCtx = new AudioContext({ sampleRate: 24000 });
      if (this.playerCtx.state === 'suspended') {
        await this.playerCtx.resume().catch(() => {});
      }
      await this.playerCtx.audioWorklet.addModule('/worklets/pcm-player-processor.js');
      this.playerNode = new AudioWorkletNode(this.playerCtx, 'pcm-player-processor');
      this.playerGain = this.playerCtx.createGain();
      this.playerNode.connect(this.playerGain);
      this.playerGain.connect(this.playerCtx.destination);
      this.applyOutputGain();

      // 2. Start 16kHz PCM Recorder Worklet (live-translator/audio-recorder.js)
      this.recorderCtx = new AudioContext({ sampleRate: 16000 });
      if (this.recorderCtx.state === 'suspended') {
        await Promise.race([
          this.recorderCtx.resume().catch(() => {}),
          new Promise((r) => setTimeout(r, RESUME_TIMEOUT_MS)),
        ]);
      }
      await this.recorderCtx.audioWorklet.addModule('/worklets/pcm-recorder-processor.js');
      this.micStream = await navigator.mediaDevices.getUserMedia({
        audio: { channelCount: 1, ...AUDIO_PROCESSING },
      });
      const source = this.recorderCtx.createMediaStreamSource(this.micStream);
      this.recorderNode = new AudioWorkletNode(this.recorderCtx, 'pcm-recorder-processor');
      source.connect(this.recorderNode);
      this.recorderNode.port.onmessage = (event) => {
        if (this.micMuted() || !this.ws || this.ws.readyState !== WebSocket.OPEN) return;
        const floatSamples: Float32Array = event.data;
        this.updateVolumeFromFloat32(floatSamples);
        const pcm16Buffer = this.convertFloat32ToPCM(floatSamples);
        this.ws.send(pcm16Buffer);
        this.logger.log({
          type: 'client.realtimeInput',
          message: 'audio (16kHz PCM)',
        });
      };
      this.micRunning.set(true);
      this.logger.log({
        type: 'client.audioWorklet',
        message: '16kHz PCM recorder + 24kHz PCM player initialized',
      });
    } catch (err: any) {
      // Microphone permission denied or unavailable; text/simulated WebSocket still works
      this.micRunning.set(false);
      this.logger.log({
        type: 'client.error',
        message: `AudioWorklet/Mic initialization warning: ${err?.message || err}`,
      });
    }
  }

  private stopAudioWorklets(): void {
    this.micRunning.set(false);
    this.volume.set(0);
    clearTimeout(this.volumeDecayTimer);
    try {
      this.micStream?.getTracks().forEach((t) => t.stop());
      this.recorderNode?.disconnect();
      this.recorderCtx?.close();
      this.playerNode?.disconnect();
      this.playerCtx?.close();
    } catch {}
    this.micStream = null;
    this.recorderNode = null;
    this.recorderCtx = null;
    this.playerNode = null;
    this.playerCtx = null;
    this.playerGain = null;
  }

  private applyOutputGain(): void {
    if (!this.playerGain || !this.playerCtx) return;
    const t = this.playerCtx.currentTime;
    this.playerGain.gain.cancelScheduledValues(t);
    this.playerGain.gain.setTargetAtTime(this.outputMuted() ? 0 : 1, t, OUTPUT_MUTE_RAMP_SEC);
  }

  private convertFloat32ToPCM(inputData: Float32Array): ArrayBuffer {
    const pcm16 = new Int16Array(inputData.length);
    for (let i = 0; i < inputData.length; i++) {
      pcm16[i] = inputData[i] * 0x7fff;
    }
    return pcm16.buffer;
  }

  private base64ToArrayBuffer(base64: string): ArrayBuffer {
    let standardBase64 = base64.replace(/-/g, '+').replace(/_/g, '/');
    while (standardBase64.length % 4) standardBase64 += '=';
    const binaryString = window.atob(standardBase64);
    const len = binaryString.length;
    const bytes = new Uint8Array(len);
    for (let i = 0; i < len; i++) {
      bytes[i] = binaryString.charCodeAt(i);
    }
    return bytes.buffer;
  }
}
