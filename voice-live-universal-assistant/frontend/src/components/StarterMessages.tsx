import React from 'react';

interface StarterMessagesProps {
  prompts: string[];
  onPromptClick: (prompt: string) => void;
}

/**
 * Clickable starter prompt cards shown in idle state.
 * Matches the Foundry Portal's StarterMessages pattern.
 */
export const StarterMessages: React.FC<StarterMessagesProps> = ({
  prompts,
  onPromptClick,
}) => {
  if (prompts.length === 0) return null;

  return (
    <div style={containerStyle}>
      {prompts.map((prompt, idx) => (
        <button
          key={idx}
          style={cardStyle}
          onClick={() => onPromptClick(prompt)}
          title={prompt}
        >
          {prompt}
        </button>
      ))}
    </div>
  );
};

const containerStyle: React.CSSProperties = {
  display: 'flex',
  flexWrap: 'wrap',
  justifyContent: 'center',
  gap: '10px',
  padding: '8px 20px',
  maxWidth: '600px',
};

const cardStyle: React.CSSProperties = {
  padding: '10px 16px',
  borderRadius: '12px',
  border: '1px solid var(--border-subtle)',
  background: 'var(--surface)',
  color: 'var(--fg-2)',
  fontSize: '14px',
  cursor: 'pointer',
  transition: 'background 0.15s, border-color 0.15s',
  maxWidth: '280px',
  textAlign: 'left',
  lineHeight: 1.4,
};
