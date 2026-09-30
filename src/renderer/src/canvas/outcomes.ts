import type { BlockDescriptor } from '../blocks/types';
import type { BlockOutcome } from '../store/edgesSlice/types';

type OutcomeColor = 'error' | 'info' | 'success' | 'warning';

// What an arrow can wait for, in menu order. Colours follow Mission Portal's
// compliance convention (kept green, repaired amber, not kept red). `help` is
// the one-line plain-language meaning, for users who don't know CFEngine's
// promise outcomes.
export const OUTCOMES: { color: OutcomeColor; help: string; label: string; outcome: BlockOutcome; symbol: string }[] = [
  { outcome: 'kept', label: 'kept', symbol: '✓', color: 'success', help: 'Everything was already as it should be — nothing had to change.' },
  { outcome: 'repaired', label: 'repaired', symbol: '↻', color: 'warning', help: 'It had to change something to get there, e.g. rewrote a file.' },
  { outcome: 'not_kept', label: 'not kept', symbol: '✕', color: 'error', help: 'It tried but failed — an error, or it wasn’t allowed.' }
];

// An arrow's outcomes are OR-ed: any one of them lets the target run. All
// three together is "any outcome" (results()' `_reached` class).
export function describeOutcomes(outcomes: BlockOutcome[]): { color: OutcomeColor; help: string; label: string; symbol: string } {
  const picked = OUTCOMES.filter(option => outcomes.includes(option.outcome));
  if (picked.length === OUTCOMES.length) return { color: 'info', label: 'any outcome', symbol: '→', help: 'It ran — whatever the result.' };
  if (picked.length === 1) return picked[0];
  const label = picked.map(option => option.label).join(' or ');
  return { color: 'info', label, symbol: picked.map(option => option.symbol).join(''), help: `It ended ${label} — either one will do.` };
}

// Ticks or unticks one outcome, keeping menu order; the last one can't be
// unticked (an arrow always waits for something — remove it instead).
export function toggleOutcome(outcomes: BlockOutcome[], outcome: BlockOutcome): BlockOutcome[] {
  const next = outcomes.includes(outcome) ? outcomes.filter(item => item !== outcome) : [...outcomes, outcome];
  return next.length === 0 ? outcomes : OUTCOMES.map(option => option.outcome).filter(item => next.includes(item));
}

export const ALL_OUTCOMES: BlockOutcome[] = OUTCOMES.map(option => option.outcome);

// What a newly drawn arrow waits for: "kept" unless the source block type
// says otherwise (render-template: "repaired", i.e. "the rendered file
// changed" — the restart-after-config-change case).
export function defaultOutcomesFor(descriptor: BlockDescriptor | undefined): BlockOutcome[] {
  return [descriptor?.arrow_default_outcome ?? 'kept'];
}
