import { useEffect, useMemo, useState } from 'react';

import ArrowBackIcon from '@mui/icons-material/ArrowBack';
import ContentCopyIcon from '@mui/icons-material/ContentCopy';
import { Alert, Box, Button, Chip, CircularProgress, Stack, type Theme, Typography, alpha, useTheme } from '@mui/material';

import { RangeSetBuilder } from '@codemirror/state';
import { Decoration, EditorView } from '@codemirror/view';
import CodeMirror, { type ReactCodeMirrorRef } from '@uiw/react-codemirror';

import { entryName } from '../blocks/definitionEntries';
import { blockDescriptorsById } from '../blocks/loadBlocks';
import { primaryPromiseType } from '../blocks/resolveBlockShape';
import type { CompiledPolicyState } from '../project/useCompiledPolicy';
import { useAppSelector } from '../store';
import { cfengineLanguage } from './editor/cfengineLanguage';
import { type PolicyReference, type PolicyRegion, policyBlocks } from './editor/policyBlocks';

type Palette = Theme['palette'];
// A bar colour per kind of promise, so a file's structure reads at a glance.
const barColor = (palette: Palette, promiseType: string | undefined) =>
  ({
    vars: palette.info.main,
    classes: palette.info.main,
    files: palette.primary.main,
    packages: palette.success.main,
    services: palette.warning.main,
    processes: palette.warning.main,
    commands: palette.secondary.main,
    users: palette.success.dark
  })[promiseType ?? ''] ?? palette.text.disabled;

// The classes and variables the project defines, as the open file's policy names them: its own
// bare (`vars.x`, `name`) or qualified, another file's as `<ns>:vars.x` / `<ns>:name`.
function useProjectReferences(currentFileId: string | null): PolicyReference[] {
  const canvas = useAppSelector(state => state.canvas);
  const files = useAppSelector(state => state.files.files);
  return useMemo(() => {
    const namespaces = new Map(files.map(file => [file.id, file.namespace]));
    return canvas.flatMap(instance => {
      const descriptor = blockDescriptorsById.get(instance.blockId);
      const kind = descriptor && primaryPromiseType(descriptor);
      if (!descriptor || (kind !== 'classes' && kind !== 'vars')) return [];
      return (instance.entries ?? []).flatMap(entry => {
        const name = entryName(descriptor, entry);
        if (!name) return [];
        const local = kind === 'vars' ? `vars.${name}` : name;
        const names = [`${namespaces.get(instance.fileId)}:${local}`, ...(instance.fileId === currentFileId ? [local] : [])];
        return names.map(qualified => ({ name: qualified, id: instance.instanceId, fileId: instance.fileId }));
      });
    });
  }, [canvas, files, currentFileId]);
}

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
 * save would write it (the file tree picks the file). Each block has a bar in the gutter; a click
 * selects it, the selected one is tinted and scrolled into view, and the project's classes and
 * variables link to the block that defines them.
 */
