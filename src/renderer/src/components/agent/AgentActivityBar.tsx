import { useEffect, useRef, useState } from 'react';

import CheckCircleOutlineIcon from '@mui/icons-material/CheckCircleOutlineOutlined';
import PlayArrowIcon from '@mui/icons-material/PlayArrow';
import SmartToyOutlinedIcon from '@mui/icons-material/SmartToyOutlined';
import StopCircleOutlinedIcon from '@mui/icons-material/StopCircleOutlined';
import TerminalOutlinedIcon from '@mui/icons-material/TerminalOutlined';
import { Box, Button, CircularProgress, Stack, Typography } from '@mui/material';

import { type AgentActivity, isWorking, paused, resumed } from '../../mcp/activity';
import { agentName, chosenAgent } from '../../mcp/agents';

// How long "may work again" stays after Allow again.
const ALLOWED_MS = 6000;

const elapsed = (since: number, now: number) => {
  const seconds = Math.max(0, Math.round((now - since) / 1000));
  return seconds < 60 ? `${seconds} s` : `${Math.floor(seconds / 60)} min ${seconds % 60} s`;
};

/**
 * Shown while an AI agent works in the app (or after the user stopped it): what
 * it's doing, for how long, and Stop / Allow again. The editor is locked meanwhile.
 * The app can't wake a stopped agent: it waits for the user in the agent itself.
 */
export function AgentActivityBar({ activity, onToggleLog }: { activity: AgentActivity; onToggleLog: () => void }) {
  const [now, setNow] = useState(() => Date.now());
  const [allowed, setAllowed] = useState(false);
  const allowedTimer = useRef<ReturnType<typeof setTimeout>>(undefined);
  const working = isWorking(activity, now);
  useEffect(() => {
    if (!working) return;
    const timer = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(timer);
  }, [working]);
  useEffect(() => () => clearTimeout(allowedTimer.current), []);

  const stop = () => {
    clearTimeout(allowedTimer.current);
    setAllowed(false);
    paused();
  };
  const allowAgain = () => {
    resumed();
    setAllowed(true);
    clearTimeout(allowedTimer.current);
    allowedTimer.current = setTimeout(() => setAllowed(false), ALLOWED_MS);
  };

  const where = agentName(chosenAgent());
  if (allowed && !working && !activity.paused) {
    return (
      <Box
        role="status"
        sx={{ display: 'flex', alignItems: 'center', gap: 1.5, px: 2, py: 0.75, bgcolor: 'success.main', color: 'success.contrastText', flexShrink: 0 }}
      >
        <CheckCircleOutlineIcon fontSize="small" />
        <SmartToyOutlinedIcon fontSize="small" />
        <Stack sx={{ flex: 1, minWidth: 0 }}>
          <Typography sx={{ fontSize: 13, fontWeight: 600 }}>The AI agent may work again</Typography>
          <Typography sx={{ fontSize: 12, opacity: 0.85 }}>Tell it in {where} to continue.</Typography>
        </Stack>
      </Box>
    );
  }
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
          {activity.paused
            ? `It was told to stop and ask you what to do: answer it in ${where}. Its calls are refused until you allow them again.`
            : `${doing ?? 'Starting…'} · ${elapsed(since, now)} · the editor is locked meanwhile`}
        </Typography>
      </Stack>
      <Button size="small" color="inherit" startIcon={<TerminalOutlinedIcon />} onClick={onToggleLog}>
        Log
      </Button>
      {activity.paused ? (
        <Button size="small" variant="outlined" color="inherit" startIcon={<PlayArrowIcon />} onClick={allowAgain}>
          Allow again
        </Button>
      ) : (
        <Button size="small" variant="outlined" color="inherit" startIcon={<StopCircleOutlinedIcon />} onClick={stop}>
          Stop
        </Button>
      )}
    </Box>
  );
}
