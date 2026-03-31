import React, { useRef, useEffect } from 'react';
import type { TranscriptEntry } from '../types';

interface TranscriptOverlayProps {
  transcripts: TranscriptEntry[];
}

export const TranscriptOverlay: React.FC<TranscriptOverlayProps> = ({ transcripts }) => {
  const scrollRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const el = scrollRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [transcripts]);

  const finals = transcripts.filter((t) => t.isFinal);
  const last = transcripts[transcripts.length - 1];
  const entries = [...finals];
  if (last && !last.isFinal) entries.push(last);
  if (entries.length === 0) return null;

  return (
    <div ref={scrollRef} style={containerStyle}>
      {entries.map((entry, i) => (
        <div
          key={`${entry.timestamp}-${i}`}
          style={{
            ...bubbleStyle,
            alignSelf: entry.role === 'user' ? 'flex-start' : 'flex-end',
            background: entry.role === 'user' ? 'var(--surface-overlay)' : 'var(--voice-bg-subtle)',
          }}
        >
          <span style={roleStyle}>{entry.role === 'user' ? 'You' : 'Assistant'}</span>
          <span style={textStyle}>{entry.text}</span>
        </div>
      ))}
    </div>
  );
};

const containerStyle: React.CSSProperties = {
  width: '100%',
  maxWidth: '420px',
  minHeight: '96px',
  flex: 1,
  overflowY: 'auto',
  display: 'flex',
  flexDirection: 'column',
  gap: '8px',
  padding: '0 8px',
};

const bubbleStyle: React.CSSProperties = {
  padding: '4px 8px',
  borderRadius: '4px',
  maxWidth: '85%',
  fontSize: '12px',
};

const roleStyle: React.CSSProperties = {
  fontSize: '12px',
  color: 'var(--fg-2)',
  display: 'block',
  marginBottom: '2px',
  fontWeight: 600,
};

const textStyle: React.CSSProperties = {
  fontSize: '12px',
  color: 'var(--fg-1)',
  lineHeight: 1.4,
};
