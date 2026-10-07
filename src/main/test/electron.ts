// Inert Electron for main-process unit tests (aliased in vitest.config.ts): enough for the
// modules to load. A test that needs real behaviour mocks the part it uses.
import { tmpdir } from 'os';

const noop = () => {};

export const app = {
  addRecentDocument: noop,
  clearRecentDocuments: noop,
  getPath: () => tmpdir(),
  getVersion: () => '0.0.0-test',
  isPackaged: false,
  on: noop,
  whenReady: () => Promise.resolve()
};
export const ipcMain = { handle: noop, on: noop, removeHandler: noop };
export const safeStorage = {
  isEncryptionAvailable: () => false,
  encryptString: (text: string) => Buffer.from(text),
  decryptString: (buffer: Buffer) => buffer.toString()
};
export const dialog = { showOpenDialog: async () => ({ canceled: true, filePaths: [] }), showMessageBox: async () => ({ response: 0 }) };
export const shell = { openPath: async () => '', showItemInFolder: noop };
export const nativeTheme = { shouldUseDarkColors: false, on: noop };
export class BrowserWindow {
  static fromWebContents() {
    return null;
  }
  static getAllWindows() {
    return [];
  }
}
export const Menu = { buildFromTemplate: () => ({}), setApplicationMenu: noop };
export const session = { defaultSession: {} };
