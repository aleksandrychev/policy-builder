import { useState } from 'react';

import type { SvgIconComponent } from '@mui/icons-material';
import CheckIcon from '@mui/icons-material/Check';
import CodeIcon from '@mui/icons-material/Code';
import DescriptionOutlinedIcon from '@mui/icons-material/DescriptionOutlined';
import LibraryBooksOutlinedIcon from '@mui/icons-material/LibraryBooksOutlined';
import SettingsOutlinedIcon from '@mui/icons-material/SettingsOutlined';
import TuneIcon from '@mui/icons-material/Tune';
import { Box, Button, Chip, IconButton, ListItemText, Menu, MenuItem, Tooltip, Typography } from '@mui/material';

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

const chipSx = { height: 18, fontSize: 10, '& .MuiChip-label': { px: 0.75 } };

/** A module's badges: Experimental, Needs input, Promise type. */
export function ModuleBadges({ module, needsInput }: { module: CatalogModule; needsInput: boolean }) {
  return (
    <>
      {module.experimental && <Chip label="Experimental" size="small" variant="outlined" color="warning" sx={chipSx} />}
      {needsInput && <Chip label="Needs input" size="small" variant="outlined" color="warning" sx={chipSx} />}
      {module.kind === 'promise-type' && <Chip label="Promise type" size="small" variant="outlined" sx={chipSx} />}
    </>
  );
}

interface ModuleRowProps {
  // In the catalog section: whether the project has it already.
  added?: boolean;
  // A dependency: the module it came with.
  addedFor?: string;
  alias?: string;
  // False in a module project: modules go into policy sets.
  canAdd: boolean;
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
        <SettingsOutlinedIcon sx={{ fontSize: 16 }} />
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
        gap: 0.75,
        px: 1.25,
        py: 0.75,
        pl: addedFor ? 3.5 : 1.25,
        borderRadius: '4px',
        cursor: 'pointer',
        bgcolor: selected ? 'action.selected' : undefined,
        '&:hover': { bgcolor: selected ? 'action.selected' : 'background.default' }
      }}
    >
      <KindIcon sx={{ fontSize: 15, color: 'text.muted', flexShrink: 0, mt: 0.25 }} />
      <Box sx={{ flex: 1, minWidth: 0 }}>
        <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.75, minHeight: 22 }}>
          <Tooltip title={module.name} enterDelay={600}>
            <Typography noWrap sx={{ fontSize: 13, color: 'text.primary', flex: 1, minWidth: 0 }}>
              {module.name}
            </Typography>
          </Tooltip>
          {module.version && <Typography sx={{ fontSize: 10, fontFamily: 'monospace', color: 'text.muted', flexShrink: 0 }}>{module.version}</Typography>}
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
                onClick={event => {
                  event.stopPropagation();
                  onAdd();
                }}
                sx={{ minWidth: 0, px: 1, py: 0, fontSize: 11, flexShrink: 0 }}
              >
                Add
              </Button>
            )
          )}
        </Box>
        {addedFor ? (
          <Typography noWrap sx={{ fontSize: 11, color: 'text.muted' }}>
            added for {addedFor}
          </Typography>
        ) : (
          <>
            <Typography noWrap sx={{ fontSize: 11, color: 'text.muted' }}>
              {alias ? `also known as ${alias} · ` : ''}
              {module.description}
            </Typography>
            <Box sx={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: 0.5, mt: 0.25, '&:empty': { display: 'none' } }}>
              <ModuleBadges module={module} needsInput={needsInput} />
            </Box>
          </>
        )}
      </Box>
    </Box>
  );
}
