import { VoiceAssistant, type VoiceAssistantConfig } from './voiceAssistant.js';

const $ = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;

const endpointInput = $('endpoint') as HTMLInputElement;
const apiKeyInput = $('apiKey') as HTMLInputElement;
const modelInput = $('model') as HTMLInputElement;
const voiceInput = $('voice') as HTMLInputElement;
const instructionsInput = $('instructions') as HTMLTextAreaElement;
const startBtn = $('start') as HTMLButtonElement;
const stopBtn = $('stop') as HTMLButtonElement;
const connStatus = $('connectionStatus');
const asstStatus = $('assistantStatus');
const transcript = $('transcript');

const assistant = new VoiceAssistant();
let streamingEl: HTMLDivElement | null = null;

function addMessage(role: string, text: string): HTMLDivElement {
  const el = document.createElement('div');
  el.className = `message ${role}`;
  el.textContent = text;
  transcript.appendChild(el);
  transcript.scrollTop = transcript.scrollHeight;
  return el;
}

assistant.setCallbacks({
  onConnectionStatusChange: (s) => {
    connStatus.textContent = s;
    connStatus.className = `badge ${s}`;
    const connected = s === 'connected';
    startBtn.disabled = connected || s === 'connecting';
    stopBtn.disabled = !connected;
    // Finalize any in-progress bubble so a new session cannot overwrite the last
    // assistant message from a session that ended mid-response.
    if (s === 'connecting' || s === 'disconnected') streamingEl = null;
  },
  onAssistantStatusChange: (s) => {
    asstStatus.textContent = s;
  },
  onUserMessage: (text) => {
    streamingEl = null;
    addMessage('user', text);
  },
  onAssistantMessage: (text, isStreaming) => {
    if (isStreaming) {
      if (!streamingEl) streamingEl = addMessage('assistant', '');
      streamingEl.textContent = text;
      transcript.scrollTop = transcript.scrollHeight;
    } else {
      if (streamingEl) streamingEl.textContent = text;
      streamingEl = null;
    }
  },
  onError: (msg) => addMessage('error', msg),
});

startBtn.addEventListener('click', async () => {
  const config: VoiceAssistantConfig = {
    endpoint: endpointInput.value.trim(),
    apiKey: apiKeyInput.value.trim(),
    model: modelInput.value.trim() || 'gpt-realtime',
    voice: voiceInput.value.trim() || 'en-US-AvaNeural',
    instructions: instructionsInput.value.trim() || 'You are a helpful assistant.',
  };
  if (!config.endpoint || !config.apiKey) {
    addMessage('error', 'Endpoint and API key are required.');
    return;
  }
  try {
    await assistant.start(config);
  } catch (e) {
    addMessage('error', `Failed to start: ${e}`);
  }
});

stopBtn.addEventListener('click', () => assistant.stop());
window.addEventListener('beforeunload', () => assistant.stop());
