import { type KeyboardEvent, type ReactNode, useMemo, useState } from 'react';
import { createPortal } from 'react-dom';

import CloseIcon from '@mui/icons-material/Close';
import KeyboardArrowDownIcon from '@mui/icons-material/KeyboardArrowDown';
import KeyboardArrowUpIcon from '@mui/icons-material/KeyboardArrowUp';
import SearchIcon from '@mui/icons-material/Search';
import { Box, ButtonBase, IconButton, InputAdornment, Stack, TextField, Typography, alpha, useTheme } from '@mui/material';

import { SearchQuery, closeSearchPanel, findNext, findPrevious, getSearchQuery, search, setSearchQuery } from '@codemirror/search';
import type { Extension } from '@codemirror/state';
import { EditorView } from '@codemirror/view';

// Counting stops here: a huge file's "1000+" is as useful as its exact count.
const MAX_COUNTED = 1000;

const first = (cursor: Iterator<{ from: number; to: number }>) => {
  const result = cursor.next();
  return result.done ? undefined : result.value;
};

/**
 * CodeMirror's search (⌘F, match highlighting), with its panel drawn by our FindBar in the MUI
 * theme instead of the stock form. Add `extension` to the editor and render `findBar` anywhere.
 */
export function useFindBar(): { extension: Extension; findBar: ReactNode } {
  const theme = useTheme();
  const [panel, setPanel] = useState<{ dom: HTMLElement; view: EditorView } | null>(null);
  // Bumped when the selection, text or query changes: the count and current match follow.
  const [version, setVersion] = useState(0);

  const searchExtension = useMemo(
    () =>
      search({
        createPanel: view => {
          const dom = document.createElement('div');
          return {
            dom,
            mount: () => setPanel({ dom, view }),
            update: update => {
              const queried = update.transactions.some(tr => tr.effects.some(effect => effect.is(setSearchQuery)));
              if (update.selectionSet || update.docChanged || queried) setVersion(current => current + 1);
            },
            destroy: () => setPanel(null)
          };
        }
      }),
    []
  );
  const themeExtension = useMemo(
    () =>
      EditorView.theme({
        '.cm-panels': { backgroundColor: 'transparent', color: 'inherit' },
        '.cm-panels.cm-panels-bottom': { borderTop: 'none' },
        '.cm-searchMatch': { backgroundColor: alpha(theme.palette.warning.main, 0.25), outline: 'none' },
        '.cm-searchMatch.cm-searchMatch-selected': { backgroundColor: alpha(theme.palette.warning.main, 0.6) }
      }),
    [theme]
  );
  const extension = useMemo(() => [searchExtension, themeExtension], [searchExtension, themeExtension]);

  return { extension, findBar: panel && createPortal(<FindBar view={panel.view} version={version} />, panel.dom) };
}

