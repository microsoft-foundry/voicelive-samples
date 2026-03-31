import React from 'react';
import type { SessionState } from '../types';
import styles from './VoiceOrb.module.css';

interface VoiceOrbProps {
  state: SessionState;
  captionsActive?: boolean;
}

export const VoiceOrb: React.FC<VoiceOrbProps> = ({ state, captionsActive = false }) => {
  const isConnected = state === 'listening' || state === 'thinking' || state === 'speaking' || state === 'connecting';
  const isSpeaking = state === 'speaking';
  const isListening = state === 'listening' || state === 'connecting';

  // Reference: captionsActiveHiddenCircle hides the circle when CC is on
  const captionsClass = captionsActive ? styles.captionsActiveHidden : '';

  return (
    <div className={`${styles.pulseContainer} ${isConnected ? styles.connected : styles.disconnected} ${captionsClass}`}>
      {isConnected ? (
        /* Active state: circleWrapper → circleStack with 3 concentric rings + core */
        <div className={styles.circleWrapper}>
          <div className={`${styles.circleStack} ${isSpeaking ? styles.stackTalking : styles.stackListening}`}>
            <div className={styles.circleOuter} />
            <div className={styles.circleMid} />
            <div className={styles.circleInner} />
            {/* Active core: 160px, opacity 0.33 */}
            <div className={`${styles.circleBase} ${isListening ? styles.pulseListening : ''}`} />
          </div>
        </div>
      ) : (
        /* Idle state: circleBaseIdle — 120px, solid, no opacity */
        <div className={styles.circleWrapperIdle}>
          <div className={styles.circleBaseIdle} />
        </div>
      )}
    </div>
  );
};
