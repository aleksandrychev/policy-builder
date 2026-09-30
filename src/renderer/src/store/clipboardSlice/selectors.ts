import type { RootState } from '..';

export const selectClipboard = (state: RootState) => state.clipboard;

// The block cut and not pasted yet (drawn muted); derived, so undo can't leave a block stuck that way.
export const selectCutPendingId = (state: RootState) => (state.clipboard.mode === 'cut' ? (state.clipboard.snapshot?.instanceId ?? null) : null);
