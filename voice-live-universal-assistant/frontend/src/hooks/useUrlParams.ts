import { useMemo } from 'react';

export type InputMode = 'voice' | 'text';

interface UrlParams {
  /** Locked input mode from ?mode=voice|text. Undefined = user can toggle. */
  lockedMode: InputMode | undefined;
  /** True when ?lock=true — hides settings gear and mode toggle entirely. */
  isLocked: boolean;
  /** Pre-fill agent name from ?agent= */
  agent: string | undefined;
  /** Pre-fill project from ?project= */
  project: string | undefined;
  /** Override theme from ?theme=light|dark */
  theme: 'light' | 'dark' | undefined;
  /** Suppress greeting from ?greeting=false */
  greetingDisabled: boolean;
}

/**
 * Parse URL query parameters for UI locking and pre-fill behavior.
 *
 * - ?mode=voice|text  → lock to that input mode, hide toggle
 * - ?lock=true        → hide settings gear + mode toggle (full server config)
 * - ?agent=name       → pre-fill agent name
 * - ?project=name     → pre-fill project name
 * - ?theme=light|dark → override theme
 * - ?greeting=false   → disable proactive greeting
 */
export function useUrlParams(): UrlParams {
  return useMemo(() => {
    const params = new URLSearchParams(window.location.search);

    const modeParam = params.get('mode')?.toLowerCase();
    const lockedMode: InputMode | undefined =
      modeParam === 'voice' || modeParam === 'text' ? modeParam : undefined;

    const isLocked = params.get('lock')?.toLowerCase() === 'true';

    const agent = params.get('agent') || undefined;
    const project = params.get('project') || undefined;

    const themeParam = params.get('theme')?.toLowerCase();
    const theme: 'light' | 'dark' | undefined =
      themeParam === 'light' || themeParam === 'dark' ? themeParam : undefined;

    const greetingDisabled = params.get('greeting')?.toLowerCase() === 'false';

    return { lockedMode, isLocked, agent, project, theme, greetingDisabled };
  }, []);
}
