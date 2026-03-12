import React from 'react';

interface AgentPrimaryDetailsProps {
  name: string;
  description?: string;
}

/**
 * Displays agent identity in the idle state — icon, name, and optional description.
 * Matches the Foundry Portal's AgentPrimaryDetails pattern.
 */
export const AgentPrimaryDetails: React.FC<AgentPrimaryDetailsProps> = ({
  name,
  description,
}) => {
  return (
    <div style={containerStyle}>
      <h2 style={nameStyle}>{name || 'Voice Assistant'}</h2>
      {description && <p style={descStyle}>{description}</p>}
    </div>
  );
};

const containerStyle: React.CSSProperties = {
  display: 'flex',
  flexDirection: 'column',
  alignItems: 'center',
  gap: '8px',
  padding: '16px',
};

const nameStyle: React.CSSProperties = {
  fontSize: '20px',
  fontWeight: 600,
  color: 'var(--fg-1)',
  margin: 0,
  textAlign: 'center',
};

const descStyle: React.CSSProperties = {
  fontSize: '14px',
  color: 'var(--fg-2)',
  margin: 0,
  textAlign: 'center',
  maxWidth: '400px',
};
