import { useEffect, useState } from 'react';

import { Alert, Stack } from '@mui/material';

import type { CustomProblem } from '../../../../preload/api';

const CHECK_AFTER_MS = 600;
const FIELD_LABELS = { promises: 'Promises', definitions: 'Bodies and bundles' };

// One line per problem, like "Promises, line 2: Syntax error".
export const describeProblem = (problem: CustomProblem) => `${FIELD_LABELS[problem.field]}, line ${problem.line}: ${problem.message}`;

/**
 * A Custom CFEngine block's text, checked with the bundled linter (offline) a moment after the
 * user stops typing. Names from the standard library or other files are checked when testing.
 */
export function CustomTextProblems({ definitions, id, namespace, promises }: { definitions: string; id: string; namespace: string; promises: string }) {
  const [checked, setChecked] = useState<{ key: string; problems: CustomProblem[] } | null>(null);
  const key = JSON.stringify([namespace, promises, definitions]);
  useEffect(() => {
    if (!window.api || !promises.trim()) return;
    let cancelled = false;
    const timer = setTimeout(() => {
      window.api
        ?.lintCustom([{ id, namespace, promises, definitions }])
        .then(found => !cancelled && setChecked({ key, problems: found[id] ?? [] }))
        .catch(() => undefined);
    }, CHECK_AFTER_MS);
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [definitions, id, key, namespace, promises]);

  // Only the result for the text as it is now; an older one would point at the wrong lines.
  const problems = checked?.key === key ? checked.problems : [];
  if (!problems.length) return null;
  return (
    <Stack spacing={0.5}>
      {problems.map(problem => (
        <Alert key={`${problem.field}:${problem.line}:${problem.column}:${problem.message}`} severity="error" sx={{ fontSize: 12 }}>
          {describeProblem(problem)}
        </Alert>
      ))}
    </Stack>
  );
}
