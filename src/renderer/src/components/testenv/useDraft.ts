import { useEffect, useRef, useState } from 'react';

/**
 * A text field's edits, kept locally and committed once: on `flush` (blur), or on
 * unmount, since a dialog closed with Escape blurs nothing.
 */
export function useDraft(value: string, commit: (text: string) => void) {
  const [draft, setDraftState] = useState<string | null>(null);
  const pending = useRef<string | null>(null);
  const latestCommit = useRef(commit);
  useEffect(() => {
    latestCommit.current = commit;
  });
  useEffect(
    () => () => {
      if (pending.current !== null) latestCommit.current(pending.current);
    },
    []
  );
  const setDraft = (text: string) => {
    pending.current = text;
    setDraftState(text);
  };
  const flush = () => {
    const text = pending.current;
    pending.current = null;
    setDraftState(null);
    if (text !== null) latestCommit.current(text);
  };
  return { draft, flush, setDraft, value: draft ?? value };
}
