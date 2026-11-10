// WebSocket message types (server → client)
export type ServerMessageType =
  | 'session_started'
  | 'session_stopped'
  | 'audio_data'
  | 'transcript'
  | 'status'
  | 'stop_playback'
  | 'error';

export interface ServerMessage {
  type: ServerMessageType;
  [key: string]: any;
}

// Session state
export type SessionState = 'idle' | 'connecting' | 'listening' | 'thinking' | 'speaking' | 'ended';

// Transcript entry
export interface TranscriptEntry {
  role: 'user' | 'assistant';
  text: string;
  isFinal: boolean;
  timestamp: number;
}

export type VadType = 'azure_semantic' | 'azure_semantic_en' | 'azure_semantic_multilingual' | 'server';

export type VoiceType = 'openai' | 'azure-standard';

export type GreetingType = 'llm' | 'pregenerated';

export type InterimResponseType = 'llm' | 'static';

// Settings state
export interface VoiceSettings {
  mode: 'agent' | 'model';
  model: string;
  voiceType: VoiceType;
  voice: string;
  instructions: string;
  temperature: number;
  vadType: VadType;
  noiseReduction: boolean;
  echoCancellation: boolean;
  transcribeModel: string;
  inputLanguage: string;
  agentName: string;
  project: string;
  agentVersion: string;
  conversationId: string;
  foundryResourceOverride: string;
  authIdentityClientId: string;
  proactiveGreeting: boolean;
  greetingType: GreetingType;
  greetingText: string;
  interimResponse: boolean;
  interimResponseType: InterimResponseType;
  interimTriggerTool: boolean;
  interimTriggerLatency: boolean;
  interimLatencyMs: number;
  interimInstructions: string;
  interimStaticTexts: string;
  /**
   * Server capability from /config (not user-editable). When false, the server
   * ignores client-supplied agent, project, version, Foundry resource and
   * identity values and always uses its own configuration.
   */
  allowClientAgentOverride: boolean;
}
