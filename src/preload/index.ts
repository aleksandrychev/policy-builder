import { contextBridge, ipcRenderer } from 'electron';

// Everything the renderer can ask the main process to do goes through this
// typed bridge (see api.d.ts — the filename is load-bearing, see the note
// there). Keep it minimal and explicit.

// ipcRenderer.invoke wraps rejections as "Error invoking remote method 'x':
// Error: <message>". The renderer shows these messages to the user, so strip
// the plumbing prefix here rather than in every consumer.
function invoke<T>(channel: string, ...invokeArgs: unknown[]): Promise<T> {
  return ipcRenderer.invoke(channel, ...invokeArgs).catch((cause: unknown) => {
    const message = cause instanceof Error ? cause.message : String(cause);
    throw new Error(message.replace(/^Error invoking remote method '[^']*': (?:\w*Error: )?/, ''));
  });
}

interface LayoutSettings {
  leftSidebarFraction: number;
  paletteHeightFraction: number;
  rightSidebarFraction: number;
}

export type MenuAction = 'new-project' | 'open-project' | 'try-demo';

const MENU_CHANNELS: Record<string, MenuAction> = {
  'menu:new-project': 'new-project',
  'menu:open-project': 'open-project',
  'menu:try-demo': 'try-demo'
};

// Menu clicks fire in the main process (see main/index.ts's
// buildApplicationMenu), so the renderer hears about them as events rather
// than a request/response — unlike everything else in `api`, which the
// renderer calls to ask main to do something.
function onMenuAction(callback: (action: MenuAction) => void): () => void {
  const listeners = Object.entries(MENU_CHANNELS).map(([channel, action]) => {
    const listener = () => callback(action);
    ipcRenderer.on(channel, listener);
    return { channel, listener };
  });
  return () => {
    for (const { channel, listener } of listeners) ipcRenderer.removeListener(channel, listener);
  };
}

const api = {
  /** Returns whether the OS currently prefers a dark color scheme. */
  shouldUseDarkColors: (): Promise<boolean> => invoke('theme:should-use-dark'),

  /** Subscribes to native File-menu clicks (New/Open/Try Demo); call the returned function to unsubscribe. */
  onMenuAction,

  /** Formats CFEngine policy text with the bundled `cfengine format` engine. */
  formatPolicy: (source: string): Promise<string> => invoke('policy:format', source),

  /** Opens a native file picker and reads the chosen file as text, or null if cancelled. */
  importTextFile: (): Promise<{ content: string; fileName: string } | null> => invoke('file:import-text'),

  /** Returns the last-saved sidebar/palette sizes, or null if none were saved yet. */
  getLayoutSettings: (): Promise<LayoutSettings | null> => invoke('layout:get'),

  /** Persists sidebar/palette sizes so they survive an app restart. */
  setLayoutSettings: (settings: LayoutSettings): Promise<void> => invoke('layout:set', settings)
};

if (process.contextIsolated) {
  try {
    contextBridge.exposeInMainWorld('api', api);
  } catch (error) {
    console.error(error);
  }
} else {
  // contextIsolation is enabled in this app, so this branch is a fallback only.
  window.api = api;
}
