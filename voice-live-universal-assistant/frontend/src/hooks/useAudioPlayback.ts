import { useRef, useState, useCallback } from 'react';

const SAMPLE_RATE = 24000;

export function useAudioPlayback() {
  const [isPlaying, setIsPlaying] = useState(false);
  const [isPlaybackMuted, setIsPlaybackMuted] = useState(true); // text mode default: muted
  const audioContextRef = useRef<AudioContext | null>(null);
  const workletNodeRef = useRef<AudioWorkletNode | null>(null);
  const gainNodeRef = useRef<GainNode | null>(null);
  const isMutedRef = useRef(true);

  const initPlayback = useCallback(async () => {
    if (audioContextRef.current) return;

    const audioContext = new AudioContext({ sampleRate: SAMPLE_RATE });
    audioContextRef.current = audioContext;

    await audioContext.audioWorklet.addModule('/audio-playback-worklet.js');

    const workletNode = new AudioWorkletNode(audioContext, 'audio-playback-processor');
    workletNodeRef.current = workletNode;

    const gainNode = audioContext.createGain();
    gainNodeRef.current = gainNode;
    // Start with full volume — voice mode always plays; text mode mute is handled at playAudio level
    gainNode.gain.value = 1;
    workletNode.connect(gainNode);
    gainNode.connect(audioContext.destination);
  }, []);

  const togglePlaybackMute = useCallback(() => {
    setIsPlaybackMuted((prev) => {
      const next = !prev;
      isMutedRef.current = next;
      return next;
    });
  }, []);

  const resetPlaybackMute = useCallback(() => {
    setIsPlaybackMuted(true);
    isMutedRef.current = true;
  }, []);

  const playAudio = useCallback(
    async (base64Data: string) => {
      if (!audioContextRef.current || !workletNodeRef.current) {
        await initPlayback();
      }

      if (audioContextRef.current?.state === 'suspended') {
        await audioContextRef.current.resume();
      }

      const binary = atob(base64Data);
      const bytes = new Uint8Array(binary.length);
      for (let i = 0; i < binary.length; i++) {
        bytes[i] = binary.charCodeAt(i);
      }
      const int16Data = new Int16Array(bytes.buffer);

      workletNodeRef.current!.port.postMessage(int16Data.buffer, [int16Data.buffer]);
      setIsPlaying(true);
    },
    [initPlayback],
  );

  const stopPlayback = useCallback(() => {
    if (workletNodeRef.current) {
      workletNodeRef.current.port.postMessage(null);
    }
    setIsPlaying(false);
  }, []);

  const cleanupPlayback = useCallback(() => {
    stopPlayback();
    workletNodeRef.current?.disconnect();
    workletNodeRef.current = null;
    gainNodeRef.current?.disconnect();
    gainNodeRef.current = null;

    if (audioContextRef.current?.state !== 'closed') {
      audioContextRef.current?.close();
    }
    audioContextRef.current = null;
  }, [stopPlayback]);

  return { playAudio, stopPlayback, isPlaying, initPlayback, cleanupPlayback, isPlaybackMuted, isMutedRef, togglePlaybackMute, resetPlaybackMute };
}
