// Voice Live session wired for Live Reference AEC.
//
// The only feature-specific configuration is the inputAudioEchoCancellation block
// in updateSession (referenceSource: "client", channels: 2) together with a
// stereo PCM16 stream produced by EchoCancellationAudio. Everything else is a
// standard Voice Live realtime session.
import {
  VoiceLiveClient,
  VoiceLiveSession,
  KnownOAIVoice,
  type RequestSession,
  type VoiceLiveSessionHandlers,
  type VoiceLiveSubscription,
} from '@azure/ai-voicelive';
import { AzureKeyCredential } from '@azure/core-auth';
import { EchoCancellationAudio } from './echoCancellationAudio.js';

// GA api-version that introduces Live Reference AEC.
const API_VERSION = '2026-07-15';

export interface VoiceAssistantConfig {
  endpoint: string;
  apiKey: string;
  model: string;
  voice: string;
  instructions: string;
}

export interface VoiceAssistantCallbacks {
  onConnectionStatusChange: (status: string) => void;
  onAssistantStatusChange: (status: string) => void;
  onUserMessage: (text: string) => void;
  onAssistantMessage: (text: string, isStreaming: boolean) => void;
  onError: (message: string) => void;
}

export class VoiceAssistant {
  private client?: VoiceLiveClient;
  private session?: VoiceLiveSession;
  private subscription?: VoiceLiveSubscription;
  private audio = new EchoCancellationAudio();
  private callbacks?: VoiceAssistantCallbacks;
  private assistantText = '';
  // Suppresses audio deltas that arrive after a barge-in until the next response,
  // so an interrupted response cannot re-feed the reference or resume playing.
  private suppressPlayback = false;
  // Lifecycle flags. `active` is set synchronously so concurrent start() calls
  // cannot race past the guard; `stopPromise` holds the in-flight teardown so
  // concurrent stop() callers all await the same cleanup (and so reentry via
  // onDisconnected does not start a second teardown).
  private active = false;
  private stopPromise?: Promise<void>;
  // Resolves/rejects the start() wait for the server's session.updated ack.
  private pendingConfig?: { resolve: () => void; reject: (e: Error) => void };

  setCallbacks(callbacks: VoiceAssistantCallbacks): void {
    this.callbacks = callbacks;
  }

  async start(config: VoiceAssistantConfig): Promise<void> {
    if (this.active) {
      throw new Error('start() called while a session is active; call stop() first');
    }
    this.active = true; // set synchronously so concurrent starts cannot race
    this.suppressPlayback = false;
    this.callbacks?.onConnectionStatusChange('connecting');
    try {
      // Build the audio graph first so we know the actual capture sample rate.
      await this.audio.init();

      this.client = new VoiceLiveClient(config.endpoint, new AzureKeyCredential(config.apiKey), {
        apiVersion: API_VERSION,
      });
      this.session = await this.client.startSession(config.model);
      this.subscription = this.session.subscribe(this.createHandlers());

      // Configure the session for Live Reference AEC BEFORE streaming audio.
      // WebSocket preserves order, so the server applies this before the first packet.
      // referenceSource: "client" + channels: 2 activate the client-supplied echo
      // reference; the stereo PCM16 stream carries the mic on channel 0 and the
      // speaker playback on channel 1. inputAudioSamplingRate must match the actual
      // capture rate. autoTruncate + interruptResponse keep the server's conversation
      // history in sync with what the user actually heard when they barge in.
      const sessionConfig: RequestSession = {
        modalities: ['audio', 'text'],
        instructions: config.instructions,
        voice: this.toVoice(config.voice),
        inputAudioFormat: 'pcm16',
        outputAudioFormat: 'pcm16',
        inputAudioTranscription: { model: 'whisper-1' },
        turnDetection: {
          type: 'server_vad',
          threshold: 0.5,
          prefixPaddingInMs: 300,
          silenceDurationInMs: 500,
          autoTruncate: true,
          interruptResponse: true,
        },
        inputAudioEchoCancellation: {
          type: 'server_echo_cancellation',
          referenceSource: 'client',
          channels: 2,
        },
        inputAudioSamplingRate: this.audio.sampleRate,
      };

      // Arm the acknowledgement listener BEFORE sending the update so a fast
      // session.updated can never resolve before we are listening for it.
      const sessionAck = this.waitForSessionAck(10000);
      // If updateSession throws before we await sessionAck below, stop() rejects this
      // promise; attach a no-op handler so that rejection is never unhandled. The await
      // further down still observes the real outcome.
      sessionAck.catch(() => {});
      await this.session.updateSession(sessionConfig);

      // Wait for the server to acknowledge the configuration (session.updated) before
      // streaming. If the stereo/EC config is rejected, the server keeps the socket
      // open and replies with an error instead, so streaming stereo now would send it
      // under the previous mono configuration. onSessionUpdated resolves this; a
      // rejecting onServerError or a timeout throws and triggers rollback.
      await sessionAck;

      // Session is confirmed stereo-ready; begin streaming interleaved mic + reference.
      this.audio.start((bytes) => {
        this.session?.sendAudio(bytes).catch((e) => console.error('sendAudio failed:', e));
      });

      this.callbacks?.onConnectionStatusChange('connected');
      this.callbacks?.onAssistantStatusChange('listening');
    } catch (err) {
      // Roll back any partial state (mic, session, subscription) so the UI recovers.
      await this.stop();
      throw err;
    }
  }

