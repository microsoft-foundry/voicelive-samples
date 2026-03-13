import React from 'react';
import { Button, Text, Label, Select, Input, Textarea, Slider, Checkbox } from '@fluentui/react-components';
import { DismissRegular } from '@fluentui/react-icons';
import type { VoiceSettings } from '../types';
import type { ThemePreference } from '../hooks/useTheme';

// Transcription model options depend on the selected Voice Live model
const GPT_MULTIMODAL_MODELS = ['gpt-realtime', 'gpt-realtime-mini'];
const PHI_MULTIMODAL_MODELS = ['phi4-mm-realtime', 'phi4-mini'];

// OpenAI voices supported by Voice Live API
const OPENAI_VOICES = ['alloy', 'ash', 'ballad', 'coral', 'echo', 'sage', 'shimmer', 'verse', 'marin', 'cedar'];

// Azure Standard DragonHD voices (most common for realtime)
const AZURE_DRAGON_HD_VOICES = [
  'en-US-Ava:DragonHDLatestNeural',
  'en-US-Andrew:DragonHDLatestNeural',
  'en-US-Emma:DragonHDLatestNeural',
  'en-US-Brian:DragonHDLatestNeural',
  'en-US-Aria:DragonHDLatestNeural',
  'en-US-Davis:DragonHDLatestNeural',
  'en-US-Jenny:DragonHDLatestNeural',
  'en-US-Steffan:DragonHDLatestNeural',
];

// Special sentinel for "type your own" in the voice dropdown
const CUSTOM_VOICE_SENTINEL = '__custom__';

function getTranscribeModelOptions(model: string): { value: string; label: string }[] {
  if (GPT_MULTIMODAL_MODELS.includes(model)) {
    return [
      { value: 'gpt-4o-transcribe', label: 'gpt-4o-transcribe' },
      { value: 'gpt-4o-mini-transcribe', label: 'gpt-4o-mini-transcribe' },
      { value: 'whisper-1', label: 'whisper-1' },
    ];
  }
  // Phi multimodal and all non-multimodal models use azure-speech
  return [{ value: 'azure-speech', label: 'azure-speech' }];
}

function isAzureSpeechTranscription(model: string, transcribeModel: string): boolean {
  return PHI_MULTIMODAL_MODELS.includes(model)
    || (!GPT_MULTIMODAL_MODELS.includes(model))
    || transcribeModel === 'azure-speech';
}

// Azure Speech multilingual model languages (fallback when API locales unavailable)
const AZURE_SPEECH_LANGUAGES_FALLBACK: { value: string; label: string }[] = [
  { value: '', label: 'Auto-detect (multilingual)' },
  { value: 'en-US', label: 'English (US) [en-US]' },
  { value: 'en-GB', label: 'English (UK) [en-GB]' },
  { value: 'en-AU', label: 'English (Australia) [en-AU]' },
  { value: 'en-CA', label: 'English (Canada) [en-CA]' },
  { value: 'en-IN', label: 'English (India) [en-IN]' },
  { value: 'zh-CN', label: 'Chinese (China) [zh-CN]' },
  { value: 'fr-FR', label: 'French (France) [fr-FR]' },
  { value: 'fr-CA', label: 'French (Canada) [fr-CA]' },
  { value: 'de-DE', label: 'German (Germany) [de-DE]' },
  { value: 'hi-IN', label: 'Hindi (India) [hi-IN]' },
  { value: 'it-IT', label: 'Italian (Italy) [it-IT]' },
  { value: 'ja-JP', label: 'Japanese (Japan) [ja-JP]' },
  { value: 'ko-KR', label: 'Korean (Korea) [ko-KR]' },
  { value: 'es-ES', label: 'Spanish (Spain) [es-ES]' },
  { value: 'es-MX', label: 'Spanish (Mexico) [es-MX]' },
];

function buildAzureSpeechLanguageOptions(locales: string[]): { value: string; label: string }[] {
  if (!locales.length) return AZURE_SPEECH_LANGUAGES_FALLBACK;
  return [
    { value: '', label: 'Auto-detect (multilingual)' },
    ...locales.map((l) => ({ value: l, label: l })),
  ];
}

