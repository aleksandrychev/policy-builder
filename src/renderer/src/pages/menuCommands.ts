import { useEffect } from 'react';

import type { NativeEdit } from '../../../preload/api';
import type { ZoomControls } from '../components/FlowCanvas';
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

// What the project view can do for its menu commands. The edit actions that return a boolean
// say whether they acted: when they didn't, the command goes to the focused text field instead.
export interface ProjectCommandContext {
  // An agent is working, or a dialog is up: nothing reaches the project.
  blocked: boolean;
  canvasShowing: boolean;
  edit: {
    copy: () => boolean;
    cut: () => boolean;
    delete: () => boolean;
    group: () => void;
    paste: () => boolean;
    redo: () => void;
    selectAll: () => void;
    undo: () => void;
    ungroup: () => void;
  };
  textFocused: boolean;
  view: {
    // A side bar view, or null to collapse / reopen the side bar.
    showSideView: (view: 'modules' | 'policy' | null) => void;
    showTab: (index: number) => void;
    tidy: () => void;
    toggleMaximized: () => void;
    zoom: (control: keyof ZoomControls) => void;
  };
}

const SIDE_VIEW_COMMANDS: Record<string, 'modules' | 'policy' | null> = { 'sidebar-toggle': null, 'view-modules': 'modules', 'view-policy': 'policy' };

const ZOOM_COMMANDS: Record<string, keyof ZoomControls> = { zoomIn: 'zoomIn', zoomOut: 'zoomOut', zoomReset: 'reset', zoomFit: 'fit' };

// The View menu: tabs anywhere; the canvas's own commands do nothing on the other tabs.
function routeViewCommand(command: string, { canvasShowing, view }: ProjectCommandContext): boolean {
  const tab = /^tab-([0-3])$/.exec(command);
  if (tab) view.showTab(Number(tab[1]));
  else if (command in SIDE_VIEW_COMMANDS) view.showSideView(SIDE_VIEW_COMMANDS[command]);
  else if (command !== 'tidy' && command !== 'maximize' && !(command in ZOOM_COMMANDS)) return false;
  else if (!canvasShowing) return true;
  else if (command === 'tidy') view.tidy();
  else if (command === 'maximize') view.toggleMaximized();
  else view.zoom(ZOOM_COMMANDS[command]);
  return true;
}

/** Runs a menu command on the project; false leaves it to the focused text field (an Edit command) or no one. */
export function routeProjectCommand(command: string, context: ProjectCommandContext): boolean {
  if (context.blocked) return false;
  if (routeViewCommand(command, context)) return true;
  if (context.textFocused) return false;
  const { edit } = context;
  const acting: Record<string, () => boolean> = {
    copy: edit.copy,
    cut: edit.cut,
    delete: edit.delete,
    paste: edit.paste,
    group: () => (edit.group(), true),
    redo: () => (edit.redo(), true),
    selectAll: () => context.canvasShowing && (edit.selectAll(), true),
    undo: () => (edit.undo(), true),
    ungroup: () => (edit.ungroup(), true)
  };
  return acting[command]?.() ?? false;
}