function FindBar({ version, view }: { version: number; view: EditorView }) {
  const query = getSearchQuery(view.state);

  const { count, current } = useMemo(() => {
    if (!query.valid) return { count: 0, current: 0 };
    const selection = view.state.selection.main;
    let count = 0;
    let current = 0;
    for (const match of { [Symbol.iterator]: () => query.getCursor(view.state) }) {
      count += 1;
      if (match.from === selection.from && match.to === selection.to) current = count;
      if (count > MAX_COUNTED) break;
    }
    return { count, current };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- version stands for the view's state
  }, [view, version, query]);

  // A new query selects its first match from where the selection starts, so typing narrows in place.
  const update = (changes: Partial<ConstructorParameters<typeof SearchQuery>[0]>) => {
    const { caseSensitive, literal, regexp, wholeWord } = query;
    const next = new SearchQuery({ search: query.search, caseSensitive, literal, regexp, wholeWord, ...changes });
    const { state } = view;
    const match = next.valid ? (first(next.getCursor(state, state.selection.main.from)) ?? first(next.getCursor(state))) : undefined;
    view.dispatch({
      effects: setSearchQuery.of(next),
      ...(match && { selection: { anchor: match.from, head: match.to }, scrollIntoView: true })
    });
  };

  const onKeyDown = (event: KeyboardEvent) => {
    const close = event.key === 'Escape';
    const find = (event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'f';
    if (event.key === 'Enter') (event.shiftKey ? findPrevious : findNext)(view);
    else if (close) closeSearchPanel(view);
    else if (find) (event.target as HTMLInputElement).select();
    else return;
    // Kept from the window's and a dialog's own Escape.
    event.preventDefault();
    event.stopPropagation();
  };

  const status = !query.search
    ? ''
    : !query.valid
      ? 'Invalid expression'
      : count === 0
        ? 'No results'
        : `${current || '?'} of ${count > MAX_COUNTED ? `${MAX_COUNTED}+` : count}`;

  return (
    <Stack direction="row" spacing={0.5} sx={{ alignItems: 'center', px: 1, py: 0.5, bgcolor: 'background.paper', borderTop: 1, borderColor: 'divider' }}>
      <TextField
        value={query.search}
        onChange={event => update({ search: event.target.value })}
        onKeyDown={onKeyDown}
        onFocus={event => event.target.select()}
        placeholder="Find"
        size="small"
        autoFocus
        error={Boolean(query.search) && !query.valid}
        sx={{ width: 320, '& .MuiInputBase-root': { height: 30, fontSize: 13, pr: 0.5 } }}
        slotProps={{
          htmlInput: { 'main-field': 'true', 'aria-label': 'Find', spellCheck: false },
          input: {
            startAdornment: (
              <InputAdornment position="start">
                <SearchIcon sx={{ fontSize: 16, color: 'text.muted' }} />
              </InputAdornment>
            ),
            endAdornment: (
              <Stack direction="row" spacing={0.25}>
                <Toggle label="Aa" title="Match case" on={query.caseSensitive} onClick={() => update({ caseSensitive: !query.caseSensitive })} />
                <Toggle label="ab" title="Match whole word" underline on={query.wholeWord} onClick={() => update({ wholeWord: !query.wholeWord })} />
                <Toggle label=".*" title="Use regular expression" on={query.regexp} onClick={() => update({ regexp: !query.regexp })} />
              </Stack>
            )
          }
        }}
      />
      <Typography
        role="status"
        sx={{ fontSize: 12, minWidth: 96, px: 1, color: query.search && count === 0 ? 'error.main' : 'text.muted', whiteSpace: 'nowrap' }}
      >
        {status}
      </Typography>
      <IconButton size="small" title="Previous match (Shift+Enter)" disabled={count === 0} onClick={() => findPrevious(view)}>
        <KeyboardArrowUpIcon fontSize="small" />
      </IconButton>
      <IconButton size="small" title="Next match (Enter)" disabled={count === 0} onClick={() => findNext(view)}>
        <KeyboardArrowDownIcon fontSize="small" />
      </IconButton>
      <Box sx={{ flex: 1 }} />
      <IconButton size="small" title="Close (Esc)" onClick={() => closeSearchPanel(view)}>
        <CloseIcon fontSize="small" />
      </IconButton>
    </Stack>
  );
}

function Toggle({ label, on, onClick, title, underline }: { label: string; on: boolean; onClick: () => void; title: string; underline?: boolean }) {
  return (
    <ButtonBase
      title={title}
      aria-label={title}
      aria-pressed={on}
      onClick={onClick}
      // Keeps the focus (and the caret) in the field.
      onMouseDown={event => event.preventDefault()}
      sx={theme => ({
        width: 24,
        height: 22,
        borderRadius: 0.5,
        fontSize: 12,
        fontFamily: 'monospace',
        textDecoration: underline ? 'underline' : 'none',
        color: on ? 'primary.main' : 'text.secondary',
        bgcolor: on ? alpha(theme.palette.primary.main, 0.16) : 'transparent',
        outline: on ? `1px solid ${alpha(theme.palette.primary.main, 0.5)}` : 'none',
        '&:hover': { bgcolor: on ? alpha(theme.palette.primary.main, 0.24) : 'action.hover' }
      })}
    >
      {label}
    </ButtonBase>
  );
}
