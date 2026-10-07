import { useEffect, useState } from 'react';

import PlayArrowIcon from '@mui/icons-material/PlayArrow';
import SmartToyOutlinedIcon from '@mui/icons-material/SmartToyOutlined';
import StopCircleOutlinedIcon from '@mui/icons-material/StopCircleOutlined';
import TerminalOutlinedIcon from '@mui/icons-material/TerminalOutlined';
import { Box, Button, CircularProgress, Stack, Typography } from '@mui/material';

import { type AgentActivity, isWorking, paused, resumed } from '../../mcp/activity';

const elapsed = (since: number, now: number) => {
  const seconds = Math.max(0, Math.round((now - since) / 1000));
  return seconds < 60 ? `${seconds} s` : `${Math.floor(seconds / 60)} min ${seconds % 60} s`;
};

/**
 * Shown while an AI agent works in the app (or after the user stopped it): what
 * it's doing, for how long, and Stop / Resume. The editor is locked meanwhile.
 */
export function AgentActivityBar({ activity, onToggleLog }: { activity: AgentActivity; onToggleLog: () => void }) {
  const [now, setNow] = useState(() => Date.now());
  const working = isWorking(activity, now);
  useEffect(() => {
    if (!working) return;
    const timer = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(timer);
  }, [working]);
  if (!working && !activity.paused) return null;

  const doing = activity.current?.text ?? activity.log.at(-1)?.text;
  const since = activity.task?.since ?? activity.log.find(entry => entry.at >= (activity.lastCallAt ?? 0) - 60_000)?.at ?? now;
  return (
    <Box
      role="status"
      sx={{
        display: 'flex',
        alignItems: 'center',
        gap: 1.5,
        px: 2,
        py: 0.75,
        bgcolor: activity.paused ? 'warning.light' : 'primary.main',
        color: activity.paused ? 'text.primary' : 'primary.contrastText',
        flexShrink: 0
      }}
    >
      {activity.paused ? <StopCircleOutlinedIcon fontSize="small" /> : <CircularProgress size={16} sx={{ color: 'inherit' }} />}
      <SmartToyOutlinedIcon fontSize="small" />
      <Stack sx={{ flex: 1, minWidth: 0 }}>
        <Typography sx={{ fontSize: 13, fontWeight: 600, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
          {activity.paused ? 'You stopped the AI agent' : `AI agent is working${activity.task ? `: ${activity.task.text}` : ''}`}
        </Typography>
        <Typography sx={{ fontSize: 12, opacity: 0.85, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
          {activity.paused ? 'Its calls are refused until you resume it.' : `${doing ?? 'Starting…'} · ${elapsed(since, now)} · the editor is locked meanwhile`}
        </Typography>
      </Stack>
      <Button size="small" color="inherit" startIcon={<TerminalOutlinedIcon />} onClick={onToggleLog}>
        Log
      </Button>
      {activity.paused ? (
        <Button size="small" variant="outlined" color="inherit" startIcon={<PlayArrowIcon />} onClick={resumed}>
          Resume
        </Button>
      ) : (
        <Button size="small" variant="outlined" color="inherit" startIcon={<StopCircleOutlinedIcon />} onClick={paused}>
          Stop
        </Button>
      )}
    </Box>
  );
}
