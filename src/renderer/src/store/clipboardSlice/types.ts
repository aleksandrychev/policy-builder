import type { BlockInstance } from '../canvasSlice/types';

/**
 * The block clipboard — single-slot, in-memory only (a deep snapshot, not a
 * live reference, so it survives the source instance or its whole file
 * being deleted before paste; not the OS clipboard, since this is a
 * single-window app and OS-level copy/paste would only add async permission
 * ceremony for no real benefit). `mode` distinguishes a plain copy (paste
 * indefinitely, never touches the source) from a cut (first paste also
 * removes the source, then downgrades to a plain copy so further pastes
 * still work, matching how OS file-manager cut/paste behaves).
 */
export interface ClipboardState {
  mode: 'copy' | 'cut' | null;
  snapshot: BlockInstance | null;
}
