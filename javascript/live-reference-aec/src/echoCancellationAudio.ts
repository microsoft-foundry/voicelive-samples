// Web Audio graph for Live Reference AEC (client-supplied echo cancellation reference).
//
// Mic and the app's TTS playback are captured into a single AudioContext so the
// reference channel reflects exactly what the speaker plays. The graph:
//
//   mic         -> interleaver input 0 (mic channel)
//   playbackBus -> speakers (destination)
//   playbackBus -> interleaver input 1 (reference channel)
//
// The interleaver worklet emits stereo PCM16 [mic, ref, mic, ref, ...] which is
// forwarded to Voice Live. All assistant audio MUST route through playbackBus,
// otherwise the reference channel will not capture it and echo will not cancel.

export type AudioChunkHandler = (bytes: Uint8Array) => void;

// Voice Live streams TTS as 24 kHz mono PCM16 regardless of the capture context's
// rate, so decode at this fixed rate and let Web Audio resample to the device.
const OUTPUT_SAMPLE_RATE = 24000;

export class EchoCancellationAudio {
  private audioContext?: AudioContext;
  private micStream?: MediaStream;
  private micSource?: MediaStreamAudioSourceNode;
  private interleaver?: AudioWorkletNode;
  private playbackBus?: GainNode;
  private nextStartTime = 0;
  private scheduledSources = new Set<AudioBufferSourceNode>();

  /** Actual capture sample rate; send this to the server as input_audio_sampling_rate. */
  get sampleRate(): number {
    return this.audioContext?.sampleRate ?? 24000;
  }

  /** Create the AudioContext, load the worklet, and build the graph (mic not yet streaming). */
  async init(): Promise<void> {
    try {
      this.audioContext = new AudioContext({ sampleRate: 24000 });
    } catch {
      this.audioContext = new AudioContext(); // fallback if 24 kHz is rejected
    }
    await this.audioContext.resume();

    // Voice Live accepts PCM16 at 8, 16, or 24 kHz. If the browser could not honor the
    // 24 kHz request and fell back to an unsupported native rate (often 44.1/48 kHz),
    // fail clearly instead of streaming audio the server will reject.
    const supportedRates = [8000, 16000, 24000];
    if (!supportedRates.includes(this.audioContext.sampleRate)) {
      throw new Error(
        `This browser's AudioContext runs at ${this.audioContext.sampleRate} Hz, which ` +
          `Voice Live does not support for PCM16 (expected 8000, 16000, or 24000 Hz).`,
      );
    }

    await this.audioContext.audioWorklet.addModule('/stereo-interleaver.js');

    // Capture the mic with browser processing OFF; the server performs EC.
    this.micStream = await navigator.mediaDevices.getUserMedia({
      audio: {
        echoCancellation: false,
        noiseSuppression: false,
        autoGainControl: false,
        channelCount: 1,
      },
    });
    this.micSource = this.audioContext.createMediaStreamSource(this.micStream);

    // Interleaver worklet: 2 inputs (mic + reference). numberOfOutputs is 1 for
    // compatibility with older Chrome that skipped process() on 0-output nodes.
    this.interleaver = new AudioWorkletNode(this.audioContext, 'stereo-interleaver', {
      numberOfInputs: 2,
      numberOfOutputs: 1,
      outputChannelCount: [1],
    });
    this.interleaver.connect(this.audioContext.destination);

    // Shared playback bus: speakers + reference channel.
    this.playbackBus = this.audioContext.createGain();
    this.playbackBus.connect(this.audioContext.destination);
    this.playbackBus.connect(this.interleaver, 0, 1);
    // Mic is connected in start(), after session.update, to avoid streaming audio
    // under the default (mono) server settings.
  }

  /** Wire the worklet output, then connect the mic so audio begins streaming. */
  start(onChunk: AudioChunkHandler): void {
    if (!this.audioContext || !this.interleaver || !this.micSource) {
      throw new Error('EchoCancellationAudio.init() must be called before start()');
    }
    this.interleaver.port.onmessage = (event) => onChunk(new Uint8Array(event.data as ArrayBuffer));
    this.nextStartTime = this.audioContext.currentTime;
    this.micSource.connect(this.interleaver, 0, 0);
  }

  /** Schedule a mono PCM16 TTS chunk through the playback bus (speakers + reference). */
  playTts(pcm16: Uint8Array): void {
    if (!this.audioContext || !this.playbackBus || pcm16.byteLength === 0) return;

    const samples = pcm16.byteLength / 2;
    const view = new DataView(pcm16.buffer, pcm16.byteOffset, pcm16.byteLength);
    const buffer = this.audioContext.createBuffer(1, samples, OUTPUT_SAMPLE_RATE);
    const channel = buffer.getChannelData(0);
    for (let i = 0; i < samples; i++) {
      channel[i] = view.getInt16(i * 2, true) / 0x8000;
    }

    const source = this.audioContext.createBufferSource();
    source.buffer = buffer;
    source.connect(this.playbackBus);
    this.scheduledSources.add(source);
    source.onended = () => {
      source.disconnect();
      this.scheduledSources.delete(source);
    };

    const now = this.audioContext.currentTime;
    if (this.nextStartTime < now) this.nextStartTime = now;
    source.start(this.nextStartTime);
    this.nextStartTime += buffer.duration;
  }

  /** Stop and discard all scheduled/playing TTS (e.g. on barge-in) without tearing down the graph. */
  stopPlayback(): void {
    for (const source of this.scheduledSources) {
      source.onended = null;
      try {
        source.stop();
      } catch {
        // already stopped
      }
      source.disconnect();
    }
    this.scheduledSources.clear();
    if (this.audioContext) this.nextStartTime = this.audioContext.currentTime;
  }

  /** Release the mic, worklet, and AudioContext. */
  async cleanup(): Promise<void> {
    this.stopPlayback();
    this.micStream?.getTracks().forEach((t) => t.stop());
    this.micSource?.disconnect();
    this.interleaver?.disconnect();
    this.playbackBus?.disconnect();
    if (this.audioContext && this.audioContext.state !== 'closed') {
      await this.audioContext.close();
    }
    this.audioContext = undefined;
  }
}
