import { ButtonBase, Typography } from '@mui/material';

import type { Project } from '../store/projectSlice/types';

const MAX_PATH_CHARS = 48;

// Keeps both ends of a long path: "/Users/me/…/policies/web".
function middleTruncate(text: string, max = MAX_PATH_CHARS): string {
  if (text.length <= max) return text;
  const head = Math.ceil((max - 1) / 2);
  return `${text.slice(0, head)}…${text.slice(text.length - (max - 1 - head))}`;
}

/** "Project: name — /path/to/project" in the status bar; the path reveals the folder. */
export function ProjectStatusLabel({ project }: { project: Project }) {
  const { name, path } = project;
  return (
    <Typography component="span" sx={{ fontSize: 11, color: 'text.muted', whiteSpace: 'nowrap' }}>
      Project: {name} —{' '}
      {path ? (
        <ButtonBase
          title={path}
          onClick={() => window.api?.revealProject(path).catch(() => {})}
          sx={{ fontSize: 11, fontFamily: 'inherit', color: 'inherit', verticalAlign: 'baseline', '&:hover': { textDecoration: 'underline' } }}
        >
          {middleTruncate(path)}
        </ButtonBase>
      ) : (
        'not saved'
      )}
    </Typography>
  );
}
