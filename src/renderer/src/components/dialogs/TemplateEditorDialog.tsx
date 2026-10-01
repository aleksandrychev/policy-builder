import { type KeyboardEvent, useMemo, useState } from 'react';

import ExpandMoreIcon from '@mui/icons-material/ExpandMore';
import UploadFileOutlinedIcon from '@mui/icons-material/UploadFileOutlined';
import { Box, Button, ButtonBase, Dialog, DialogActions, DialogContent, DialogTitle, Stack, TextField, Typography, useTheme } from '@mui/material';

import { autocompletion } from '@codemirror/autocomplete';
import { EditorView } from '@codemirror/view';
import CodeMirror, { type ReactCodeMirrorRef } from '@uiw/react-codemirror';

import { cfengineReferenceLanguage } from '../editor/cfengineReferenceLanguage';
import { mustacheLanguage } from '../editor/mustacheLanguage';
import { type TemplateToken, type TemplateTokenSyntax, insertTemplateToken, templateTokenCompletionSource } from '../editor/templateTokens';

interface TemplateEditorDialogProps {
  // The parameter's help, shown under a Mustache template (its syntax notes).
  help?: string;
  // True only for a field that's an actual Mustache template body (e.g.
  // render-template's template_content); false for plain CFEngine promise
  // text (a command string, a vars: literal, ...) where Mustache braces are
  // inert and $(name) is the only substitution syntax that means anything —
  // see templateTokens.ts's TemplateTokenSyntax doc comment.
  mustache: boolean;
  onClose: () => void;
  onSave: (value: string) => void;
  open: boolean;
  title: string;
  value: string;
  variables: TemplateToken[];
}

// Custom MIME type so the drop handler only reacts to our own token chips,
// not to arbitrary dragged text.
const TOKEN_MIME_TYPE = 'application/x-cfengine-template-token';

function activateOnEnterOrSpace(event: KeyboardEvent, action: () => void) {
  if (event.key !== 'Enter' && event.key !== ' ') return;
  event.preventDefault();
  action();
}

function dropTokenExtension(tokensByName: Map<string, TemplateToken>, syntax: TemplateTokenSyntax) {
  return EditorView.domEventHandlers({
    dragover(event) {
      event.preventDefault();
    },
    drop(event, view) {
      const name = event.dataTransfer?.getData(TOKEN_MIME_TYPE);
      const token = name ? tokensByName.get(name) : undefined;
      if (!token) return false;
      event.preventDefault();
      const pos = view.posAtCoords({ x: event.clientX, y: event.clientY }) ?? view.state.doc.length;
      insertTemplateToken(view, token, pos, pos, syntax);
      return true;
    }
  });
}

function TokenChip({ onInsert, token }: { onInsert: () => void; token: TemplateToken }) {
  return (
    <Box
      draggable
      onDragStart={event => {
        event.dataTransfer.setData(TOKEN_MIME_TYPE, token.name);
        event.dataTransfer.effectAllowed = 'copy';
      }}
      onClick={onInsert}
      onKeyDown={event => activateOnEnterOrSpace(event, onInsert)}
      role="button"
      tabIndex={0}
      sx={{
        px: 1,
        py: 0.5,
        borderRadius: '4px',
        border: '1px solid',
        borderColor: 'divider',
        bgcolor: 'background.default',
        cursor: 'grab',
        userSelect: 'none',
        '&:hover, &:focus-visible': { borderColor: 'primary.main' }
      }}
      title={token.label}
    >
      <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.5, fontSize: 12, fontFamily: 'monospace', color: 'text.primary' }}>
        <Box component="span" sx={{ fontSize: 10, color: 'text.muted' }}>
          {token.kind === 'class' ? '#' : '@'}
        </Box>
        {token.name}
      </Box>
      {token.label && <Typography sx={{ fontSize: 10, color: 'text.muted', mt: 0.25 }}>{token.label}</Typography>}
    </Box>
  );
}

function groupTokens(tokens: TemplateToken[]): Map<string, TemplateToken[]> {
  const groups = new Map<string, TemplateToken[]>();
  for (const token of tokens) {
    const key = token.group ?? 'Variables';
    const existing = groups.get(key);
    if (existing) existing.push(token);
    else groups.set(key, [token]);
  }
  return groups;
}

// Long built-in lists (special variables, hard classes) start collapsed;
// small project-specific groups stay open since they're usually what the
// user came here for.
const DEFAULT_COLLAPSE_THRESHOLD = 12;

function TokenGroup({
  group,
  tokens,
  forceExpanded,
  onInsert
}: {
  forceExpanded: boolean;
  group: string;
  onInsert: (token: TemplateToken) => void;
  tokens: TemplateToken[];
}) {
  const [collapsed, setCollapsed] = useState(tokens.length > DEFAULT_COLLAPSE_THRESHOLD);
  const effectiveCollapsed = collapsed && !forceExpanded;

  return (
    <Box>
      <ButtonBase
        onClick={() => setCollapsed(current => !current)}
        aria-expanded={!effectiveCollapsed}
        sx={{ display: 'flex', width: '100%', alignItems: 'center', justifyContent: 'space-between', mb: 0.5, borderRadius: '2px' }}
      >
        <Typography sx={{ fontSize: 11, fontWeight: 700, color: 'text.muted' }}>
          {group} ({tokens.length})
        </Typography>
        <ExpandMoreIcon sx={{ fontSize: 16, color: 'text.muted', transform: effectiveCollapsed ? 'rotate(-90deg)' : 'none', transition: 'transform 0.15s' }} />
      </ButtonBase>
      {!effectiveCollapsed && (
        <Stack sx={{ gap: 0.5 }}>
          {tokens.map(token => (
            <TokenChip key={`${group}:${token.name}`} token={token} onInsert={() => onInsert(token)} />
          ))}
        </Stack>
      )}
    </Box>
  );
}

