import { useEffect, useMemo, useRef, useState } from 'react';

import ChevronRightIcon from '@mui/icons-material/ChevronRight';
import ContentCopyIcon from '@mui/icons-material/ContentCopy';
import DeleteSweepOutlinedIcon from '@mui/icons-material/DeleteSweepOutlined';
import SearchIcon from '@mui/icons-material/Search';
import { Box, IconButton, InputAdornment, Stack, TextField, Typography, alpha, useTheme } from '@mui/material';

import type { LogLine } from '../../project/testRuns';
import type { TestHost } from '../../store/testEnvironmentsSlice/types';
import { HostTabs } from './HostTabs';
import { hostColor } from './hostColors';

type Tone = 'change' | 'error' | 'plain' | 'report' | 'step' | 'warning';

// What a line is, for its colour and badge: agent reports (R:), errors, warnings, changes the agent made (info:).
function toneOf(line: LogLine): Tone {
  if (line.kind === 'error' || /\berror:/.test(line.text)) return 'error';
  if (line.kind === 'step') return 'step';
  if (/\bwarning:/.test(line.text)) return 'warning';
  if (/^R: /.test(line.text)) return 'report';
  if (line.kind === 'agent' && /^\s*info:/.test(line.text)) return 'change';
  return 'plain';
}

const BADGES: Partial<Record<Tone, string>> = { error: 'ERROR', warning: 'WARNING', report: 'REPORT', change: 'CHANGED' };

type Entry = { kind: 'line'; line: LogLine } | { host?: string | null; key: string; kind: 'setup'; lines: LogLine[] };

// Consecutive setup output of one host folds into one row.
function entriesOf(lines: LogLine[]): Entry[] {
  const entries: Entry[] = [];
  lines.forEach((line, index) => {
    const last = entries.at(-1);
    if (line.kind === 'setup' && toneOf(line) === 'plain') {
      if (last?.kind === 'setup' && last.host === line.host) last.lines.push(line);
      else entries.push({ kind: 'setup', host: line.host, key: `setup-${index}`, lines: [line] });
    } else entries.push({ kind: 'line', line });
  });
  return entries;
}

const clock = (time: number) => new Date(time).toLocaleTimeString([], { hour12: false });

/** The environment's log: per host or all, coloured by host and by what each line is. */
export interface LogView {
  filter: string;
  // One host, or none for all.
  hosts: string[];
}

