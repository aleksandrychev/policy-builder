import { useEffect } from 'react';

import type { NativeEdit } from '../../../preload/api';
import { useLatest } from '../hooks/useLatest';

const NATIVE_EDITS: readonly string[] = ['copy', 'cut', 'delete', 'paste', 'redo', 'selectAll', 'undo'] satisfies NativeEdit[];

// The open project's handler: whether it ran the command (on the canvas, a tab…).
let projectCommands: ((command: string) => boolean) | null = null;

/** An Edit or View menu command: the project runs it, or else, an editing one, the focused text field. */
export function runMenuCommand(command: string) {
  if (projectCommands?.(command)) return;
  if (NATIVE_EDITS.includes(command)) window.api?.nativeEdit(command as NativeEdit).catch(() => {});
}

/** The project view's menu commands, while it's mounted. `handler` returns whether it ran the command. */
export function useProjectMenuCommands(handler: (command: string) => boolean) {
  const latest = useLatest(handler);
  useEffect(() => {
    const run = (command: string) => latest.current(command);
    projectCommands = run;
    return () => {
      if (projectCommands === run) projectCommands = null;
    };
  }, [latest]);
}
