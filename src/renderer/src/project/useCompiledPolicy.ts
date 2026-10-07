import { useEffect, useMemo, useRef, useState } from 'react';

import { useAppSelector } from '../store';
import { selectCurrentProject } from '../store/projectSlice/selectors';
import { type ProjectMeta, toCfbsProject } from './cfbsProject';

type CompiledPolicy = Awaited<ReturnType<NonNullable<Window['api']>['compilePolicy']>>;

export interface CompiledPolicyState {
  // The last compile's message, while it failed; the last good result stays shown.
  error: string | null;
  // The policy path of each file (by file id), as saving would write it.
  pathOf: Record<string, string>;
  pending: boolean;
  result: CompiledPolicy | null;
}

const DEBOUNCE_MS = 400;

// What the compiler reads: everything but the open file and positions.
export const compiledPart = (meta: ProjectMeta) => ({ ...meta, current_file_id: null, files: meta.files.map(({ layout: _layout, ...file }) => file) });

/** Saved project content as a key that layout-only changes and switching files leave alone. */
export const contentKey = (content: { project: object }) => JSON.stringify({ ...content, project: compiledPart(content.project as ProjectMeta) });

/**
 * The project's generated policy, compiled by the sidecar exactly as a save
 * would (nothing is written), while `enabled`: on enabling, then again once
 * edits pause. Layout-only changes (dragging without reordering) don't recompile.
 */
export function useCompiledPolicy(enabled: boolean): CompiledPolicyState {
  const project = useAppSelector(selectCurrentProject);
  const canvas = useAppSelector(state => state.canvas);
  const derivedNodes = useAppSelector(state => state.derivedNodes);
  const edges = useAppSelector(state => state.edges);
  const files = useAppSelector(state => state.files);
  const groups = useAppSelector(state => state.groups);

  const meta = useMemo(
    () => (project ? toCfbsProject({ canvas, derivedNodes, edges, files, groups, testEnvironments: [] }, project).project : null),
    [project, canvas, derivedNodes, edges, files, groups]
  );
  // What the compiler is sent.
  const key = useMemo(() => (meta ? JSON.stringify(compiledPart(meta)) : null), [meta]);
  const pathOf = useMemo(() => Object.fromEntries((meta?.files ?? []).map(file => [file.id, file.path])), [meta]);

  const [result, setResult] = useState<CompiledPolicy | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [compiledKey, setCompiledKey] = useState<string | null>(null);
  const sequence = useRef(0);

  useEffect(() => {
    if (!enabled || !key || !window.api || key === compiledKey) return;
    const timer = setTimeout(
      () => {
        const request = ++sequence.current;
        window.api
          ?.compilePolicy(JSON.parse(key) as object)
          .then(compiled => {
            if (request !== sequence.current) return;
            setResult(compiled);
            setError(null);
          })
          .catch((cause: unknown) => request === sequence.current && setError(cause instanceof Error ? cause.message : String(cause)))
          .finally(() => request === sequence.current && setCompiledKey(key));
      },
      compiledKey === null ? 0 : DEBOUNCE_MS
    );
    return () => clearTimeout(timer);
  }, [enabled, key, compiledKey]);

  return { error, pathOf, pending: Boolean(enabled && key && key !== compiledKey), result };
}
