import { renderHook } from '@testing-library/react';

import { type ProjectCommandContext, routeProjectCommand, runMenuCommand, useProjectMenuCommands } from './menuCommands';

function context(overrides: Partial<Omit<ProjectCommandContext, 'edit' | 'view'>> = {}, acted = true) {
  return {
    blocked: false,
    canvasShowing: true,
    textFocused: false,
    edit: {
      copy: vi.fn(() => acted),
      cut: vi.fn(() => acted),
      delete: vi.fn(() => acted),
      group: vi.fn(),
      paste: vi.fn(() => acted),
      redo: vi.fn(),
      selectAll: vi.fn(),
      undo: vi.fn(),
      ungroup: vi.fn()
    },
    view: { showSideView: vi.fn(), showTab: vi.fn(), tidy: vi.fn(), toggleMaximized: vi.fn(), zoom: vi.fn() },
    ...overrides
  } satisfies ProjectCommandContext;
}

describe('routeProjectCommand', () => {
  it('runs the Edit menu on the canvas', () => {
    const ctx = context();
    for (const command of ['undo', 'redo', 'cut', 'copy', 'paste', 'delete', 'selectAll', 'group', 'ungroup']) {
      expect(routeProjectCommand(command, ctx)).toBe(true);
    }
    for (const action of Object.values(ctx.edit)) expect(action).toHaveBeenCalledTimes(1);
  });

  it('leaves an edit with nothing to act on to the text field', () => {
    const ctx = context({}, false);
    for (const command of ['cut', 'copy', 'paste', 'delete']) expect(routeProjectCommand(command, ctx)).toBe(false);
  });

  it('leaves the Edit menu to a focused text field, but still switches tabs and zooms', () => {
    const ctx = context({ textFocused: true });
    for (const command of ['undo', 'copy', 'paste', 'delete', 'selectAll', 'group']) expect(routeProjectCommand(command, ctx)).toBe(false);
    expect(ctx.edit.undo).not.toHaveBeenCalled();
    expect(routeProjectCommand('tab-2', ctx)).toBe(true);
    expect(routeProjectCommand('zoomIn', ctx)).toBe(true);
    expect(ctx.view.showTab).toHaveBeenCalledWith(2);
    expect(ctx.view.zoom).toHaveBeenCalledWith('zoomIn');
  });

  it('does nothing while an agent works or a dialog is up', () => {
    const ctx = context({ blocked: true });
    for (const command of ['undo', 'delete', 'tab-1', 'zoomIn', 'tidy']) expect(routeProjectCommand(command, ctx)).toBe(false);
    for (const action of [...Object.values(ctx.edit), ...Object.values(ctx.view)]) expect(action).not.toHaveBeenCalled();
  });

  it('maps the View menu to tabs and the canvas’s zoom, tidy and maximize', () => {
    const ctx = context();
    routeProjectCommand('tab-0', ctx);
    routeProjectCommand('tab-3', ctx);
    expect(ctx.view.showTab.mock.calls).toEqual([[0], [3]]);
    for (const command of ['zoomIn', 'zoomOut', 'zoomReset', 'zoomFit']) routeProjectCommand(command, ctx);
    expect(ctx.view.zoom.mock.calls).toEqual([['zoomIn'], ['zoomOut'], ['reset'], ['fit']]);
    routeProjectCommand('tidy', ctx);
    routeProjectCommand('maximize', ctx);
    expect(ctx.view.tidy).toHaveBeenCalled();
    expect(ctx.view.toggleMaximized).toHaveBeenCalled();
    expect(routeProjectCommand('tab-4', ctx)).toBe(false);
  });

  it('keeps the canvas’s commands off the other tabs, selecting text there instead of blocks', () => {
    const ctx = context({ canvasShowing: false });
    for (const command of ['zoomIn', 'tidy', 'maximize']) expect(routeProjectCommand(command, ctx)).toBe(true);
    expect(ctx.view.zoom).not.toHaveBeenCalled();
    expect(ctx.view.tidy).not.toHaveBeenCalled();
    expect(routeProjectCommand('selectAll', ctx)).toBe(false);
    expect(ctx.edit.selectAll).not.toHaveBeenCalled();
  });

  it('ignores commands it doesn’t know', () => {
    expect(routeProjectCommand('reload', context())).toBe(false);
  });
});

describe('runMenuCommand', () => {
  const nativeEdit = vi.fn(async () => undefined);
  beforeEach(() => {
    nativeEdit.mockClear();
    window.api = { nativeEdit } as unknown as typeof window.api;
  });
  afterEach(() => {
    delete window.api;
  });

  it('gives the project the command first, then the text field an Edit command it declined', () => {
    const handler = vi.fn((command: string) => command === 'undo');
    renderHook(() => useProjectMenuCommands(handler));
    runMenuCommand('undo');
    expect(nativeEdit).not.toHaveBeenCalled();
    runMenuCommand('copy');
    expect(nativeEdit).toHaveBeenCalledWith('copy');
    runMenuCommand('tab-1');
    expect(nativeEdit).toHaveBeenCalledTimes(1);
  });

  it('edits text natively with no project open, and the latest handler runs', () => {
    const hook = renderHook(({ acts }) => useProjectMenuCommands(() => acts), { initialProps: { acts: true } });
    runMenuCommand('paste');
    expect(nativeEdit).not.toHaveBeenCalled();
    hook.rerender({ acts: false });
    runMenuCommand('paste');
    expect(nativeEdit).toHaveBeenCalledWith('paste');
    hook.unmount();
    runMenuCommand('selectAll');
    expect(nativeEdit).toHaveBeenLastCalledWith('selectAll');
  });
});