  async stop(): Promise<void> {
    // All callers share one in-flight teardown; also makes reentry (onDisconnected
    // firing while we disconnect) a no-op that awaits the same promise.
    if (this.stopPromise) return this.stopPromise;
    this.stopPromise = this.doStop();
    try {
      await this.stopPromise;
    } finally {
      this.stopPromise = undefined;
    }
  }

  // Awaits the server's session.updated ack (resolved in onSessionUpdated), or
  // rejects if the config is refused (onServerError) or no ack arrives in time.
  private waitForSessionAck(timeoutMs: number): Promise<void> {
    return new Promise<void>((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pendingConfig = undefined;
        reject(new Error('Timed out waiting for session configuration acknowledgement'));
      }, timeoutMs);
      this.pendingConfig = {
        resolve: () => {
          clearTimeout(timer);
          this.pendingConfig = undefined;
          resolve();
        },
        reject: (e) => {
          clearTimeout(timer);
          this.pendingConfig = undefined;
          reject(e);
        },
      };
    });
  }

  private async doStop(): Promise<void> {
    // Unblock a start() still awaiting the session ack so it rolls back promptly.
    this.pendingConfig?.reject(new Error('stopped'));
    // Clean up each resource independently so one failure cannot skip the others.
    const results = await Promise.allSettled([
      this.audio.cleanup(),
      Promise.resolve(this.subscription?.close()),
      Promise.resolve(this.session?.disconnect()),
    ]);
    for (const r of results) {
      if (r.status === 'rejected') console.error('stop cleanup error:', r.reason);
    }
    this.subscription = undefined;
    this.session = undefined;
    this.client = undefined;
    this.active = false;
    this.callbacks?.onConnectionStatusChange('disconnected');
    this.callbacks?.onAssistantStatusChange('idle');
  }

  // OpenAI-hosted voices take a { type: "openai" } config; everything else is
  // treated as an Azure standard voice name.
  private toVoice(name: string): any {
    const lower = name.toLowerCase();
    const openAIVoices = Object.values(KnownOAIVoice) as string[];
    return openAIVoices.includes(lower)
      ? { type: 'openai', name: lower }
      : { type: 'azure-standard', name };
  }

  private createHandlers(): VoiceLiveSessionHandlers {
    return {
      onError: async (args) => this.callbacks?.onError(args.error?.message ?? 'Service error'),

      // Server-side protocol errors arrive here, separate from connection errors.
      // Surface the message but do not tear down: most server errors are recoverable,
      // and the service closes the socket itself on fatal errors (handled by onDisconnected).
      // If a config ack is still pending, the update was refused, so fail the start.
      onServerError: async (event) => {
        const message = event.error?.message ?? 'Server error';
        this.callbacks?.onError(message);
        this.pendingConfig?.reject(new Error(message));
      },

      // Server acknowledged the session configuration; safe to stream stereo now.
      onSessionUpdated: async () => {
        this.pendingConfig?.resolve();
      },

      // Unexpected connection loss: tear down mic/audio and reset the UI so it does
      // not appear connected while sendAudio keeps failing. No-op during our own stop().
      onDisconnected: async () => {
        if (this.active && !this.stopPromise) {
          this.callbacks?.onError('Connection lost.');
          await this.stop();
        }
      },

      onResponseCreated: async () => {
        this.assistantText = '';
        this.suppressPlayback = false;
        this.callbacks?.onAssistantStatusChange('responding');
      },

      onResponseDone: async (event) => {
        if (this.assistantText.trim()) this.callbacks?.onAssistantMessage(this.assistantText.trim(), false);
        this.assistantText = '';
        // Surface failures so a customer sees why a turn produced no audio.
        // "cancelled" is the expected result of a barge-in, not an error.
        const status = event.response?.status;
        const details = event.response?.statusDetails;
        if (status === 'failed') {
          const reason = (details && 'error' in details && details.error?.message) || status;
          this.callbacks?.onError(`Response failed: ${reason}`);
        } else if (status === 'incomplete') {
          const reason = (details && 'reason' in details && details.reason) || status;
          this.callbacks?.onError(`Response incomplete: ${reason}`);
        }
        this.callbacks?.onAssistantStatusChange('listening');
      },

      // Barge-in: user speech while assistant is talking. Drop queued playback and
      // ignore any late audio deltas from the interrupted response.
      onInputAudioBufferSpeechStarted: async () => {
        this.suppressPlayback = true;
        this.audio.stopPlayback();
        this.callbacks?.onAssistantStatusChange('listening');
      },

      onResponseAudioTranscriptDelta: async (event) => {
        this.assistantText += event.delta ?? '';
        this.callbacks?.onAssistantMessage(this.assistantText, true);
      },

      onConversationItemInputAudioTranscriptionCompleted: async (event) => {
        if (event.transcript) this.callbacks?.onUserMessage(event.transcript);
      },

      // Route assistant audio through the playback bus (speakers + EC reference).
      onResponseAudioDelta: async (event) => {
        if (this.suppressPlayback) return;
        if (event.delta && event.delta.byteLength > 0) this.audio.playTts(new Uint8Array(event.delta));
      },
    };
  }
}
