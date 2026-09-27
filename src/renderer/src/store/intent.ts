// Cross-module intents ("open event X", "new task"): set by commands, consumed by the target module once mounted.

import { useEffect } from 'react';
import { create } from 'zustand';
import { useApp, type Module } from './app';

export interface Intent {
  module: Module;
  action: string;
  arg?: string;
  seq: number;
}

let seq = 0;

export const useIntent = create<{ intent: Intent | null }>(() => ({ intent: null }));

/** Switches to `module` and asks it to perform `action` */
export function setIntent(module: Module, action: string, arg?: string): void {
  useApp.getState().setModule(module);
  useIntent.setState({ intent: { module, action, arg, seq: ++seq } });
}

/** Handles intents addressed to `module`; the handler runs once per intent */
export function useIntentHandler(module: Module, handler: (action: string, arg?: string) => void): void {
  const intent = useIntent((s) => s.intent);
  useEffect(() => {
    if (!intent || intent.module !== module) return;
    useIntent.setState({ intent: null });
    handler(intent.action, intent.arg);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [intent, module]);
}
