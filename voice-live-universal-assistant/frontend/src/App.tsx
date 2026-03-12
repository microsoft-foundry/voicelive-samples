import React, { useState, useEffect } from 'react';
import { FluentProvider, Button, Text } from '@fluentui/react-components';
import { voiceLiveLightTheme, voiceLiveDarkTheme } from './theme';
import { useVoiceSession } from './hooks/useVoiceSession';
import { useTheme } from './hooks/useTheme';
import { useUrlParams } from './hooks/useUrlParams';
import type { InputMode } from './hooks/useUrlParams';
import { TopBar } from './components/TopBar';
import { ActiveSession } from './components/ActiveSession';
import { SessionEndedView } from './components/SessionEndedView';
import { ChatMessages } from './components/ChatMessages';
import { ChatInput } from './components/ChatInput';
import { Waves } from './components/Waves';
import { SettingsPanel } from './components/SettingsPanel';
import { ErrorBanner } from './components/ErrorBanner';
import { BuiltWithBadge } from './components/BuiltWithBadge';
import { VoiceOrb } from './components/VoiceOrb';

const App: React.FC = () => {
  const {
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
    toggleCC,
    isCCEnabled,
    errorMessage,
    dismissError,
    azureSpeechLocales,
    sendTextMessage,
    configLoaded,
    setInputModeRef,
  } = useVoiceSession();

  const { theme, resolvedTheme, setTheme } = useTheme();
  const { lockedMode, isLocked, agent, project, theme: urlTheme, greetingDisabled } = useUrlParams();
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [inputMode, setInputMode] = useState<InputMode>(lockedMode ?? 'voice');

  useEffect(() => { setInputModeRef(inputMode); }, [inputMode, setInputModeRef]);

  // Apply URL param overrides once config is loaded
  useEffect(() => {
    if (!configLoaded) return;
    const overrides: Record<string, any> = {};
    if (agent) overrides.agentName = agent;
    if (project) overrides.project = project;
    if (greetingDisabled) overrides.proactiveGreeting = false;
    if (agent && project) overrides.mode = 'agent';
    if (Object.keys(overrides).length > 0) updateSettings(overrides);
  }, [configLoaded]); // eslint-disable-line react-hooks/exhaustive-deps

  // Apply URL theme override
  useEffect(() => {
    if (urlTheme) setTheme(urlTheme);
  }, [urlTheme, setTheme]);

  const isActive = state === 'connecting' || state === 'listening' || state === 'thinking' || state === 'speaking';
  const isIdle = state === 'idle';

  const handleNewThread = () => {
    if (isActive) { stopSession(); }
    resetSession();
  };

  const showControls = !isLocked;
  const agentMissingConfig = settings.mode === 'agent' && (!settings.agentName?.trim() || !settings.project?.trim());
  const startDisabled = agentMissingConfig && !isLocked;
  const agentDisplayName = settings.mode === 'agent' ? (settings.agentName || 'Voice Assistant') : (settings.model || 'Voice Assistant');
  const formatName = (name: string) => name.replace(/([a-z])([A-Z])/g, '$1 $2').replace(/[-_]/g, ' ');

  return (
    <FluentProvider theme={resolvedTheme === 'dark' ? voiceLiveDarkTheme : voiceLiveLightTheme} style={{ height: '100vh' }}>
      <div className="appContainer">
        <ErrorBanner message={errorMessage} onDismiss={dismissError} />
        <TopBar agentName={agentDisplayName} onNewThread={handleNewThread} onOpenSettings={() => setSettingsOpen(true)} showControls={showControls} isSessionActive={isActive} />

        {/* Waves — absolute positioned at bottom, inside container */}
        {(isIdle || state === 'connecting') && <div className="wavesContainer"><Waves paused={false} /></div>}

        <div className="appContent">
          <div className="chatbotArea">
            {isIdle && configLoaded && (
              <>
                {/* Agent details area */}
                <div style={agentDetailsStyle}>
                  <Text as="h1" weight="semibold" size={400}>{formatName(agentDisplayName)}</Text>
                  <Text size={300} style={{ color: 'var(--fg-2)' }}>
                    {settings.mode === 'agent'
                      ? (settings.project ? `${formatName(agentDisplayName)} with ${settings.project} project.` : 'Voice agent ready to assist.')
                      : 'Talk like you would to a person. The agent listens and responds.'}
                  </Text>
                </div>
                {/* Voice idle panel */}
                <div style={idlePanelStyle}>
                  <VoiceOrb state="idle" />
                  <div style={idleTitleStyle}>Let's talk</div>
                  <div style={idleSubtitleStyle}>
                    Talk like you would to a person. The agent listens and responds.
                  </div>
                  <Button
                    appearance="primary"
                    shape="circular"
                    size="medium"
                    onClick={() => startSession()}
                    disabled={startDisabled}
                    title={startDisabled ? 'Agent Name and Project required' : undefined}
                    style={startButtonStyle}
                  >
                    Start session
                  </Button>
                  {startDisabled && !isLocked && <Text size={200} style={{ color: 'var(--fg-2)' }}>Open Settings (···) to configure Agent Name and Project</Text>}
                </div>
              </>
            )}

            {state === 'connecting' && (
              <div style={idlePanelStyle}>
                <VoiceOrb state="connecting" />
                <Text weight="semibold" size={400}>Connecting...</Text>
              </div>
            )}

            {isActive && state !== 'connecting' && inputMode === 'voice' && (
              <ActiveSession state={state} transcripts={transcripts} isCCEnabled={isCCEnabled} isMuted={isMuted} onToggleCC={toggleCC} onToggleMute={toggleMute} onEndSession={stopSession} />
            )}

            {state === 'ended' && (
              <SessionEndedView sessionId={sessionId} transcripts={transcripts} onNewThread={handleNewThread} />
            )}

            {isActive && state !== 'connecting' && inputMode === 'text' && <ChatMessages transcripts={transcripts} />}
          </div>

          <BuiltWithBadge className="builtWithBadge" />
        </div>

        {isActive && state !== 'connecting' && inputMode === 'text' && (
          <div style={textModeBottomStyle}>
            <ChatInput onSend={sendTextMessage} />
            <Button appearance="outline" shape="circular" onClick={stopSession} aria-label="End session" size="small">✕ End</Button>
          </div>
        )}

        <SettingsPanel isOpen={settingsOpen} settings={settings} onUpdate={updateSettings} onClose={() => setSettingsOpen(false)} azureSpeechLocales={azureSpeechLocales} theme={theme} onThemeChange={setTheme} />
      </div>
    </FluentProvider>
  );
};

/* Reference-matched styles */
const agentDetailsStyle: React.CSSProperties = { overflow: 'auto', padding: '0 24px', textAlign: 'center', display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '4px', zIndex: 1 };
const idlePanelStyle: React.CSSProperties = { display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '8px', flex: 1, justifyContent: 'center', zIndex: 1, textAlign: 'center', padding: '0 24px' };
const idleTitleStyle: React.CSSProperties = { fontSize: '20px', fontWeight: 600, color: 'var(--fg-1)', marginTop: '8px' };
const idleSubtitleStyle: React.CSSProperties = { fontSize: '14px', color: 'var(--fg-2)', maxWidth: '250px', textAlign: 'center' };
const startButtonStyle: React.CSSProperties = { minWidth: '120px', maxWidth: '200px', marginTop: '24px' };
const textModeBottomStyle: React.CSSProperties = { display: 'flex', alignItems: 'center', gap: '8px', borderTop: '1px solid var(--border-subtle)', background: 'var(--bg-2)', padding: '8px' };

export default App;
