import { type ReactNode, useState } from 'react';

import type { SvgIconComponent } from '@mui/icons-material';
import AddIcon from '@mui/icons-material/Add';
import CheckIcon from '@mui/icons-material/Check';
import CodeIcon from '@mui/icons-material/Code';
import DescriptionOutlinedIcon from '@mui/icons-material/DescriptionOutlined';
import LibraryBooksOutlinedIcon from '@mui/icons-material/LibraryBooksOutlined';
import SettingsOutlinedIcon from '@mui/icons-material/SettingsOutlined';
import TuneIcon from '@mui/icons-material/Tune';
import { Box, Button, Chip, IconButton, ListItemText, Menu, MenuItem, type Theme, Tooltip, Typography, alpha } from '@mui/material';

import { type CatalogModule, type ModuleKind, sourceUrl } from '../../modules/catalog';

export const KIND_ICONS: Record<ModuleKind, SvgIconComponent> = {
  configured: TuneIcon,
  library: LibraryBooksOutlinedIcon,
  policy: DescriptionOutlinedIcon,
  'promise-type': CodeIcon
};

export const KIND_LABELS: Record<ModuleKind, string> = {
  configured: 'Configured',
  library: 'Library',
  policy: 'Policy',
  'promise-type': 'Promise type'
};

// A tinted badge: the palette colour's text on a light wash of it, or grey.
const chipSx = (color?: 'info' | 'warning') => (theme: Theme) => ({
  height: 22,
  fontSize: 11,
  fontWeight: color === 'warning' ? 600 : 400,
  borderRadius: '4px',
  color: color ? theme.palette[color].dark : 'text.secondary',
  bgcolor: color ? alpha(theme.palette[color].main, 0.08) : 'action.hover',
  border: '1px solid',
  borderColor: color ? alpha(theme.palette[color].main, 0.3) : 'transparent',
  '& .MuiChip-label': { px: 1 }
});

/** A module's badges: Experimental, Needs input, Promise type. */
export function ModuleBadges({ module, needsInput }: { module: CatalogModule; needsInput: boolean }) {
  return (
    <>
      {module.experimental && <Chip label="Experimental" size="small" sx={chipSx('warning')} />}
      {needsInput && <Chip label="Needs input" size="small" sx={chipSx('info')} />}
      {module.kind === 'promise-type' && <Chip label="Promise type" size="small" sx={chipSx()} />}
    </>
  );
}

interface ModuleRowProps {
  // In the catalog section: whether the project has it already.
  added?: boolean;
  // A dependency whose module isn't listed (filtered out): the module it came with.
  addedFor?: string;
  alias?: string;
  // False in a module project: modules go into policy sets.
  canAdd: boolean;
  // The modules it brought, shown inside its card.
  dependencies?: ReactNode[];
  // In the project section (gear menu), else in the catalog (Add).
  inProject: boolean;
  module: CatalogModule;
  needsInput: boolean;
  onAdd: () => void;
  onEditInput: () => void;
  onRemove: () => void;
  onSelect: () => void;
  selected: boolean;
  // The blocks needing it (its promise type): it can't be removed while they're there.
  usedBy?: string[];
}

function GearMenu({ addedFor, module, onEditInput, onRemove, usedBy }: Pick<ModuleRowProps, 'addedFor' | 'module' | 'onEditInput' | 'onRemove' | 'usedBy'>) {
  const [anchor, setAnchor] = useState<HTMLElement | null>(null);
  const source = sourceUrl(module);
  const close = () => setAnchor(null);
  return (
    <>
      <IconButton
        size="small"
        aria-label={`${module.name} actions`}
        onClick={event => {
          event.stopPropagation();
          setAnchor(event.currentTarget);
        }}
        sx={{ p: 0.25 }}
      >
        <SettingsOutlinedIcon sx={{ fontSize: 18, color: 'text.muted' }} />
      </IconButton>
      <Menu anchorEl={anchor} open={Boolean(anchor)} onClose={close} onClick={event => event.stopPropagation()}>
        {module.input.length > 0 && (
          <MenuItem
            onClick={() => {
              close();
              onEditInput();
            }}
          >
            Edit input
          </MenuItem>
        )}
        {source && (
          <MenuItem component="a" href={source} target="_blank" rel="noreferrer" onClick={close}>
            Open source ↗
          </MenuItem>
        )}
        {addedFor || usedBy?.length ? (
          <MenuItem disabled>
            <ListItemText primary={addedFor ? `Added for ${addedFor}` : `Used by ${usedBy!.join(', ')}`} />
          </MenuItem>
        ) : (
          <MenuItem
            onClick={() => {
              close();
              onRemove();
            }}
            sx={{ color: 'error.main' }}
          >
            Remove…
          </MenuItem>
        )}
      </Menu>
    </>
  );
}

