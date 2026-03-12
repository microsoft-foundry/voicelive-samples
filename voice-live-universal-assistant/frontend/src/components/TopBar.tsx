import React from 'react';
import { Button, Text } from '@fluentui/react-components';
import { Menu, MenuTrigger, MenuPopover, MenuList, MenuItem } from '@fluentui/react-components';
import { MoreHorizontalRegular, Settings24Regular, TextAlignLeftRegular, ShieldRegular, PersonFeedbackRegular, ChatAddRegular, Open16Regular } from '@fluentui/react-icons';

interface TopBarProps {
  agentName: string;
  onNewThread: () => void;
  onOpenSettings: () => void;
  showControls: boolean;
  isSessionActive?: boolean;
}

export const TopBar: React.FC<TopBarProps> = ({
  agentName,
  onNewThread,
  onOpenSettings,
  showControls,
  isSessionActive = false,
}) => {
  return (
    <div style={barStyle}>
      {/* Left: agent name with overflow ellipsis */}
      <div style={leftSectionStyle}>
        <Text as="h1" weight="semibold" size={300} style={agentNameStyle}>
          {agentName || 'Voice Assistant'}
        </Text>
      </div>

      {/* Right: controls */}
      {showControls && (
        <div style={rightStyle}>
          <Button appearance="subtle" icon={<ChatAddRegular />} onClick={onNewThread} disabled={isSessionActive}>
            New chat
          </Button>

          <Menu>
            <MenuTrigger disableButtonEnhancement>
              <Button appearance="subtle" shape="circular" icon={<MoreHorizontalRegular />} aria-label="More options" />
            </MenuTrigger>
            <MenuPopover>
              <MenuList>
                <MenuItem icon={<Settings24Regular />} onClick={() => onOpenSettings()}>Settings</MenuItem>
                <MenuItem icon={<TextAlignLeftRegular />} onClick={() => window.open('https://aka.ms/aistudio/terms', '_blank')}>Terms of use <Open16Regular style={{ marginLeft: '4px', opacity: 0.6 }} /></MenuItem>
                <MenuItem icon={<ShieldRegular />} onClick={() => window.open('https://go.microsoft.com/fwlink/?linkid=521839', '_blank')}>Privacy <Open16Regular style={{ marginLeft: '4px', opacity: 0.6 }} /></MenuItem>
                <MenuItem icon={<PersonFeedbackRegular />}>Send feedback</MenuItem>
              </MenuList>
            </MenuPopover>
          </Menu>
        </div>
      )}
    </div>
  );
};

const barStyle: React.CSSProperties = {
  display: 'flex',
  flexShrink: 0,
  alignItems: 'center',
  justifyContent: 'space-between',
  boxSizing: 'border-box',
  width: '100%',
  maxWidth: '100%',
  padding: '12px 16px',
};

const leftSectionStyle: React.CSSProperties = {
  overflow: 'hidden',
  display: 'flex',
  flex: 1,
  gap: '12px',
  alignItems: 'center',
  minWidth: 0,
};

const agentNameStyle: React.CSSProperties = {
  overflow: 'hidden',
  textOverflow: 'ellipsis',
  whiteSpace: 'nowrap',
  margin: 0,
};

const rightStyle: React.CSSProperties = {
  display: 'flex',
  flexShrink: 0,
  alignItems: 'center',
  gap: '8px',
};
