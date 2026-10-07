import type { IpcMainInvokeEvent, WebFrameMain } from 'electron';

// What `ipcMain.handle` registers; tests capture these by mocking it.
export type Handler = (event: IpcMainInvokeEvent, ...args: unknown[]) => unknown;

// The one frame the registered handlers trust.
export const trustedFrame = {} as WebFrameMain;
export const isTrustedFrame = (frame: WebFrameMain | null) => frame === trustedFrame;

/** An IPC event from the trusted frame (or, with `trusted` false, from another one). */
export function ipcEvent(trusted = true): IpcMainInvokeEvent {
  const sender = { isDestroyed: () => false, send: () => {} };
  return { senderFrame: trusted ? trustedFrame : null, sender } as unknown as IpcMainInvokeEvent;
}

/** Calls the handler registered for `channel` as the trusted renderer would. */
export function invoker(handlers: Map<string, Handler>) {
  return (channel: string, ...args: unknown[]) => {
    const handler = handlers.get(channel);
    if (!handler) throw new Error(`No handler for ${channel}`);
    return handler(ipcEvent(), ...args);
  };
}
