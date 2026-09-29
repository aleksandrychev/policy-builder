import { type RefObject, useEffect, useRef } from 'react';

import type { ZoomControls } from '../components/FlowCanvas';

// What each shortcut does. The command handlers return whether they acted,
// so a key that did nothing keeps its native behaviour.
export interface ShortcutHandlers {
  // Bare zoom keys only apply while the canvas tab is showing.
  canvasActive: boolean;
  onCopy: () => boolean;
  onCut: () => boolean;
  onDelete: () => boolean;
  onEscape: () => void;
  onGroup: () => void;
  onPaste: () => boolean;
  onRedo: () => void;
  onUndo: () => void;
  onUngroup: () => void;
  zoomControlsRef: RefObject<ZoomControls | null>;
}

function isEditableTarget(target: Element | null): boolean {
  if (!target) return false;
  if (['INPUT', 'TEXTAREA', 'SELECT'].includes(target.tagName)) return true;
  return (target as HTMLElement).isContentEditable;
}

// n8n-style bare zoom keys — Ctrl/Cmd +/-/0 already belong to the View menu's page zoom.
function handleZoomKey(event: KeyboardEvent, zoom: ZoomControls | null) {
  if (!zoom) return;
  const zoomActions: Record<string, () => void> = { '+': zoom.zoomIn, '=': zoom.zoomIn, '-': zoom.zoomOut, '0': zoom.reset, '1': zoom.fit };
  const zoomAction = zoomActions[event.key];
  if (!zoomAction) return;
  event.preventDefault();
  zoomAction();
}

// ⌘/Ctrl shortcuts: undo/redo, group/ungroup, copy/cut/paste.
function handleCommandKey(event: KeyboardEvent, handlers: ShortcutHandlers) {
  const key = event.key.toLowerCase();
  const run = (action: () => unknown) => {
    event.preventDefault();
    action();
  };
  if (key === 'z' || key === 'y') return run(key === 'y' || event.shiftKey ? handlers.onRedo : handlers.onUndo);
  if (key === 'g') return run(event.shiftKey ? handlers.onUngroup : handlers.onGroup);
  const command = { c: handlers.onCopy, x: handlers.onCut, v: handlers.onPaste }[key];
  if (command?.()) event.preventDefault();
}

/**
 * The project view's window-level shortcuts. Registered once; always calls the
 * latest handlers. Stays out of the way of dialogs, menus and text fields.
 */
export function useKeyboardShortcuts(handlers: ShortcutHandlers) {
  const handlersRef = useRef(handlers);
  useEffect(() => {
    handlersRef.current = handlers;
  });

  useEffect(() => {
    function handleKeyDown(event: KeyboardEvent) {
      const current = handlersRef.current;
      // A dialog, menu or popover (all MUI modals) takes priority, even with focus on its own buttons.
      if (document.querySelector('[role="dialog"], .MuiModal-root:not(.MuiModal-hidden)')) return;
      if (event.key === 'Escape') return current.onEscape();
      // Never hijack typing, or native copy/paste of actual text (TextFields, CodeMirror…).
      if (isEditableTarget(document.activeElement)) return;
      if (event.ctrlKey || event.metaKey) return handleCommandKey(event, current);
      if (event.altKey) return;
      if (event.key === 'Delete' || event.key === 'Backspace') {
        if (current.onDelete()) event.preventDefault();
        return;
      }
      if (current.canvasActive) handleZoomKey(event, current.zoomControlsRef.current);
    }
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, []);
}
