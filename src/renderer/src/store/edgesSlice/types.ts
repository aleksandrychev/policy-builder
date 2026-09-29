// A block's outcome as seen by a `methods:` call wrapped in
// classes => results("bundle", "block_<id>"): the bundle's promises roll up
// into exactly one of kept / repaired / not_kept (verified with cf-agent:
// not_kept wins over repaired, repaired over kept). Values match the
// results() class suffixes.
export type BlockOutcome = 'kept' | 'not_kept' | 'repaired';

/**
 * An arrow on a file's canvas: `target` runs only after `source` ended with
 * one of `outcomes` (OR-ed; never empty). At most one arrow per
 * source/target pair — its outcomes are edited on the arrow, not by drawing
 * another one. Compiles to the source call's results() classes plus an
 * if => "block_<source>_kept|block_<source>_repaired" gate on the target's
 * call — all three outcomes as "block_<source>_reached" — combined with its
 * other incoming arrows per the target's incomingMode. Arrows never
 * cross files — results classes here are bundle-scoped to the file's entry
 * bundle — and never form a cycle (refused when drawn).
 */
export interface BlockEdge {
  fileId: string;
  id: string;
  outcomes: BlockOutcome[];
  source: string;
  target: string;
}
