import React from 'react';
import { Text } from '@fluentui/react-components';
import type { TranscriptEntry } from '../types';

interface SessionEndedViewProps {
  sessionId: string;
  transcripts: TranscriptEntry[];
  onNewThread: () => void;
}

export const SessionEndedView: React.FC<SessionEndedViewProps> = ({
  sessionId, transcripts,
}) => {
  return (
    <div style={containerStyle}>
      {/* Session ID in bordered box — always show */}
      <div style={sessionIdBoxStyle}>
        Chat session ID: {sessionId || 'N/A'}
      </div>

      <div style={transcriptStyle}>
        {transcripts.filter(t => t.isFinal).map((entry, idx) => (
          <div key={idx} style={entryStyle}>
            <Text size={200} weight="semibold" style={{ color: 'var(--fg-2)' }}>
              {entry.role === 'user' ? 'You' : 'Agent'}
            </Text>
            <Text size={300}>{entry.text}</Text>
          </div>
        ))}
      </div>
    </div>
  );
};

const containerStyle: React.CSSProperties = {
  display: 'flex',
  flexDirection: 'column',
  alignItems: 'center',
  height: '100%',
  padding: '16px 20px',
  gap: '12px',
};

const sessionIdBoxStyle: React.CSSProperties = {
  padding: '6px 12px',
  border: '1px solid var(--colorNeutralStroke1, #d1d1d1)',
  borderRadius: '4px',
  fontSize: '13px',
  fontFamily: 'monospace',
  color: 'var(--colorNeutralForeground2, #616161)',
  background: 'transparent',
  maxWidth: '400px',
  overflow: 'hidden',
  textOverflow: 'ellipsis',
  whiteSpace: 'nowrap',
};

const transcriptStyle: React.CSSProperties = {
  flex: 1,
  overflowY: 'auto',
  display: 'flex',
  flexDirection: 'column',
  gap: '8px',
  width: '100%',
  maxWidth: '600px',
};

const entryStyle: React.CSSProperties = {
  display: 'flex',
  flexDirection: 'column',
  gap: '2px',
};