export function TemplateEditorDialog({ open, title, value, variables, mustache, help, onClose, onSave }: TemplateEditorDialogProps) {
  const theme = useTheme();
  // The parent unmounts this dialog on close (conditional render), so a fresh
  // mount is guaranteed each time it opens — no effect needed to resync `draft`.
  const [draft, setDraft] = useState(value);
  const [editorView, setEditorView] = useState<EditorView | null>(null);
  const [search, setSearch] = useState('');
  const [importError, setImportError] = useState<string | null>(null);

  const syntax: TemplateTokenSyntax = mustache ? 'mustache' : 'cfengine';
  // A class can't be substituted inline in plain CFEngine text — it gates a
  // whole promise via the block's own Condition — so it's not offered here.
  const insertableVariables = useMemo(() => (mustache ? variables : variables.filter(token => token.kind === 'variable')), [mustache, variables]);

  const handleImport = async () => {
    if (!window.api) return;
    setImportError(null);
    try {
      const imported = await window.api.importTextFile();
      if (imported) setDraft(imported.content);
    } catch (error) {
      setImportError(error instanceof Error ? error.message : String(error));
    }
  };

  const extensions = useMemo(() => {
    const tokensByName = new Map(insertableVariables.map(token => [token.name, token]));
    return [
      mustache ? mustacheLanguage : cfengineReferenceLanguage,
      autocompletion({ override: [templateTokenCompletionSource(insertableVariables, syntax)] }),
      dropTokenExtension(tokensByName, syntax)
    ];
  }, [insertableVariables, mustache, syntax]);

  // Backdrop clicks never discard edits; Escape only closes when there's nothing to lose.
  const handleDialogClose = (_event: object, reason: 'backdropClick' | 'escapeKeyDown') => {
    if (reason === 'backdropClick' || draft !== value) return;
    onClose();
  };

  const insertAtCursor = (token: TemplateToken) => {
    if (!editorView) return;
    const { from, to } = editorView.state.selection.main;
    insertTemplateToken(editorView, token, from, to, syntax);
    editorView.focus();
  };

  const query = search.trim().toLowerCase();
  const filtered = query
    ? insertableVariables.filter(token => token.name.toLowerCase().includes(query) || token.label?.toLowerCase().includes(query))
    : insertableVariables;
  const groups = groupTokens(filtered);

  return (
    <Dialog open={open} onClose={handleDialogClose} maxWidth="lg" fullWidth>
      <DialogTitle sx={{ fontSize: 16, fontWeight: 700 }}>
        {title}
        {mustache && help && <Typography sx={{ fontSize: 12, color: 'text.muted', mt: 0.5 }}>{help}</Typography>}
      </DialogTitle>
      <DialogContent sx={{ display: 'flex', gap: 2, height: 480 }}>
        <Box sx={{ flex: 1, minWidth: 0, border: '1px solid', borderColor: 'divider', borderRadius: '4px', overflow: 'hidden' }}>
          <CodeMirror
            ref={(instance: ReactCodeMirrorRef | null) => setEditorView(instance?.view ?? null)}
            value={draft}
            onChange={setDraft}
            theme={theme.palette.mode}
            height="100%"
            style={{ height: '100%', fontSize: 13 }}
            extensions={extensions}
          />
        </Box>
        <Stack sx={{ width: 240, flexShrink: 0, gap: 1, minHeight: 0 }}>
          <Typography sx={{ fontSize: 12, fontWeight: 700, color: 'text.muted' }}>{mustache ? 'Variables & classes' : 'Variables'}</Typography>
          <Typography sx={{ fontSize: 11, color: 'text.muted' }}>
            {mustache
              ? 'Drag onto the editor, click to insert, or type “@” for variables / “#” for classes.'
              : 'Drag onto the editor, click to insert, or type “@” for variables — inserted as $(name), CFEngine’s own reference syntax.'}
          </Typography>
          <TextField value={search} onChange={event => setSearch(event.target.value)} placeholder="Filter…" variant="standard" size="small" fullWidth />
          <Stack sx={{ gap: 1.5, overflowY: 'auto', flex: 1 }}>
            {[...groups.entries()].map(([group, groupTokenList]) => (
              <TokenGroup key={group} group={group} tokens={groupTokenList} forceExpanded={Boolean(query)} onInsert={insertAtCursor} />
            ))}
          </Stack>
        </Stack>
      </DialogContent>
      <DialogActions sx={{ justifyContent: 'space-between' }}>
        <Stack sx={{ alignItems: 'flex-start' }}>
          <Button startIcon={<UploadFileOutlinedIcon />} onClick={handleImport}>
            Import from file
          </Button>
          {importError && <Typography sx={{ fontSize: 11, color: 'error.main', pl: 1 }}>{importError}</Typography>}
        </Stack>
        <Stack direction="row">
          <Button onClick={onClose}>Cancel</Button>
          <Button
            variant="contained"
            onClick={() => {
              onSave(draft);
              onClose();
            }}
          >
            Save
          </Button>
        </Stack>
      </DialogActions>
    </Dialog>
  );
}