export function GeneratedPolicyView({
  compiled,
  currentFileId,
  onFollow,
  onSelect,
  selectedId
}: {
  compiled: CompiledPolicyState;
  currentFileId: string | null;
  // A class or variable link: the block that defines it, maybe in another file.
  onFollow: (fileId: string, id: string) => void;
  // A click on a block's (or group's) code.
  onSelect: (id: string) => void;
  // The selected block's instanceId or group's id.
  selectedId: string | null;
}) {
  const theme = useTheme();
  const { error, pathOf, pending, result } = compiled;
  const policyPath = currentFileId ? pathOf[currentFileId] : undefined;
  const text = policyPath ? result?.files[policyPath] : undefined;
  const ranges = useMemo(() => (policyPath && selectedId ? (result?.sourceMap[policyPath]?.[selectedId] ?? []) : []), [policyPath, selectedId, result]);
  const canvas = useAppSelector(state => state.canvas);
  const groups = useAppSelector(state => state.groups);
  const references = useProjectReferences(currentFileId);
  const regions = useMemo((): PolicyRegion[] => {
    const map = (policyPath && result?.sourceMap[policyPath]) || {};
    return Object.entries(map).flatMap(([id, ranges]) => {
      const block = canvas.find(item => item.instanceId === id);
      const group = block ? undefined : groups.find(item => item.id === id);
      const descriptor = block && blockDescriptorsById.get(block.blockId);
      if (!block && !group) return [];
      return [
        {
          id,
          ranges: ranges as [number, number][],
          isGroup: Boolean(group),
          label: block ? block.label : `Group ${group!.name}`,
          type: descriptor?.name ?? 'Group',
          color: group ? theme.palette.text.secondary : barColor(theme.palette, descriptor && primaryPromiseType(descriptor))
        }
      ];
    });
  }, [policyPath, result, canvas, groups, theme]);
  const [view, setView] = useState<EditorView | null>(null);
  const [copied, setCopied] = useState<'copied' | 'failed' | null>(null);
  // A block picked by clicking its code is already in view: don't scroll to its start.
  const [picked, setPicked] = useState<string | null>(null);
  const pick = (id: string) => {
    setPicked(id);
    onSelect(id);
  };
  // Where links were followed from, for Back.
  const [trail, setTrail] = useState<{ fileId: string; id: string }[]>([]);
  const follow = (fileId: string, id: string) => {
    if (currentFileId && selectedId) setTrail(previous => [...previous, { fileId: currentFileId, id: selectedId }].slice(-20));
    setPicked(null);
    onFollow(fileId, id);
  };
  const back = () => {
    const previous = trail.at(-1);
    if (!previous) return;
    setTrail(trail.slice(0, -1));
    setPicked(null);
    onFollow(previous.fileId, previous.id);
  };

  const extensions = useMemo(
    () => [
      cfengineLanguage,
      highlightLines(ranges),
      policyBlocks(regions, references, pick, reference => follow(reference.fileId, reference.id)),
      EditorView.theme({
        '.cm-selected-block': { backgroundColor: alpha(theme.palette.primary.main, 0.16) },
        '.cm-hovered-block': { backgroundColor: alpha(theme.palette.text.primary, 0.04) },
        '.cm-project-ref': { color: theme.palette.mode === 'dark' ? theme.palette.primary.light : theme.palette.primary.main }
      })
    ],
    // eslint-disable-next-line react-hooks/exhaustive-deps -- the callbacks are new each render; their targets aren't
    [ranges, regions, references, theme, currentFileId, selectedId]
  );

  useEffect(() => {
    if (picked && picked === selectedId) return;
    if (!view || ranges.length === 0 || ranges[0][0] > view.state.doc.lines) return;
    view.dispatch({ effects: EditorView.scrollIntoView(view.state.doc.line(ranges[0][0]).from, { y: 'start', yMargin: 48 }) });
  }, [view, ranges, text, picked, selectedId]);

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.altKey && event.key === 'ArrowLeft') back();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  });

  const copy = () => {
    if (!text) return;
    const show = (state: 'copied' | 'failed') => {
      setCopied(state);
      setTimeout(() => setCopied(null), 1500);
    };
    navigator.clipboard.writeText(text).then(
      () => show('copied'),
      () => show('failed')
    );
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
          {trail.length > 0 && (
            <Button
              size="small"
              startIcon={<ArrowBackIcon sx={{ fontSize: 16 }} />}
              onClick={back}
              title="Back to where the link was followed from (Alt+←)"
              sx={{ textTransform: 'none' }}
            >
              Back
            </Button>
          )}
          <Status error={Boolean(error)} pending={pending} />
          <Button size="small" startIcon={<ContentCopyIcon sx={{ fontSize: 16 }} />} onClick={copy} disabled={!text} sx={{ textTransform: 'none' }}>
            {copied === 'copied' ? 'Copied' : copied === 'failed' ? 'Copy failed' : 'Copy'}
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
