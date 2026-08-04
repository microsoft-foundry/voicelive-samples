// stereo-interleaver.js
// AudioWorklet processor that interleaves mic (input 0) and playback reference
// (input 1) into a single stereo PCM16 stream: [mic0, ref0, mic1, ref1, ...].
// The stereo buffer is transferred to the main thread via postMessage, where it
// is sent to Voice Live as the Live Reference AEC signal.
class StereoInterleaver extends AudioWorkletProcessor {
  process(inputs) {
    const mic = inputs[0]?.[0]; // input 0, channel 0 = mic
    if (!mic) return true; // no mic data yet; nothing to send

    // Use the playback tap if connected, otherwise treat as silence so mic audio
    // is always sent even when TTS is not playing. Downmix stereo playback to mono.
    const refChannels = inputs[1];
    let ref = null;
    if (refChannels?.length === 1) {
      ref = refChannels[0];
    } else if (refChannels?.length > 1) {
      ref = new Float32Array(mic.length);
      for (let i = 0; i < mic.length; i++) {
        let sum = 0;
        for (const ch of refChannels) sum += ch[i];
        ref[i] = sum / refChannels.length;
      }
    }

    // Interleave into stereo PCM16: ch0 = mic, ch1 = reference.
    const stereo = new Int16Array(mic.length * 2);
    for (let i = 0; i < mic.length; i++) {
      const m = Math.max(-1, Math.min(1, mic[i]));
      const r = ref ? Math.max(-1, Math.min(1, ref[i])) : 0;
      stereo[i * 2] = Math.round(m < 0 ? m * 0x8000 : m * 0x7fff);
      stereo[i * 2 + 1] = Math.round(r < 0 ? r * 0x8000 : r * 0x7fff);
    }
    this.port.postMessage(stereo.buffer, [stereo.buffer]);
    return true;
  }
}

registerProcessor('stereo-interleaver', StereoInterleaver);
