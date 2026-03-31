import { useState, useCallback, useRef, useEffect } from 'react';
import type { SessionState, TranscriptEntry, VoiceSettings, ServerMessage, VadType } from '../types';
import { useAudioCapture } from './useAudioCapture';
import { useAudioPlayback } from './useAudioPlayback';

function generateClientId(): string {
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (c) => {
    const r = (Math.random() * 16) | 0;
    const v = c === 'x' ? r : (r & 0x3) | 0x8;
    return v.toString(16);
  });
}

const DEFAULT_SETTINGS: VoiceSettings = {
  mode: 'model',
  model: 'gpt-realtime',
  voiceType: 'azure-standard',
  voice: 'en-US-Ava:DragonHDLatestNeural',
  instructions: 'You are a helpful AI assistant. Respond naturally and conversationally. Keep your responses concise but engaging.',
  temperature: 0.7,
  vadType: 'azure_semantic',
  noiseReduction: true,
  echoCancellation: true,
  transcribeModel: 'gpt-4o-transcribe',
  inputLanguage: '',
  agentName: '',
  project: '',
  agentVersion: '',
  conversationId: '',
  foundryResourceOverride: '',
  authIdentityClientId: '',
  proactiveGreeting: true,
  greetingType: 'llm',
  greetingText: '',
  interimResponse: false,
  interimResponseType: 'llm',
  interimTriggerTool: true,
  interimTriggerLatency: true,
  interimLatencyMs: 100,
  interimInstructions: '',
  interimStaticTexts: '',
};

