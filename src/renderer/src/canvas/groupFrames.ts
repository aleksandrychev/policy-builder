import type { BlockGroup } from '../store/groupsSlice/types';

export const GROUP_NODE_PREFIX = 'group-frame:';
const PADDING = 24;
export const GROUP_TITLE_HEIGHT = 36;

export interface Rect {
  height: number;
  width: number;
  x: number;
  y: number;
}

/**
 * A group's frame, derived like condition pills and data chains: it hugs the
 * footprints of its members (each card plus the pills and chain rows that
 * belong only to it), so it's never stored and never out of date.
 */
export interface GroupFrame {
  group: BlockGroup;
  memberIds: string[];
  nodeId: string;
  rect: Rect;
}

export function boundingRect(rects: Rect[]): Rect | undefined {
  if (rects.length === 0) return undefined;
  const left = Math.min(...rects.map(rect => rect.x));
  const top = Math.min(...rects.map(rect => rect.y));
  const right = Math.max(...rects.map(rect => rect.x + rect.width));
  const bottom = Math.max(...rects.map(rect => rect.y + rect.height));
  return { x: left, y: top, width: right - left, height: bottom - top };
}

/**
 * `footprintOf(memberIds)` gives the rects the frame must enclose. Blocks
 * being dragged are left out while other members stay put, so the frame holds
 * still and a block can be dragged out of it; if every member is being
 * dragged, the frame follows them.
 */
export function deriveGroupFrames(
  groups: BlockGroup[],
  membersOf: (groupId: string) => string[],
  footprintOf: (memberIds: string[]) => Rect[],
  dragging: ReadonlySet<string>
): GroupFrame[] {
  const frames: GroupFrame[] = [];
  for (const group of groups) {
    const memberIds = membersOf(group.id);
    if (memberIds.length === 0) continue;
    const resting = memberIds.filter(id => !dragging.has(id));
    const bounds = boundingRect(footprintOf(resting.length > 0 ? resting : memberIds));
    if (!bounds) continue;
    const fit = {
      x: bounds.x - PADDING,
      y: bounds.y - PADDING - GROUP_TITLE_HEIGHT,
      width: bounds.width + 2 * PADDING,
      height: bounds.height + 2 * PADDING + GROUP_TITLE_HEIGHT
    };
    frames.push({ group, memberIds, nodeId: `${GROUP_NODE_PREFIX}${group.id}`, rect: group.rect ? boundingRect([fit, group.rect])! : fit });
  }
  // Big frames first, so smaller ones (and their title bars) draw on top.
  return frames.sort((a, b) => b.rect.width * b.rect.height - a.rect.width * a.rect.height);
}

// The frame a point falls in — the smallest, if frames overlap.
export function frameAt(frames: GroupFrame[], point: { x: number; y: number }): GroupFrame | undefined {
  const inside = frames.filter(({ rect }) => point.x >= rect.x && point.x <= rect.x + rect.width && point.y >= rect.y && point.y <= rect.y + rect.height);
  return inside.sort((a, b) => a.rect.width * a.rect.height - b.rect.width * b.rect.height)[0];
}

const overlaps = (a: Rect, b: Rect) => a.x < b.x + b.width && b.x < a.x + a.width && a.y < b.y + b.height && b.y < a.y + a.height;

/**
 * After blocks are dropped into a group: a dropped card that landed on a
 * member lines up with it, then cards are settled top to bottom — anything
 * overlapping a card above it moves down below that card. Cards that don't
 * overlap keep their spot, so the group's own arrangement survives. Returns
 * only the positions that changed.
 */
export function settleGroup(cards: (Rect & { id: string })[], droppedIds: string[], gap: number, grid: number): Record<string, { x: number; y: number }> {
  const snap = (value: number) => Math.ceil(value / grid) * grid;
  const placed = cards.map(card => ({ ...card }));
  for (const card of placed) {
    if (!droppedIds.includes(card.id)) continue;
    const landedOn = placed.find(other => !droppedIds.includes(other.id) && overlaps(card, other));
    if (landedOn) card.x = landedOn.x;
  }
  // Top edge first; on a tie the dropped card goes first (it was put there on purpose).
  placed.sort((a, b) => a.y - b.y || Number(droppedIds.includes(b.id)) - Number(droppedIds.includes(a.id)));
  for (let index = 0; index < placed.length; index++) {
    const card = placed[index];
    for (const above of placed.slice(0, index)) {
      if (overlaps(card, { ...above, height: above.height + gap - 1 })) card.y = snap(above.y + above.height + gap);
    }
  }
  const moved: Record<string, { x: number; y: number }> = {};
  for (const card of placed) {
    const original = cards.find(item => item.id === card.id)!;
    if (card.x !== original.x || card.y !== original.y) moved[card.id] = { x: card.x, y: card.y };
  }
  return moved;
}
