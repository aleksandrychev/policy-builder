// Theme palette keys a group can be tinted with (readable in light and dark).
export const GROUP_COLORS = ['primary', 'info', 'success', 'warning', 'error', 'secondary'] as const;
export type GroupColor = (typeof GROUP_COLORS)[number];

/**
 * A named, coloured frame around blocks on one file's canvas — visual only
 * for now (it doesn't change execution order or the compiled policy).
 * Membership is explicit: each member block carries `groupId`. The frame is
 * drawn around its members, so a group with no members left simply isn't
 * shown (and comes back if an undo restores a member).
 */
export interface BlockGroup {
  color: GroupColor;
  fileId: string;
  id: string;
  name: string;
  // A size the user dragged the frame to. The frame is drawn as the union of
  // this and the fit around its members, so it can grow but never cut a block.
  rect?: { height: number; width: number; x: number; y: number };
}