// GPT multimodal transcription language hints (ISO-639-1)
const GPT_TRANSCRIBE_LANGUAGES: { value: string; label: string }[] = [
  { value: '', label: 'Auto-detect' },
  { value: 'en', label: 'English' },
  { value: 'zh', label: 'Chinese' },
  { value: 'fr', label: 'French' },
  { value: 'de', label: 'German' },
  { value: 'hi', label: 'Hindi' },
  { value: 'it', label: 'Italian' },
  { value: 'ja', label: 'Japanese' },
  { value: 'ko', label: 'Korean' },
  { value: 'pt', label: 'Portuguese' },
  { value: 'es', label: 'Spanish' },
  { value: 'ar', label: 'Arabic' },
  { value: 'nl', label: 'Dutch' },
  { value: 'pl', label: 'Polish' },
  { value: 'ru', label: 'Russian' },
  { value: 'sv', label: 'Swedish' },
  { value: 'tr', label: 'Turkish' },
  { value: 'uk', label: 'Ukrainian' },
  { value: 'vi', label: 'Vietnamese' },
  { value: 'th', label: 'Thai' },
  { value: 'da', label: 'Danish' },
  { value: 'fi', label: 'Finnish' },
  { value: 'el', label: 'Greek' },
  { value: 'he', label: 'Hebrew' },
  { value: 'hu', label: 'Hungarian' },
  { value: 'id', label: 'Indonesian' },
  { value: 'no', label: 'Norwegian' },
  { value: 'ro', label: 'Romanian' },
  { value: 'cs', label: 'Czech' },
  { value: 'sk', label: 'Slovak' },
  { value: 'bg', label: 'Bulgarian' },
  { value: 'hr', label: 'Croatian' },
  { value: 'ms', label: 'Malay' },
  { value: 'ta', label: 'Tamil' },
];

interface SettingsPanelProps {
  isOpen: boolean;
  settings: VoiceSettings;
  onUpdate: (updates: Partial<VoiceSettings>) => void;
  onClose: () => void;
  azureSpeechLocales?: string[];
  theme: ThemePreference;
  onThemeChange: (theme: ThemePreference) => void;
}

