import { renderHook } from '@testing-library/react';

import type { ZoomControls } from '../components/FlowCanvas';
import { type ShortcutHandlers, useKeyboardShortcuts } from './useKeyboardShortcuts';

function setUp(overrides: Partial<ShortcutHandlers> = {}) {
  const zoom = { zoomIn: vi.fn(), zoomOut: vi.fn(), reset: vi.fn(), fit: vi.fn() } satisfies ZoomControls;
  const handlers: ShortcutHandlers = {
    canvasActive: true,
    onCopy: vi.fn(() => true),
    onCut: vi.fn(() => true),
    onDelete: vi.fn(() => true),
    onEscape: vi.fn(),
    onGroup: vi.fn(),
    onPaste: vi.fn(() => true),
    onRedo: vi.fn(),
    onSave: vi.fn(),
    onUndo: vi.fn(),
    onUngroup: vi.fn(),
    zoomControlsRef: { current: zoom },
    ...overrides
  };
  const hook = renderHook((props: ShortcutHandlers) => useKeyboardShortcuts(props), { initialProps: handlers });
  return { handlers, zoom, hook };
}

// Presses a key on the window; returns whether the default was prevented.
const press = (key: string, modifiers: KeyboardEventInit = {}) => !window.dispatchEvent(new KeyboardEvent('keydown', { key, cancelable: true, ...modifiers }));

afterEach(() => document.body.replaceChildren());

describe('useKeyboardShortcuts', () => {
  it('undoes with ⌘Z / Ctrl+Z and redoes with ⌘⇧Z or Ctrl+Y', () => {
    const { handlers } = setUp();
    expect(press('z', { metaKey: true })).toBe(true);
    expect(handlers.onUndo).toHaveBeenCalledTimes(1);
    press('z', { ctrlKey: true });
    expect(handlers.onUndo).toHaveBeenCalledTimes(2);
    press('Z', { metaKey: true, shiftKey: true });
    press('y', { ctrlKey: true });
    expect(handlers.onRedo).toHaveBeenCalledTimes(2);
  });

  it('groups with ⌘G and ungroups with ⌘⇧G', () => {
    const { handlers } = setUp();
    press('g', { metaKey: true });
    press('G', { metaKey: true, shiftKey: true });
    expect(handlers.onGroup).toHaveBeenCalledTimes(1);
    expect(handlers.onUngroup).toHaveBeenCalledTimes(1);
  });

  it('keeps the native copy, cut and paste when the handler did nothing', () => {
    const { handlers } = setUp({ onCopy: vi.fn(() => false), onPaste: vi.fn(() => false) });
    expect(press('c', { metaKey: true })).toBe(false);
    expect(press('v', { metaKey: true })).toBe(false);
    expect(press('x', { metaKey: true })).toBe(true);
    expect(handlers.onCopy).toHaveBeenCalled();
    expect(handlers.onCut).toHaveBeenCalled();
  });

  it('deletes with Delete or Backspace, keeping the native key when nothing was deleted', () => {
    const { handlers } = setUp({ onDelete: vi.fn().mockReturnValueOnce(true).mockReturnValueOnce(false) });
    expect(press('Delete')).toBe(true);
    expect(press('Backspace')).toBe(false);
    expect(handlers.onDelete).toHaveBeenCalledTimes(2);
  });

  it('leaves keys to a text field that has focus, except ⌘S and Escape', () => {
    const { handlers } = setUp();
    const input = document.createElement('input');
    document.body.append(input);
    input.focus();

    expect(press('z', { metaKey: true })).toBe(false);
    expect(press('Backspace')).toBe(false);
    expect(press('c', { metaKey: true })).toBe(false);
    press('-');
    expect(handlers.onUndo).not.toHaveBeenCalled();
    expect(handlers.onDelete).not.toHaveBeenCalled();
    expect(handlers.onCopy).not.toHaveBeenCalled();

    expect(press('s', { metaKey: true })).toBe(true);
    expect(handlers.onSave).toHaveBeenCalled();
    press('Escape');
    expect(handlers.onEscape).toHaveBeenCalled();
  });

  it('leaves every key to an open dialog', () => {
    const { handlers } = setUp();
    const dialog = document.createElement('div');
    dialog.setAttribute('role', 'dialog');
    document.body.append(dialog);

    press('Escape');
    press('s', { metaKey: true });
    press('Delete');
    expect(handlers.onEscape).not.toHaveBeenCalled();
    expect(handlers.onSave).not.toHaveBeenCalled();
    expect(handlers.onDelete).not.toHaveBeenCalled();
  });

  it('zooms with bare keys and with ⌘, only while the canvas shows', () => {
    const { zoom, hook, handlers } = setUp();
    press('+');
    press('=', { metaKey: true });
    press('-');
    press('0', { ctrlKey: true });
    press('1');
    expect(zoom.zoomIn).toHaveBeenCalledTimes(2);
    expect(zoom.zoomOut).toHaveBeenCalledTimes(1);
    expect(zoom.reset).toHaveBeenCalledTimes(1);
    expect(zoom.fit).toHaveBeenCalledTimes(1);

    // ⌘1 isn't fit; ⌥ keys aren't zoom.
    press('1', { metaKey: true });
    press('-', { altKey: true });
    expect(zoom.fit).toHaveBeenCalledTimes(1);
    expect(zoom.zoomOut).toHaveBeenCalledTimes(1);

    hook.rerender({ ...handlers, canvasActive: false });
    press('+');
    press('+', { metaKey: true });
    expect(zoom.zoomIn).toHaveBeenCalledTimes(2);
  });

  it('calls the latest handlers after a re-render', () => {
    const { handlers, hook } = setUp();
    const onUndo = vi.fn();
    hook.rerender({ ...handlers, onUndo });
    press('z', { metaKey: true });
    expect(onUndo).toHaveBeenCalled();
    expect(handlers.onUndo).not.toHaveBeenCalled();
  });

  it('stops listening once unmounted', () => {
    const { handlers, hook } = setUp();
    hook.unmount();
    press('z', { metaKey: true });
    expect(handlers.onUndo).not.toHaveBeenCalled();
  });
});