/** One module: kind icon, name, version and action; then its description and badges. */
export function ModuleRow({
  added,
  addedFor,
  alias,
  canAdd,
  dependencies = [],
  inProject,
  module,
  needsInput,
  onAdd,
  onEditInput,
  onRemove,
  onSelect,
  selected,
  usedBy
}: ModuleRowProps) {
  const KindIcon = KIND_ICONS[module.kind];
  return (
    <Box
      role="button"
      tabIndex={0}
      aria-selected={selected}
      onClick={onSelect}
      onKeyDown={event => {
        if (event.key === 'Enter' || event.key === ' ') {
          event.preventDefault();
          onSelect();
        }
      }}
      sx={{
        display: 'flex',
        gap: 1,
        p: 1.5,
        mb: 1,
        border: '1px solid',
        borderColor: selected ? 'primary.main' : 'divider',
        borderRadius: '6px',
        cursor: 'pointer',
        bgcolor: 'background.paper',
        '&:hover': { borderColor: selected ? 'primary.main' : 'text.disabled' },
        '&:focus-visible': { outline: '2px solid', outlineColor: 'primary.main', outlineOffset: 1 }
      }}
    >
      <KindIcon sx={{ fontSize: 18, color: module.kind === 'promise-type' ? 'primary.main' : 'text.muted', flexShrink: 0, mt: 0.25 }} />
      <Box sx={{ flex: 1, minWidth: 0 }}>
        <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.75, minHeight: 22 }}>
          <Tooltip title={module.name} enterDelay={600}>
            <Typography noWrap sx={{ fontSize: 14, fontWeight: 600, color: 'text.primary', flex: 1, minWidth: 0 }}>
              {module.name}
            </Typography>
          </Tooltip>
          {module.version && <Typography sx={{ fontSize: 12, fontFamily: 'monospace', color: 'text.muted', flexShrink: 0 }}>{module.version}</Typography>}
          {inProject ? (
            <GearMenu addedFor={addedFor} module={module} onEditInput={onEditInput} onRemove={onRemove} usedBy={usedBy} />
          ) : added ? (
            <Typography sx={{ display: 'flex', alignItems: 'center', gap: 0.25, fontSize: 11, color: 'text.muted', flexShrink: 0 }}>
              <CheckIcon sx={{ fontSize: 13 }} /> Added
            </Typography>
          ) : (
            canAdd && (
              <Button
                size="small"
                startIcon={<AddIcon sx={{ fontSize: '14px !important' }} />}
                onClick={event => {
                  event.stopPropagation();
                  onAdd();
                }}
                sx={theme => ({
                  minWidth: 0,
                  px: 1.25,
                  py: 0.25,
                  fontSize: 12,
                  fontWeight: 600,
                  flexShrink: 0,
                  '& .MuiButton-startIcon': { mr: 0.25, ml: 0 },
                  bgcolor: alpha(theme.palette.primary.main, 0.08),
                  '&:hover': { bgcolor: alpha(theme.palette.primary.main, 0.16) }
                })}
              >
                Add
              </Button>
            )
          )}
        </Box>
        {addedFor ? (
          <Typography noWrap sx={{ fontSize: 12, fontStyle: 'italic', color: 'text.muted', mt: 0.5 }}>
            added for {addedFor}
          </Typography>
        ) : (
          <>
            <Typography noWrap sx={{ fontSize: 12, color: 'text.secondary', mt: 0.5 }}>
              {alias ? `also known as ${alias} · ` : ''}
              {module.description}
            </Typography>
            <Box sx={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: 0.75, mt: 1, '&:empty': { display: 'none' } }}>
              <ModuleBadges module={module} needsInput={needsInput} />
            </Box>
          </>
        )}
        {dependencies.length > 0 && (
          <Box sx={{ mt: 1.25, pt: 1, borderTop: '1px solid', borderColor: 'divider' }}>
            <Typography sx={{ fontSize: 11, fontWeight: 700, letterSpacing: 0.5, textTransform: 'uppercase', color: 'text.muted', mb: 0.25 }}>
              Requires
            </Typography>
            {dependencies}
          </Box>
        )}
      </Box>
    </Box>
  );
}

interface DependencyRowProps extends Pick<ModuleRowProps, 'module' | 'onEditInput' | 'onRemove' | 'onSelect' | 'selected' | 'usedBy'> {
  // The module it came with.
  addedFor: string;
  // Not in the project yet: cfbs adds it on save.
  pending: boolean;
}

/** A dependency, inside the card of the module that brought it: a compact line that opens its page. */
export function DependencyRow({ addedFor, module, onEditInput, onRemove, onSelect, pending, selected, usedBy }: DependencyRowProps) {
  const KindIcon = KIND_ICONS[module.kind];
  return (
    <Box
      role="button"
      tabIndex={0}
      aria-selected={selected}
      aria-label={`${module.name}, required by ${addedFor}`}
      onClick={event => {
        event.stopPropagation();
        onSelect();
      }}
      onKeyDown={event => {
        if (event.key === 'Enter' || event.key === ' ') {
          event.preventDefault();
          event.stopPropagation();
          onSelect();
        }
      }}
      sx={{
        display: 'flex',
        alignItems: 'center',
        gap: 0.75,
        mx: -0.75,
        px: 0.75,
        minHeight: 28,
        borderRadius: '4px',
        cursor: 'pointer',
        bgcolor: selected ? 'action.selected' : undefined,
        '&:hover': { bgcolor: selected ? 'action.selected' : 'action.hover' }
      }}
    >
      <KindIcon sx={{ fontSize: 15, color: 'text.muted', flexShrink: 0 }} />
      <Tooltip title={module.name} enterDelay={600}>
        <Typography noWrap sx={{ fontSize: 12, color: 'text.primary', flex: 1, minWidth: 0 }}>
          {module.name}
        </Typography>
      </Tooltip>
      {pending ? (
        <Tooltip title="Not in the project yet: saving adds it">
          <Typography sx={{ fontSize: 11, fontStyle: 'italic', color: 'text.muted', flexShrink: 0 }}>on save</Typography>
        </Tooltip>
      ) : (
        <>
          {module.version && <Typography sx={{ fontSize: 11, fontFamily: 'monospace', color: 'text.muted', flexShrink: 0 }}>{module.version}</Typography>}
          <GearMenu addedFor={addedFor} module={module} onEditInput={onEditInput} onRemove={onRemove} usedBy={usedBy} />
        </>
      )}
    </Box>
  );
}