export const SettingsPanel: React.FC<SettingsPanelProps> = ({
  isOpen,
  settings,
  onUpdate,
  onClose,
  azureSpeechLocales = [],
  theme,
  onThemeChange,
}) => {
  if (!isOpen) return null;

  return (
    <>
      <div style={backdropStyle} onClick={onClose} />
      <div style={panelStyle}>
        <div style={headerStyle}>
          <Text weight="semibold" size={500}>Settings</Text>
          <Button appearance="subtle" icon={<DismissRegular />} onClick={onClose} aria-label="Close settings" />
        </div>

        {/* Theme picker */}
        <div style={fieldStyle}>
          <Label weight="semibold">Theme</Label>
          <Select
            value={theme}
            onChange={(_e, data) => onThemeChange(data.value as ThemePreference)}
          >
            <option value="light">Light</option>
            <option value="dark">Dark</option>
            <option value="system">System</option>
          </Select>
        </div>

        <hr style={dividerStyle} />

        {/* Mode toggle */}
        <div style={fieldStyle}>
          <Label weight="semibold">Mode</Label>
          <div style={segmentedStyle}>
            <Button
              appearance={settings.mode === 'model' ? 'primary' : 'subtle'}
              style={{ flex: 1 }}
              onClick={() => onUpdate({ mode: 'model' })}
            >
              Model
            </Button>
            <Button
              appearance={settings.mode === 'agent' ? 'primary' : 'subtle'}
              style={{ flex: 1 }}
              onClick={() => onUpdate({ mode: 'agent' })}
              disabled={!settings.agentName && !settings.project && settings.mode !== 'agent'}
              title={!settings.agentName && !settings.project ? 'No agent configured on server' : undefined}
            >
              Agent
            </Button>
          </div>
        </div>

        {/* Voice Type + Voice (shared between modes) */}
        <div style={fieldStyle}>
          <Label weight="semibold">Voice Type</Label>
          <Select
            value={settings.voiceType}
            onChange={(_e, data) => {
              const newType = data.value as 'openai' | 'azure-standard';
              const defaultVoice = newType === 'openai' ? 'alloy' : 'en-US-Ava:DragonHDLatestNeural';
              onUpdate({ voiceType: newType, voice: defaultVoice });
            }}
          >
            <option value="openai">OpenAI</option>
            <option value="azure-standard">Azure Standard</option>
          </Select>
        </div>

        <div style={fieldStyle}>
          <Label weight="semibold">Voice</Label>
          {settings.voiceType === 'openai' ? (
            <Select
              value={settings.voice}
              onChange={(_e, data) => onUpdate({ voice: data.value })}
            >
              {OPENAI_VOICES.map((v) => (
                <option key={v} value={v}>{v}</option>
              ))}
            </Select>
          ) : (
            <>
              <Select
                value={
                  AZURE_DRAGON_HD_VOICES.includes(settings.voice)
                    ? settings.voice
                    : CUSTOM_VOICE_SENTINEL
                }
                onChange={(_e, data) => {
                  if (data.value === CUSTOM_VOICE_SENTINEL) {
                    onUpdate({ voice: '' });
                  } else {
                    onUpdate({ voice: data.value });
                  }
                }}
              >
                <optgroup label="DragonHD (Recommended)">
                  {AZURE_DRAGON_HD_VOICES.map((v) => (
                    <option key={v} value={v}>{v.replace(':DragonHDLatestNeural', '')}</option>
                  ))}
                </optgroup>
                <optgroup label="Other">
                  <option value={CUSTOM_VOICE_SENTINEL}>Custom (type below)…</option>
                </optgroup>
              </Select>
              {(!AZURE_DRAGON_HD_VOICES.includes(settings.voice)) && (
                <Input
                  style={{ marginTop: 6 }}
                  value={settings.voice}
                  onChange={(_e, data) => onUpdate({ voice: data.value })}
                  placeholder="e.g. en-US-JennyNeural"
                />
              )}
            </>
          )}
        </div>

        <hr style={dividerStyle} />

        {settings.mode === 'model' ? (
          <>
            <div style={fieldStyle}>
              <Label weight="semibold">Model</Label>
              <Select
                value={settings.model}
                onChange={(_e, data) => {
                  const newModel = data.value;
                  const validOptions = getTranscribeModelOptions(newModel);
                  const updates: Partial<VoiceSettings> = { model: newModel };
                  if (!validOptions.some((o) => o.value === settings.transcribeModel)) {
                    updates.transcribeModel = validOptions[0].value;
                    updates.inputLanguage = '';
                  }
                  onUpdate(updates);
                }}
              >
                <optgroup label="GPT Realtime">
                  <option value="gpt-realtime">gpt-realtime</option>
                  <option value="gpt-realtime-mini">gpt-realtime-mini</option>
                </optgroup>
                <optgroup label="GPT-5 Series">
                  <option value="gpt-5.2">gpt-5.2</option>
                  <option value="gpt-5.2-chat">gpt-5.2-chat</option>
                  <option value="gpt-5.1">gpt-5.1</option>
                  <option value="gpt-5.1-chat">gpt-5.1-chat</option>
                  <option value="gpt-5">gpt-5</option>
                  <option value="gpt-5-mini">gpt-5-mini</option>
                  <option value="gpt-5-nano">gpt-5-nano</option>
                  <option value="gpt-5-chat">gpt-5-chat</option>
                </optgroup>
                <optgroup label="GPT-4 Series">
                  <option value="gpt-4.1">gpt-4.1</option>
                  <option value="gpt-4.1-mini">gpt-4.1-mini</option>
                  <option value="gpt-4o">gpt-4o</option>
                  <option value="gpt-4o-mini">gpt-4o-mini</option>
                </optgroup>
                <optgroup label="Phi (Preview)">
                  <option value="phi4-mm-realtime">phi4-mm-realtime (preview)</option>
                  <option value="phi4-mini">phi4-mini (preview)</option>
                </optgroup>
              </Select>
            </div>

            <div style={fieldStyle}>
              <Label weight="semibold">System Prompt</Label>
              <Textarea
                value={settings.instructions}
                onChange={(_e, data) => onUpdate({ instructions: data.value })}
                placeholder="Optional instructions for the model..."
                rows={4}
                resize="vertical"
              />
            </div>

            <div style={fieldStyle}>
              <Label weight="semibold">
                Temperature: {settings.temperature.toFixed(1)}
              </Label>
              <Slider
                min={0}
                max={1}
                step={0.1}
                value={settings.temperature}
                onChange={(_e, data) => onUpdate({ temperature: data.value })}
              />
            </div>

            <div style={fieldStyle}>
              <Label weight="semibold">Speech Input Transcription Model</Label>
              <Select
                value={settings.transcribeModel}
                onChange={(_e, data) => onUpdate({ transcribeModel: data.value, inputLanguage: '' })}
              >
                {getTranscribeModelOptions(settings.model).map((opt) => (
                  <option key={opt.value} value={opt.value}>{opt.label}</option>
                ))}
              </Select>
            </div>

            <div style={fieldStyle}>
              <Label weight="semibold">Speech Input Language</Label>
              <Select
                value={settings.inputLanguage}
                onChange={(_e, data) => onUpdate({ inputLanguage: data.value })}
              >
                {(isAzureSpeechTranscription(settings.model, settings.transcribeModel)
                  ? buildAzureSpeechLanguageOptions(azureSpeechLocales)
                  : GPT_TRANSCRIBE_LANGUAGES
                ).map((opt) => (
                  <option key={opt.value} value={opt.value}>{opt.label}</option>
                ))}
              </Select>
            </div>
          </>
        ) : (
          <>
            <div style={fieldStyle}>
              <Label weight="semibold">Agent Name</Label>
              <Input
                value={settings.agentName}
                onChange={(_e, data) => onUpdate({ agentName: data.value })}
                placeholder="Enter agent name"
              />
            </div>

            <div style={fieldStyle}>
              <Label weight="semibold">Project</Label>
              <Input
                value={settings.project}
                onChange={(_e, data) => onUpdate({ project: data.value })}
                placeholder="Enter project name"
              />
            </div>

            <div style={fieldStyle}>
              <Label weight="semibold" style={{ color: 'var(--fg-2)' }}>
                Agent Version <span style={optionalBadgeStyle}>optional</span>
              </Label>
              <Input
                value={settings.agentVersion}
                onChange={(_e, data) => onUpdate({ agentVersion: data.value })}
                placeholder="e.g. 1.0"
              />
            </div>

            <div style={fieldStyle}>
              <Label weight="semibold" style={{ color: 'var(--fg-2)' }}>
                Conversation ID <span style={optionalBadgeStyle}>optional</span>
              </Label>
              <Input
                value={settings.conversationId}
                onChange={(_e, data) => onUpdate({ conversationId: data.value })}
                placeholder="Resume an existing conversation"
              />
            </div>

            <div style={fieldStyle}>
              <Label weight="semibold" style={{ color: 'var(--fg-2)' }}>
                Foundry Resource Override <span style={optionalBadgeStyle}>optional</span>
              </Label>
              <Input
                value={settings.foundryResourceOverride}
                onChange={(_e, data) => onUpdate({ foundryResourceOverride: data.value })}
                placeholder="Override default Foundry resource"
              />
            </div>

            <div style={fieldStyle}>
              <Label weight="semibold" style={{ color: 'var(--fg-2)' }}>
                Auth Identity Client ID <span style={optionalBadgeStyle}>optional</span>
              </Label>
              <Input
                value={settings.authIdentityClientId}
                onChange={(_e, data) => onUpdate({ authIdentityClientId: data.value })}
                placeholder="Managed identity client ID"
              />
            </div>

            <div style={fieldStyle}>
              <Label weight="semibold" style={{ color: 'var(--fg-2)' }}>
                Speech Input Language <span style={optionalBadgeStyle}>optional</span>
              </Label>
              <Select
                value={settings.inputLanguage}
                onChange={(_e, data) => onUpdate({ inputLanguage: data.value })}
              >
                {buildAzureSpeechLanguageOptions(azureSpeechLocales).map((opt) => (
                  <option key={opt.value} value={opt.value}>{opt.label}</option>
                ))}
              </Select>
            </div>
          </>
        )}

        <hr style={dividerStyle} />

        {/* Proactive Engagement */}
        <div style={checkboxRowStyle}>
          <Checkbox
            checked={settings.proactiveGreeting}
            onChange={(_e, data) => onUpdate({ proactiveGreeting: !!data.checked })}
            label="Proactive Engagement"
          />
        </div>

        {settings.proactiveGreeting && (
          <>
            <div style={fieldStyle}>
              <Label weight="semibold">Greeting Type</Label>
              <div style={segmentedStyle}>
                <Button
                  appearance={settings.greetingType === 'llm' ? 'primary' : 'subtle'}
                  style={{ flex: 1 }}
                  onClick={() => onUpdate({ greetingType: 'llm' })}
                >
                  LLM-Generated
                </Button>
                <Button
                  appearance={settings.greetingType === 'pregenerated' ? 'primary' : 'subtle'}
                  style={{ flex: 1 }}
                  onClick={() => onUpdate({ greetingType: 'pregenerated' })}
                >
                  Pre-Generated
                </Button>
              </div>
            </div>

            <div style={fieldStyle}>
              <Label weight="semibold">
                {settings.greetingType === 'llm'
                  ? 'Greeting Instruction'
                  : 'Greeting Text'}
              </Label>
              <Textarea
                value={settings.greetingText}
                onChange={(_e, data) => onUpdate({ greetingText: data.value })}
                placeholder={
                  settings.greetingType === 'llm'
                    ? 'Greet the user warmly and briefly explain how you can help.'
                    : 'Welcome! I\'m here to help you get started.'
                }
                rows={2}
                resize="vertical"
              />
            </div>
          </>
        )}

        <hr style={dividerStyle} />

        {/* Interim Response — only works with agent mode or text models in model mode */}
        {(() => {
          const isRealtimeModelMode = settings.mode === 'model'
            && [...GPT_MULTIMODAL_MODELS, ...PHI_MULTIMODAL_MODELS].includes(settings.model);
          return (
            <div style={checkboxRowStyle}>
              <Checkbox
                checked={isRealtimeModelMode ? false : settings.interimResponse}
                disabled={isRealtimeModelMode}
                onChange={(_e, data) => onUpdate({ interimResponse: !!data.checked })}
                label={
                  <>
                    Interim Response
                    {isRealtimeModelMode && (
                      <span style={{ fontSize: '12px', color: 'var(--fg-2)', marginLeft: 6 }}>(text models only)</span>
                    )}
                  </>
                }
              />
            </div>
          );
        })()}

        {settings.interimResponse && (
          <>
            <div style={fieldStyle}>
              <Label weight="semibold">Interim Response Type</Label>
              <div style={segmentedStyle}>
                <Button
                  appearance={settings.interimResponseType === 'llm' ? 'primary' : 'subtle'}
                  style={{ flex: 1 }}
                  onClick={() => onUpdate({ interimResponseType: 'llm' })}
                >
                  LLM-Generated
                </Button>
                <Button
                  appearance={settings.interimResponseType === 'static' ? 'primary' : 'subtle'}
                  style={{ flex: 1 }}
                  onClick={() => onUpdate({ interimResponseType: 'static' })}
                >
                  Static
                </Button>
              </div>
            </div>

            <div style={fieldStyle}>
              <Label weight="semibold">Triggers</Label>
              <div style={{ display: 'flex', gap: '16px' }}>
                <Checkbox
                  checked={settings.interimTriggerTool}
                  onChange={(_e, data) => onUpdate({ interimTriggerTool: !!data.checked })}
                  label="Tool Call"
                />
                <Checkbox
                  checked={settings.interimTriggerLatency}
                  onChange={(_e, data) => onUpdate({ interimTriggerLatency: !!data.checked })}
                  label="Latency"
                />
              </div>
            </div>

            {settings.interimTriggerLatency && (
              <div style={fieldStyle}>
                <Label weight="semibold">
                  Latency Threshold: {settings.interimLatencyMs}ms
                </Label>
                <Slider
                  min={50}
                  max={2000}
                  step={50}
                  value={settings.interimLatencyMs}
                  onChange={(_e, data) => onUpdate({ interimLatencyMs: data.value })}
                />
              </div>
            )}

            {settings.interimResponseType === 'llm' ? (
              <div style={fieldStyle}>
                <Label weight="semibold">LLM Instructions</Label>
                <Textarea
                  value={settings.interimInstructions}
                  onChange={(_e, data) => onUpdate({ interimInstructions: data.value })}
                  placeholder="Create friendly interim responses indicating wait time due to ongoing processing, if any."
                  rows={2}
                  resize="vertical"
                />
              </div>
            ) : (
              <div style={fieldStyle}>
                <Label weight="semibold">Static Texts (one per line)</Label>
                <Textarea
                  value={settings.interimStaticTexts}
                  onChange={(_e, data) => onUpdate({ interimStaticTexts: data.value })}
                  placeholder={"One moment please...\nLet me look that up...\nWorking on it..."}
                  rows={3}
                  resize="vertical"
                />
              </div>
            )}
          </>
        )}

        <hr style={dividerStyle} />

        <div style={fieldStyle}>
          <Label weight="semibold">VAD Type</Label>
          <Select
            value={settings.vadType}
            onChange={(_e, data) => onUpdate({ vadType: data.value as any })}
          >
            <option value="azure_semantic">Azure Semantic VAD</option>
            <option value="azure_semantic_en">Azure Semantic VAD (English)</option>
            <option value="azure_semantic_multilingual">Azure Semantic VAD (Multilingual)</option>
            <option value="server">Server VAD</option>
          </Select>
        </div>

        <div style={checkboxRowStyle}>
          <Checkbox
            checked={settings.noiseReduction}
            onChange={(_e, data) => onUpdate({ noiseReduction: !!data.checked })}
            label="Noise Reduction"
          />
        </div>

        <div style={checkboxRowStyle}>
          <Checkbox
            checked={settings.echoCancellation}
            onChange={(_e, data) => onUpdate({ echoCancellation: !!data.checked })}
            label="Echo Cancellation"
          />
        </div>
      </div>
    </>
  );
};

