import React, { useRef, useEffect } from 'react';
import type { TranscriptEntry } from '../types';

interface ChatMessagesProps {
  transcripts: TranscriptEntry[];
}

export const ChatMessages: React.FC<ChatMessagesProps> = ({ transcripts }) => {
  const bottomRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [transcripts]);

  if (transcripts.length === 0) {
    return null;
  }

  // Filter: show all finals + only the last non-final (streaming) entry
  const filtered = transcripts.filter((entry, idx) => {
    if (entry.isFinal) return true;
    // Keep non-final only if it's the last entry
    return idx === transcripts.length - 1;
  });

  return (
    <div style={containerStyle}>
      {filtered.map((entry, idx) => (
        <div
          key={idx}
          style={{
            ...bubbleRowStyle,
            justifyContent: entry.role === 'user' ? 'flex-end' : 'flex-start',
          }}
        >
          <div
            style={{
              ...bubbleStyle,
              ...(entry.role === 'user' ? userBubbleStyle : assistantBubbleStyle),
              opacity: entry.isFinal ? 1 : 0.7,
            }}
          >
            {entry.text}
          </div>
        </div>
      ))}
      <div ref={bottomRef} />
    </div>
  );
};

const containerStyle: React.CSSProperties = {
  flex: 1,
  overflowY: 'auto',
  padding: '16px 20px',
  display: 'flex',
  flexDirection: 'column',
  gap: '8px',
};

const bubbleRowStyle: React.CSSProperties = {
  display: 'flex',
  width: '100%',
};

const bubbleStyle: React.CSSProperties = {
  maxWidth: '75%',
  padding: '8px 12px',
  borderRadius: '8px',
  fontSize: '14px',
  lineHeight: 1.4,
  wordBreak: 'break-word',
};

const userBubbleStyle: React.CSSProperties = {
  background: 'var(--colorBrandBackground, var(--voice-primary))',
  color: '#fff',
  borderBottomRightRadius: '4px',
};

const assistantBubbleStyle: React.CSSProperties = {
  background: 'var(--bg-3)',
  color: 'var(--fg-1)',
  borderBottomLeftRadius: '4px',
};
