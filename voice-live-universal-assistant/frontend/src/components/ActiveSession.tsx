import React from 'react';
import { Text } from '@fluentui/react-components';
import type { SessionState, TranscriptEntry } from '../types';
import { VoiceOrb } from './VoiceOrb';
import { SessionControls } from './SessionControls';
import { TranscriptOverlay } from './TranscriptOverlay';

interface ActiveSessionProps {
  state: SessionState;
  transcripts: TranscriptEntry[];
  isCCEnabled: boolean;
  isMuted: boolean;
  onToggleCC: () => void;
  onToggleMute: () => void;
  onEndSession: () => void;
}

const statusTextMap: Record<string, string> = {
  connecting: 'Connecting...',
  listening: 'Listening...',
  thinking: 'Thinking...',
  speaking: 'Talk to interrupt...',
};

export const ActiveSession: React.FC<ActiveSessionProps> = ({
  state,
  transcripts,
  isCCEnabled,
  isMuted,
  onToggleCC,
  onToggleMute,
  onEndSession,
}) => {
  const hasTranscripts = isCCEnabled && transcripts.length > 0;

  return (
    <div style={containerStyle}>
      {hasTranscripts ? (
        /* CC active layout: transcript fills space, status text inline, no orb */
        <>
          <div style={transcriptAreaStyle}>
            <TranscriptOverlay transcripts={transcripts} />
          </div>
          <div style={statusOnlyStyle}>
            <Text weight="semibold" size={400} style={{ color: 'var(--colorNeutralForeground1, var(--fg-1))' }}>
              {statusTextMap[state] || ''}
            </Text>
          </div>
        </>
      ) : (
        /* Normal voice layout: orb centered with status text */
        <div style={orbAreaStyle}>
          <VoiceOrb state={state} />
          <Text weight="semibold" size={400} style={{ color: 'var(--colorNeutralForeground1, var(--fg-1))' }}>
            {statusTextMap[state] || ''}
          </Text>
        </div>
      )}

      <SessionControls
        isCCEnabled={isCCEnabled}
        isMuted={isMuted}
        onToggleCC={onToggleCC}
        onToggleMute={onToggleMute}
        onEndSession={onEndSession}
      />
    </div>
  );
};

/* Reference: .panelRoot — centered, full height, gap spacingXL (20px) */
const containerStyle: React.CSSProperties = {
  display: 'flex',
  flexDirection: 'column',
  alignItems: 'center',
  height: '100%',
  boxSizing: 'border-box',
  gap: '12px',
};

const transcriptAreaStyle: React.CSSProperties = {
  flex: 1,
  width: '100%',
  display: 'flex',
  justifyContent: 'center',
  minHeight: 0,
  overflow: 'hidden',
};

const orbAreaStyle: React.CSSProperties = {
  display: 'flex',
  flexDirection: 'column',
  alignItems: 'center',
  gap: '20px',
  flex: 1,
  justifyContent: 'center',
};

/* CC mode: just status text, minimal height */
const statusOnlyStyle: React.CSSProperties = {
  display: 'flex',
  justifyContent: 'center',
  padding: '4px 0',
  flexShrink: 0,
};
