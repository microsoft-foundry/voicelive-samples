import React from 'react';
import { AIFoundryLogo } from './AIFoundryLogo';

interface BuiltWithBadgeProps {
  className?: string;
}

export const BuiltWithBadge: React.FC<BuiltWithBadgeProps> = ({ className }) => (
  <a
    href="https://azure.microsoft.com/en-us/products/ai-foundry"
    target="_blank"
    rel="noopener noreferrer"
    className={className}
    style={badgeStyle}
    aria-label="Built with Microsoft Foundry"
  >
    <span style={logoStyle}>
      <AIFoundryLogo />
    </span>
    <span style={textBlockStyle}>
      <span style={textLine1Style}>Build & deploy AI agents with</span>
      <span style={textLine2Style}>Microsoft Foundry →</span>
    </span>
  </a>
);

const badgeStyle: React.CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  gap: '8px',
  textDecoration: 'none',
  color: 'var(--fg-2)',
  opacity: 0.9,
};

const logoStyle: React.CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  color: 'var(--fg-1)',
  fontSize: '22px',
};

const textBlockStyle: React.CSSProperties = {
  display: 'flex',
  flexDirection: 'column',
  lineHeight: 1.3,
};

const textLine1Style: React.CSSProperties = {
  fontSize: '12px',
  fontWeight: 400,
  color: 'var(--fg-2)',
};

const textLine2Style: React.CSSProperties = {
  fontSize: '14px',
  fontWeight: 600,
  color: 'var(--fg-1)',
};