export function useVoiceSession() {
  const [state, setState] = useState<SessionState>('idle');
  const [transcripts, setTranscripts] = useState<TranscriptEntry[]>([]);
  const [sessionId, setSessionId] = useState<string>('');
  const [settings, setSettings] = useState<VoiceSettings>(DEFAULT_SETTINGS);
  const [isCCEnabled, setIsCCEnabled] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [azureSpeechLocales, setAzureSpeechLocales] = useState<string[]>([]);
  const [configLoaded, setConfigLoaded] = useState(false);

  const wsRef = useRef<WebSocket | null>(null);
  const clientIdRef = useRef<string>(generateClientId());
  const stateRef = useRef<SessionState>(state);
  const inputModeRef = useRef<'voice' | 'text'>('voice');

  // Keep stateRef in sync so ws.onclose always reads the live value
  useEffect(() => { stateRef.current = state; }, [state]);

  // Fetch server config and languages on mount
  useEffect(() => {
    fetch('/config')
      .then((res) => res.json())
      .then((cfg) => {
        setSettings((prev) => {
          const merged = {
            ...prev,
            mode: cfg.mode || prev.mode,
            model: cfg.model || prev.model,
            voice: cfg.voice || prev.voice,
            voiceType: cfg.voiceType || prev.voiceType,
            transcribeModel: cfg.transcribeModel || prev.transcribeModel,
            instructions: cfg.instructions ?? prev.instructions,
            agentName: cfg.agentName || prev.agentName,
            project: cfg.project || prev.project,
          };
          // Auto-correct transcribeModel for cascaded (text) models
          const MULTIMODAL = ['gpt-realtime', 'gpt-realtime-mini', 'phi4-mm-realtime', 'phi4-mini'];
          if (!MULTIMODAL.includes(merged.model) && merged.transcribeModel !== 'azure-speech') {
            merged.transcribeModel = 'azure-speech';
            merged.inputLanguage = '';
          }
          return merged;
        });
        setConfigLoaded(true);
      })
      .catch((err) => {
        console.warn('Failed to fetch /config:', err);
        setConfigLoaded(true);
      });

    fetch('/languages')
      .then((res) => res.json())
      .then((data) => {
        if (data.azureSpeechLocales?.length) {
          setAzureSpeechLocales(data.azureSpeechLocales);
        }
      })
      .catch((err) => console.warn('Failed to fetch /languages:', err));
  }, []);

  const { playAudio: rawPlayAudio, stopPlayback, cleanupPlayback, initPlayback, isPlaybackMuted, isMutedRef, togglePlaybackMute, resetPlaybackMute } = useAudioPlayback();

  // In text mode, skip audio when muted. Uses ref to avoid stale closure in WebSocket handler.
  const playAudio = useCallback(async (data: string) => {
    if (inputModeRef.current === 'text' && isMutedRef.current) return;
    return rawPlayAudio(data);
  }, [rawPlayAudio, isMutedRef]);

  const sendWsMessage = useCallback((type: string, data?: any) => {
    if (wsRef.current?.readyState === WebSocket.OPEN) {
      wsRef.current.send(JSON.stringify({ type, ...data }));
    }
  }, []);

  const onAudioChunk = useCallback(
    (base64Data: string) => {
      sendWsMessage('audio_chunk', { data: base64Data });
    },
    [sendWsMessage],
  );

  const { startCapture, stopCapture, isCapturing, isMuted, toggleMute } = useAudioCapture({
    onAudioChunk,
  });

  const handleServerMessage = useCallback(
    (msg: ServerMessage) => {
      switch (msg.type) {
        case 'session_started':
          setSessionId(msg.session_id || '');
          setState('listening');
          if (inputModeRef.current === 'voice') {
            startCapture().catch((err) => {
              console.error('Mic access failed:', err);
              setState('ended');
            });
          }
          break;

        case 'audio_data':
          if (msg.data) {
            playAudio(msg.data);
          }
          break;

        case 'transcript': {
          const entry: TranscriptEntry = {
            role: msg.role || 'assistant',
            text: msg.text || '',
            isFinal: msg.isFinal ?? msg.is_final ?? true,
            timestamp: Date.now(),
          };
          setTranscripts((prev) => {
            // Update in-progress transcript for same role if not final
            if (!entry.isFinal) {
              const lastIdx = prev.length - 1;
              if (lastIdx >= 0 && prev[lastIdx].role === entry.role && !prev[lastIdx].isFinal) {
                const updated = [...prev];
                updated[lastIdx] = entry;
                return updated;
              }
            }
            return [...prev, entry];
          });
          break;
        }

        case 'status':
          if (msg.state === 'listening' || msg.state === 'thinking' || msg.state === 'speaking') {
            setState(msg.state);
          }
          break;

        case 'stop_playback':
          stopPlayback();
          break;

        case 'session_stopped':
          setState('ended');
          stopCapture();
          cleanupPlayback();
          break;

        case 'error':
          console.error('Server error:', msg.message || msg);
          setErrorMessage(msg.message || 'An unknown error occurred');
          // Only end session on fatal errors, not transient ones
          if (msg.fatal !== false) {
            setState('ended');
            stopCapture();
            cleanupPlayback();
          }
          break;
      }
    },
    [startCapture, stopCapture, playAudio, stopPlayback, cleanupPlayback],
  );

  const startSession = useCallback(async () => {
    setState('connecting');
    setTranscripts([]);
    setSessionId('');
    setErrorMessage(null);

    // Init playback context early (needs user gesture)
    await initPlayback();

    const protocol = location.protocol === 'https:' ? 'wss:' : 'ws:';
    const wsUrl = `${protocol}//${location.host}/ws/${clientIdRef.current}`;

    try {
      const ws = new WebSocket(wsUrl);
      wsRef.current = ws;

      ws.onopen = () => {
        const config: any = {
          mode: settings.mode,
          voice: settings.voice,
          voice_type: settings.voiceType,
          vad_type: settings.vadType,
          noise_reduction: settings.noiseReduction,
          echo_cancellation: settings.echoCancellation,
        };

        if (settings.mode === 'model') {
          config.model = settings.model;
          config.instructions = settings.instructions ?? '';
          config.temperature = settings.temperature;
          if (settings.transcribeModel) config.transcribe_model = settings.transcribeModel;
        } else {
          if (settings.agentName) config.agent_name = settings.agentName;
          if (settings.project) config.project = settings.project;
          if (settings.agentVersion) config.agent_version = settings.agentVersion;
          if (settings.conversationId) config.conversation_id = settings.conversationId;
          if (settings.foundryResourceOverride) config.foundry_resource_override = settings.foundryResourceOverride;
          if (settings.authIdentityClientId) config.auth_identity_client_id = settings.authIdentityClientId;
        }

        // Speech input language (shared between modes)
        if (settings.inputLanguage) config.input_language = settings.inputLanguage;

        // Proactive engagement
        config.proactive_greeting = settings.proactiveGreeting;
        if (settings.proactiveGreeting) {
          config.greeting_type = settings.greetingType;
          if (settings.greetingText) config.greeting_text = settings.greetingText;
        }

        // Interim response — not supported for realtime models in model mode
        const REALTIME_MODELS = ['gpt-realtime', 'gpt-realtime-mini', 'phi4-mm-realtime', 'phi4-mini'];
        const effectiveInterim = settings.interimResponse
          && !(settings.mode === 'model' && REALTIME_MODELS.includes(settings.model));
        config.interim_response = effectiveInterim;
        if (effectiveInterim) {
          config.interim_response_type = settings.interimResponseType;
          config.interim_trigger_tool = settings.interimTriggerTool;
          config.interim_trigger_latency = settings.interimTriggerLatency;
          config.interim_latency_ms = settings.interimLatencyMs;
          if (settings.interimResponseType === 'llm' && settings.interimInstructions) {
            config.interim_instructions = settings.interimInstructions;
          }
          if (settings.interimResponseType === 'static' && settings.interimStaticTexts) {
            config.interim_static_texts = settings.interimStaticTexts;
          }
        }

        sendWsMessage('start_session', config);
      };

      ws.onmessage = (event) => {
        try {
          const msg: ServerMessage = JSON.parse(event.data);
          handleServerMessage(msg);
        } catch (err) {
          console.error('Failed to parse server message:', err);
        }
      };

      ws.onerror = (event) => {
        console.error('WebSocket error:', event);
      };

      ws.onclose = () => {
        if (stateRef.current !== 'ended' && stateRef.current !== 'idle') {
          setState('ended');
          stopCapture();
          cleanupPlayback();
        }
      };
    } catch (err) {
      console.error('Failed to connect:', err);
      setState('ended');
      cleanupPlayback();
    }
  }, [settings, sendWsMessage, handleServerMessage, initPlayback, stopCapture, cleanupPlayback]);

  const stopSession = useCallback(() => {
    sendWsMessage('stop_session');
    wsRef.current?.close();
    wsRef.current = null;
    stopCapture();
    cleanupPlayback();
    setState('ended');
  }, [sendWsMessage, stopCapture, cleanupPlayback]);

  const updateSettings = useCallback((updates: Partial<VoiceSettings>) => {
    setSettings((prev) => ({ ...prev, ...updates }));
  }, []);

  const toggleCC = useCallback(() => {
    setIsCCEnabled((prev) => !prev);
  }, []);

  const resetSession = useCallback(() => {
    setState('idle');
    setTranscripts([]);
    setSessionId('');
    setErrorMessage(null);
    resetPlaybackMute();
    clientIdRef.current = generateClientId();
  }, []);

  const dismissError = useCallback(() => {
    setErrorMessage(null);
  }, []);

  /** Send a text message via Voice Live (conversation.item.create + response.create). */
  const sendTextMessage = useCallback((text: string) => {
    if (!text.trim()) return;
    // Barge-in: stop any playing audio when user sends input
    stopPlayback();
    // Add user transcript immediately for responsive UI
    setTranscripts((prev) => [
      ...prev,
      { role: 'user', text: text.trim(), isFinal: true, timestamp: Date.now() },
    ]);
    sendWsMessage('send_text', { text: text.trim() });
  }, [sendWsMessage, stopPlayback]);

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      wsRef.current?.close();
      stopCapture();
      cleanupPlayback();
    };
  }, [stopCapture, cleanupPlayback]);

  return {
    state,
    transcripts,
    sessionId,
    settings,
    updateSettings,
    startSession,
    stopSession,
    resetSession,
    toggleMute,
    isMuted,
    isCapturing,
    toggleCC,
    isCCEnabled,
    errorMessage,
    dismissError,
    azureSpeechLocales,
    sendTextMessage,
    configLoaded,
    setInputModeRef: useCallback((mode: 'voice' | 'text') => { inputModeRef.current = mode; }, []),
    isPlaybackMuted,
    togglePlaybackMute,
  };
}
