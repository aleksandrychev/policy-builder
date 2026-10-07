import { Box } from '@mui/material';

/** Over the editor while an AI agent works in it: the user watches, the agent's bar has Stop. */
export function AgentLock() {
  return (
    <Box
      aria-hidden
      data-testid="agent-lock"
      sx={{ position: 'absolute', inset: 0, zIndex: 20, bgcolor: 'action.hover', cursor: 'not-allowed', backdropFilter: 'saturate(0.6)' }}
      onMouseDown={event => event.preventDefault()}
    />
  );
}
