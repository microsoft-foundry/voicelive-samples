import React from 'react';
import {
  ClosedCaption24Regular,
  ClosedCaptionOff24Regular,
  Mic24Regular,
  MicOff24Regular,
  Dismiss24Regular,
} from '@fluentui/react-icons';

interface SessionControlsProps {
  isCCEnabled: boolean;
  isMuted: boolean;
  onToggleCC: () => void;
  onToggleMute: () => void;
  onEndSession: () => void;
}

export const SessionControls: React.FC<SessionControlsProps> = ({
  isCCEnabled, isMuted, onToggleCC, onToggleMute, onEndSession,
}) => {
  return (
    <div style={actionBarStyle}>
      {/* CC — icon-only, transparent, lighter neutral color */}
      <button onClick={onToggleCC} aria-label="Toggle closed captions" title="Closed captions" style={iconButtonStyle}>
        {isCCEnabled ? <ClosedCaption24Regular /> : <ClosedCaptionOff24Regular />}
      </button>

      {/* Mic — icon-only, brand border, neutral bg */}
      <button
        onClick={onToggleMute}
        aria-label={isMuted ? 'Unmute microphone' : 'Mute microphone'}
        title={isMuted ? 'Unmute' : 'Mute'}
        style={isMuted ? { ...micButtonStyle, ...mutedActiveStyle } : micButtonStyle}
      >
        {isMuted ? <MicOff24Regular /> : <Mic24Regular />}
      </button>

      {/* End — icon-only dismiss X, transparent */}
      <button onClick={onEndSession} aria-label="End session" title="End session" style={iconButtonStyle}>
        <Dismiss24Regular />
      </button>
    </div>
  );
};

/* Reference: .actionBar — gap: spacingS (8px), centered */
const actionBarStyle: React.CSSProperties = {
  display: 'flex',
  gap: '8px',
  alignItems: 'center',
  justifyContent: 'center',
  padding: '16px',
  flexShrink: 0,
};

/* Reference: .iconButton — 40x40, transparent, no border, lighter neutral color at rest */
const iconButtonStyle: React.CSSProperties = {
  width: '40px',
  height: '40px',
  padding: '8px',
  border: 'none',
  borderRadius: 'var(--borderRadiusCircular, 9999px)',
  color: 'var(--colorNeutralForeground3, #707070)',
  background: 'transparent',
  cursor: 'pointer',
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'center',
  fontFamily: 'inherit',
};

/* Reference: .micOnlyButton — 40x40, brand border, brandFg1, neutral bg1 */
const micButtonStyle: React.CSSProperties = {
  width: '40px',
  height: '40px',
  padding: '8px',
  border: '1px solid var(--colorBrandBackground, var(--voice-primary))',
  borderRadius: 'var(--borderRadiusCircular, 9999px)',
  color: 'var(--colorBrandForeground1, var(--voice-primary))',
  background: 'var(--colorNeutralBackground1, var(--bg-2))',
  cursor: 'pointer',
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'center',
  fontFamily: 'inherit',
  transition: 'all 120ms ease',
};

/* Reference: .mutedActive — neutral bg3, neutral fg1, brand stroke border */
const mutedActiveStyle: React.CSSProperties = {
  border: '1px solid var(--colorBrandStroke1, var(--voice-primary))',
  color: 'var(--colorNeutralForeground1, var(--fg-1))',
  background: 'var(--colorNeutralBackground3, var(--bg-3))',
};

/* endButtonStyle no longer needed — End is now an icon-only Dismiss button */
