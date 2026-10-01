import { useEffect, useMemo, useState } from 'react';

import ContentCopyIcon from '@mui/icons-material/ContentCopy';
import { Alert, Box, Button, Chip, CircularProgress, Stack, Typography, alpha, useTheme } from '@mui/material';

import { RangeSetBuilder } from '@codemirror/state';
import { Decoration, EditorView } from '@codemirror/view';
import CodeMirror, { type ReactCodeMirrorRef } from '@uiw/react-codemirror';

import type { CompiledPolicyState } from '../project/useCompiledPolicy';
import { cfengineLanguage } from './editor/cfengineLanguage';

const selectedLine = Decoration.line({ class: 'cm-selected-block' });

// Tints the selected block's (or group's) lines.
function highlightLines(ranges: [number, number][]) {
  return EditorView.decorations.of(view => {
    const builder = new RangeSetBuilder<Decoration>();
    const lines = new Set(ranges.flatMap(([first, last]) => Array.from({ length: last - first + 1 }, (_, index) => first + index)));
    for (const number of [...lines].sort((a, b) => a - b)) {
      if (number <= view.state.doc.lines) builder.add(view.state.doc.line(number).from, view.state.doc.line(number).from, selectedLine);
    }
    return builder.finish();
  });
}

/**
 * The Generated Policy tab: the open file's compiled .cf, read-only, as a
 * save would write it (the file tree picks the file). The selected block or group is tinted
 * and scrolled into view.
 */
export function GeneratedPolicyView({
  compiled,
  currentFileId,
  selectedId
}: {
  compiled: CompiledPolicyState;
  currentFileId: string | null;
  // The selected block's instanceId or group's id.
  selectedId: string | null;
}) {
  const theme = useTheme();
  const { error, pathOf, pending, result } = compiled;
  const policyPath = currentFileId ? pathOf[currentFileId] : undefined;
  const text = policyPath ? result?.files[policyPath] : undefined;
  const ranges = useMemo(() => (policyPath && selectedId ? (result?.sourceMap[policyPath]?.[selectedId] ?? []) : []), [policyPath, selectedId, result]);
  const [view, setView] = useState<EditorView | null>(null);
  const [copied, setCopied] = useState(false);

  const extensions = useMemo(
    () => [cfengineLanguage, highlightLines(ranges), EditorView.theme({ '.cm-selected-block': { backgroundColor: alpha(theme.palette.primary.main, 0.16) } })],
    [ranges, theme]
  );

  useEffect(() => {
    if (!view || ranges.length === 0 || ranges[0][0] > view.state.doc.lines) return;
    view.dispatch({ effects: EditorView.scrollIntoView(view.state.doc.line(ranges[0][0]).from, { y: 'start', yMargin: 48 }) });
  }, [view, ranges, text]);

  const copy = () => {
    if (!text) return;
    void navigator.clipboard.writeText(text).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    });
  };

  if (!window.api) return <Placeholder text="The generated policy needs the desktop app." />;
  if (!policyPath) return <Placeholder text="Select a policy file in the explorer." />;

  return (
    <Box component="main" sx={{ flex: 1, minWidth: 0, display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
      {error && (
        <Alert severity="error" sx={{ borderRadius: 0 }}>
          {error}
        </Alert>
      )}
      <Box sx={{ flex: 1, minHeight: 0, position: 'relative' }}>
        <Stack
          direction="row"
          spacing={1}
          sx={{ position: 'absolute', top: 8, right: 20, zIndex: 1, alignItems: 'center', bgcolor: 'background.default', borderRadius: 1, px: 0.5 }}
        >
          <Status error={Boolean(error)} pending={pending} />
          <Button size="small" startIcon={<ContentCopyIcon sx={{ fontSize: 16 }} />} onClick={copy} disabled={!text} sx={{ textTransform: 'none' }}>
            {copied ? 'Copied' : 'Copy'}
          </Button>
        </Stack>
        <Box sx={{ height: '100%', opacity: pending && result ? 0.6 : 1, transition: 'opacity 150ms' }}>
          {text !== undefined ? (
            <CodeMirror
              ref={(instance: ReactCodeMirrorRef | null) => setView(instance?.view ?? null)}
              value={text}
              editable={false}
              theme={theme.palette.mode}
              height="100%"
              style={{ height: '100%', fontSize: 13 }}
              extensions={extensions}
              basicSetup={{ highlightActiveLine: false, highlightActiveLineGutter: false }}
            />
          ) : (
            !error && <Placeholder text="Generating the policy…" />
          )}
        </Box>
      </Box>
    </Box>
  );
}

function Placeholder({ text }: { text: string }) {
  return (
    <Box component="main" sx={{ flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
      <Typography sx={{ color: 'text.muted' }}>{text}</Typography>
    </Box>
  );
}

function Status({ error, pending }: { error: boolean; pending: boolean }) {
  if (pending)
    return (
      <Stack direction="row" spacing={0.75} sx={{ alignItems: 'center' }}>
        <CircularProgress size={12} />
        <Typography sx={{ fontSize: 12, color: 'text.muted' }}>Updating…</Typography>
      </Stack>
    );
  return <Chip size="small" color={error ? 'error' : 'success'} variant="outlined" label={error ? 'Out of date' : 'Up to date'} />;
}
