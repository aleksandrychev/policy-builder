import type { Condition } from '../canvasSlice/types';

// Theme palette keys a group can be tinted with (readable in light and dark).
export const GROUP_COLORS = ['primary', 'info', 'success', 'warning', 'error', 'secondary'] as const;
export type GroupColor = (typeof GROUP_COLORS)[number];

/**
 * A named, coloured frame around blocks on one file's canvas. Its blocks
 * compile into a bundle of their own, called from the file's bundle as one
 * step: arrows and a condition can gate a group like a block, and arrows out
 * of it read the call's rolled-up outcome. Membership is explicit: each member
 * block carries `groupId`. The frame is drawn around its members, so a group
 * with no members left simply isn't shown (and comes back if an undo
 * restores a member).
 */
export interface BlockGroup {
  color: GroupColor;
  condition?: Condition;
  fileId: string;
  id: string;
  // How several arrows into the group combine (like a block's).
  incomingMode?: 'all' | 'any';
  name: string;
  // A size the user dragged the frame to. The frame is drawn as the union of
  // this and the fit around its members, so it can grow but never cut a block.
  rect?: { height: number; width: number; x: number; y: number };
}
