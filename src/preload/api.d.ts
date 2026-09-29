// Shape of the bridge exposed by preload/index.ts on `window.api`. Kept inline
// (rather than importing the value module) so the renderer's strict type check
// does not pull preload runtime code into the web program.
interface LayoutSettings {
  leftSidebarFraction: number;
  paletteHeightFraction: number;
  rightSidebarFraction: number;
}

type MenuAction = 'new-project' | 'open-project' | 'try-demo';

declare global {
  interface Window {
    // Optional on purpose: the bridge only exists inside Electron. Renderer
    // code runs without it under vitest/jsdom (and any future browser mode),
    api?: {
      /** Formats CFEngine policy, rejecting with a message if it cannot. */
      formatPolicy: (source: string) => Promise<string>;
      /** Returns the last-saved sidebar/palette sizes, or null if none were saved yet. */
      getLayoutSettings: () => Promise<LayoutSettings | null>;
      /** Opens a native file picker and reads the chosen file as text, or null if cancelled. */
      importTextFile: () => Promise<{ content: string; fileName: string } | null>;
      /** Subscribes to native File-menu clicks (New/Open/Try Demo); call the returned function to unsubscribe. */
      onMenuAction: (callback: (action: MenuAction) => void) => () => void;
      /** Persists sidebar/palette sizes so they survive an app restart. */
      setLayoutSettings: (settings: LayoutSettings) => Promise<void>;
      shouldUseDarkColors: () => Promise<boolean>;
    };
  }
}

export {};