const backdropStyle: React.CSSProperties = {
  position: 'fixed',
  inset: 0,
  background: 'var(--backdrop)',
  zIndex: 90,
};

const panelStyle: React.CSSProperties = {
  position: 'fixed',
  top: 0,
  right: 0,
  bottom: 0,
  width: '360px',
  maxWidth: '90vw',
  background: 'var(--bg-2)',
  borderLeft: '1px solid var(--border)',
  padding: '24px',
  overflowY: 'auto',
  zIndex: 100,
  animation: 'slideIn 0.25s ease-out',
};

const headerStyle: React.CSSProperties = {
  display: 'flex',
  justifyContent: 'space-between',
  alignItems: 'center',
  marginBottom: '24px',
};

const fieldStyle: React.CSSProperties = {
  marginBottom: '16px',
  display: 'flex',
  flexDirection: 'column',
  gap: '4px',
};

const segmentedStyle: React.CSSProperties = {
  display: 'flex',
  gap: '4px',
  borderRadius: '8px',
  overflow: 'hidden',
};

const dividerStyle: React.CSSProperties = {
  border: 'none',
  borderTop: '1px solid var(--border)',
  margin: '20px 0',
};

const checkboxRowStyle: React.CSSProperties = {
  marginBottom: '12px',
};

const optionalBadgeStyle: React.CSSProperties = {
  fontSize: '12px',
  color: 'var(--fg-2)',
  border: '1px solid var(--border)',
  borderRadius: '4px',
  padding: '1px 5px',
  marginLeft: '4px',
  fontWeight: 400,
};
