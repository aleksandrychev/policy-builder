import { useEffect, useRef } from 'react';

import DeleteSweepOutlinedIcon from '@mui/icons-material/DeleteSweepOutlined';
import ExpandLessIcon from '@mui/icons-material/ExpandLess';
import ExpandMoreIcon from '@mui/icons-material/ExpandMore';
import TerminalOutlinedIcon from '@mui/icons-material/TerminalOutlined';
import { Box, CircularProgress, IconButton, Stack, Tooltip, Typography } from '@mui/material';

import { type AgentActivity, type LogEntry, logCleared } from '../../mcp/activity';

const time = (at: number) => new Date(at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' });
const duration = (ms?: number) => (ms === undefined ? '' : ms < 1000 ? `${ms} ms` : `${(ms / 1000).toFixed(1)} s`);

function Line({ entry, running }: { entry: LogEntry; running?: boolean }) {
  const failed = entry.ok === false;
  return (
    <Box sx={{ display: 'flex', gap: 1.5, alignItems: 'baseline', color: failed ? 'error.main' : 'text.primary' }}>
      <Box component="span" sx={{ color: 'text.muted', flexShrink: 0 }}>
        {time(entry.at)}
      </Box>
      <Box component="span" sx={{ width: 14, flexShrink: 0, textAlign: 'center' }}>
        {running ? <CircularProgress size={10} /> : failed ? '✗' : '✓'}
      </Box>
      <Box component="span" sx={{ flex: 1, minWidth: 0, whiteSpace: 'pre-wrap', wordBreak: 'break-word' }}>
        {entry.text}
        {failed && entry.outcome && (
          <Box component="span" sx={{ display: 'block', opacity: 0.85 }}>
            {entry.outcome}
          </Box>
        )}
      </Box>
      <Box component="span" sx={{ color: 'text.muted', flexShrink: 0 }}>
        {running ? '…' : duration(entry.durationMs)}
      </Box>
    </Box>
  );
}

/** What the AI agent did in this app session, like a terminal: the latest at the bottom, the running call with a spinner. */
export function AgentLogPanel({ activity, onToggle, open }: { activity: AgentActivity; onToggle: () => void; open: boolean }) {
  const scrollRef = useRef<HTMLDivElement>(null);
  const { current, log } = activity;
  useEffect(() => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight });
  }, [log, current, open]);
  const count = activity.log.length + (activity.current ? 1 : 0);

  return (
    <Box sx={{ borderTop: '1px solid', borderColor: 'divider', bgcolor: 'background.paper', flexShrink: 0 }}>
      <Stack direction="row" sx={{ alignItems: 'center', gap: 1, px: 2, py: 0.5 }}>
        <TerminalOutlinedIcon sx={{ fontSize: 16, color: 'text.muted' }} />
        <Typography sx={{ fontSize: 12, fontWeight: 600, flex: 1 }}>
          AI agent log{' '}
          <Box component="span" sx={{ color: 'text.muted', fontWeight: 400 }}>
            {count} {count === 1 ? 'action' : 'actions'}
          </Box>
        </Typography>
        <Tooltip title="Clear the log">
          <span>
            <IconButton size="small" onClick={logCleared} disabled={activity.log.length === 0} aria-label="Clear the log">
              <DeleteSweepOutlinedIcon sx={{ fontSize: 16 }} />
            </IconButton>
          </span>
        </Tooltip>
        <IconButton size="small" onClick={onToggle} aria-label={open ? 'Hide the log' : 'Show the log'}>
          {open ? <ExpandMoreIcon sx={{ fontSize: 18 }} /> : <ExpandLessIcon sx={{ fontSize: 18 }} />}
        </IconButton>
      </Stack>
      {open && (
        <Box ref={scrollRef} sx={{ height: 180, overflowY: 'auto', px: 2, pb: 1, fontFamily: 'monospace', fontSize: 12, lineHeight: 1.6 }}>
          {count === 0 && <Typography sx={{ fontSize: 12, color: 'text.muted' }}>Nothing yet: what an AI agent does in the app shows here.</Typography>}
          {activity.log.map(entry => (
            <Line key={entry.id} entry={entry} />
          ))}
          {activity.current && <Line entry={activity.current} running />}
        </Box>
      )}
    </Box>
  );
}
