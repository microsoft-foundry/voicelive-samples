import React, { useState, useRef } from 'react';
import { Button } from '@fluentui/react-components';
import { SendRegular } from '@fluentui/react-icons';

interface ChatInputProps {
  onSend: (text: string) => void;
  disabled?: boolean;
  placeholder?: string;
}

export const ChatInput: React.FC<ChatInputProps> = ({
  onSend,
  disabled = false,
  placeholder = 'Type a message...',
}) => {
  const [text, setText] = useState('');
  const inputRef = useRef<HTMLInputElement>(null);

  const handleSend = () => {
    if (text.trim() && !disabled) {
      onSend(text);
      setText('');
      inputRef.current?.focus();
    }
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      handleSend();
    }
  };

  return (
    <div style={barStyle}>
      <input
        ref={inputRef}
        type="text"
        value={text}
        onChange={(e) => setText(e.target.value)}
        onKeyDown={handleKeyDown}
        placeholder={placeholder}
        disabled={disabled}
        style={inputStyle}
        aria-label="Message input"
      />
      <Button
        appearance="primary"
        shape="square"
        icon={<SendRegular />}
        onClick={handleSend}
        disabled={disabled || !text.trim()}
        aria-label="Send message"
        title="Send"
      />
    </div>
  );
};

const barStyle: React.CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  gap: '8px',
  padding: '12px 20px',
  borderTop: '1px solid var(--border-subtle)',
  background: 'var(--bg-2)',
};

const inputStyle: React.CSSProperties = {
  flex: 1,
  padding: '8px 12px',
  borderRadius: '8px',
  border: '1px solid var(--border-subtle)',
  background: 'var(--bg-1)',
  color: 'var(--fg-1)',
  fontSize: '14px',
  outline: 'none',
};