export function LogPane({
  hosts,
  lines,
  onClear,
  onViewChange,
  view
}: {
  hosts: TestHost[];
  lines: LogLine[];
  onClear: () => void;
  onViewChange: (view: LogView) => void;
  view: LogView;
}) {
  const theme = useTheme();
  const { hosts: selected, filter } = view;
  const setSelected = (next: string[]) => onViewChange({ ...view, hosts: next });
  const setFilter = (next: string) => onViewChange({ ...view, filter: next });
  const [open, setOpen] = useState<Set<string>>(new Set());
  const end = useRef<HTMLDivElement | null>(null);
  const indexOf = new Map(hosts.map((host, index) => [host.id, index]));
  const nameOf = new Map(hosts.map(host => [host.id, host.name]));

  const shown = useMemo(() => {
    const query = filter.trim().toLowerCase();
    return lines.filter(line => (selected.length === 0 || !line.host || selected.includes(line.host)) && (!query || line.text.toLowerCase().includes(query)));
  }, [lines, selected, filter]);
  const entries = useMemo(() => entriesOf(shown), [shown]);

  useEffect(() => {
    end.current?.scrollIntoView({ block: 'end' });
  }, [shown.length]);

  const text = shown.map(line => `${clock(line.time)} ${line.host ? `[${nameOf.get(line.host) ?? line.host}] ` : ''}${line.text}`).join('\n');
  const toneColor: Record<Tone, string> = {
    error: theme.palette.error.main,
    warning: theme.palette.warning.main,
    report: theme.palette.success.main,
    change: theme.palette.info.main,
    step: theme.palette.primary.main,
    plain: 'transparent'
  };

  const hostTag = (host?: string | null) => {
    if (!host) return <Box sx={{ width: 64, flexShrink: 0 }} />;
    const color = hostColor(theme, indexOf.get(host) ?? 0);
    return (
      <Box
        component="span"
        sx={{ flexShrink: 0, minWidth: 64, px: 0.75, borderRadius: 0.5, fontWeight: 600, color, bgcolor: alpha(color, 0.12), textAlign: 'center' }}
      >
        {nameOf.get(host) ?? host}
      </Box>
    );
  };

  return (
    <Stack sx={{ minHeight: 0, flex: 1 }} spacing={1}>
      <Stack direction="row" spacing={1} sx={{ alignItems: 'center' }}>
        <HostTabs allLabel="All logs" hosts={hosts} selected={selected} onChange={next => setSelected(next)} />
        <Box sx={{ flex: 1 }} />
        <TextField
          size="small"
          placeholder="Filter logs…"
          value={filter}
          onChange={event => setFilter(event.target.value)}
          sx={{ width: 220, minWidth: 140, flexShrink: 1 }}
          slotProps={{
            input: {
              startAdornment: (
                <InputAdornment position="start">
                  <SearchIcon sx={{ fontSize: 18 }} />
                </InputAdornment>
              )
            }
          }}
        />
        <IconButton size="small" title="Copy the log" disabled={!text} onClick={() => void navigator.clipboard.writeText(text)}>
          <ContentCopyIcon sx={{ fontSize: 18 }} />
        </IconButton>
        <IconButton size="small" title="Clear the log" disabled={lines.length === 0} onClick={onClear}>
          <DeleteSweepOutlinedIcon sx={{ fontSize: 18 }} />
        </IconButton>
      </Stack>
      <Box
        sx={{
          flex: 1,
          minHeight: 160,
          overflow: 'auto',
          border: '1px solid',
          borderColor: 'divider',
          borderRadius: 1,
          py: 0.5,
          fontFamily: 'monospace',
          fontSize: 12
        }}
      >
        {entries.length === 0 && (
          <Typography sx={{ fontSize: 12, color: 'text.muted', p: 1 }}>Nothing yet: Run test to start the hosts and run the policy.</Typography>
        )}
        {entries.map(entry => {
          if (entry.kind === 'setup') {
            const expanded = open.has(entry.key);
            return (
              <Box key={entry.key}>
                <Stack
                  direction="row"
                  spacing={1}
                  onClick={() => setOpen(current => new Set(expanded ? [...current].filter(key => key !== entry.key) : [...current, entry.key]))}
                  sx={{ alignItems: 'center', cursor: 'pointer', mx: 0.75, my: 0.25, px: 0.75, py: 0.25, borderRadius: 0.5, bgcolor: 'action.hover' }}
                >
                  <ChevronRightIcon sx={{ fontSize: 16, transform: expanded ? 'rotate(90deg)' : 'none', transition: 'transform 0.15s' }} />
                  <Box component="span" sx={{ color: 'text.muted', width: 64 }}>
                    {clock(entry.lines[0].time)}
                  </Box>
                  {hostTag(entry.host)}
                  <Box component="span" sx={{ color: 'text.secondary' }}>
                    Container setup — {entry.lines.length} {entry.lines.length === 1 ? 'line' : 'lines'}
                  </Box>
                </Stack>
                {expanded &&
                  entry.lines.map((line, index) => (
                    <Box key={index} sx={{ pl: 6, pr: 1, color: 'text.secondary', whiteSpace: 'pre-wrap', wordBreak: 'break-word' }}>
                      {line.text}
                    </Box>
                  ))}
              </Box>
            );
          }
          const { line } = entry;
          const tone = toneOf(line);
          const color = toneColor[tone];
          const badge = BADGES[tone];
          return (
            <Stack
              key={`${line.time}-${line.text}-${line.host}`}
              direction="row"
              spacing={1}
              sx={{
                alignItems: 'baseline',
                px: 1,
                py: 0.25,
                borderLeft: '3px solid',
                borderLeftColor: tone === 'plain' || tone === 'step' ? 'transparent' : color,
                bgcolor: tone === 'plain' || tone === 'step' ? 'transparent' : alpha(color, 0.08)
              }}
            >
              <Box component="span" sx={{ color: 'text.muted', width: 64, flexShrink: 0 }}>
                {clock(line.time)}
              </Box>
              {hostTag(line.host)}
              {badge && (
                <Box
                  component="span"
                  sx={{ flexShrink: 0, px: 0.5, borderRadius: 0.5, fontSize: 10, fontWeight: 700, color: theme.palette.getContrastText(color), bgcolor: color }}
                >
                  {badge}
                </Box>
              )}
              <Box
                component="span"
                sx={{
                  whiteSpace: 'pre-wrap',
                  wordBreak: 'break-word',
                  fontWeight: tone === 'step' || line.kind === 'command' ? 700 : 400,
                  color: tone === 'step' ? 'primary.main' : tone === 'plain' ? 'text.primary' : color
                }}
              >
                {tone === 'report' ? line.text.slice(3) : line.text}
              </Box>
            </Stack>
          );
        })}
        <div ref={end} />
      </Box>
    </Stack>
  );
}
