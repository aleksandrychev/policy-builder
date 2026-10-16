import { type ReactNode, useMemo, useState } from 'react';

import ExpandMoreIcon from '@mui/icons-material/ExpandMore';
import MoreHorizIcon from '@mui/icons-material/MoreHoriz';
import SearchIcon from '@mui/icons-material/Search';
import {
  Box,
  Button,
  ButtonBase,
  Checkbox,
  Chip,
  CircularProgress,
  FormControlLabel,
  IconButton,
  InputAdornment,
  Menu,
  MenuItem,
  TextField,
  Typography
} from '@mui/material';

import { type CatalogFilter, type CatalogModule, TAG_CHIPS, filterCatalog } from '../../modules/catalog';
import type { ModuleCatalog } from '../../modules/useModuleCatalog';
import type { ProjectModule } from '../../store/modulesSlice';
import { ModuleRow } from './ModuleRow';

const shortDate = (iso: string) => new Date(iso).toLocaleDateString(undefined, { day: 'numeric', month: 'short' });

// A module the index no longer lists still shows, by its name.
const unknownModule = (module: ProjectModule): CatalogModule => ({
  aliases: [],
  dependencies: [],
  description: 'Not in the module list',
  experimental: false,
  input: [],
  kind: 'policy',
  name: module.name,
  supported: false,
  tags: [],
  version: module.version
});

function Section({ children, count, title }: { children: ReactNode; count: number; title: string }) {
  const [collapsed, setCollapsed] = useState(false);
  return (
    <Box>
      <ButtonBase
        onClick={() => setCollapsed(current => !current)}
        aria-expanded={!collapsed}
        sx={{ display: 'flex', width: '100%', alignItems: 'center', gap: 0.5, px: 1, py: 0.75, borderRadius: '4px', justifyContent: 'flex-start' }}
      >
        <ExpandMoreIcon sx={{ fontSize: 16, color: 'text.muted', transform: collapsed ? 'rotate(-90deg)' : 'none', transition: 'transform 0.15s' }} />
        <Typography sx={{ fontSize: 11, fontWeight: 700, letterSpacing: 0.5, textTransform: 'uppercase', color: 'text.primary' }}>
          {title} ({count})
        </Typography>
      </ButtonBase>
      {!collapsed && children}
    </Box>
  );
}

interface ModulesViewProps {
  catalog: ModuleCatalog;
  isNeedingInput: (name: string) => boolean;
  onAdd: (name: string) => void;
  onEditInput: (name: string) => void;
  onRemove: (name: string) => void;
  onSelect: (name: string) => void;
  projectModules: ProjectModule[];
  selectedName: string | null;
  usedBy: (name: string) => string[];
}

/** The CFEngine Build modules: the project's, then the whole index, searched and filtered by tag. */
export function ModulesView({ catalog, isNeedingInput, onAdd, onEditInput, onRemove, onSelect, projectModules, selectedName, usedBy }: ModulesViewProps) {
  const [filter, setFilter] = useState<CatalogFilter>({ search: '', supportedOnly: false, tag: null });
  const [showLibraries, setShowLibraries] = useState(false);
  const [menuAnchor, setMenuAnchor] = useState<HTMLElement | null>(null);

  const added = useMemo(() => new Set(projectModules.map(module => module.name)), [projectModules]);
  const results = useMemo(() => filterCatalog(catalog.modules, filter, showLibraries), [catalog.modules, filter, showLibraries]);
  const filtering = filter.search.trim() !== '' || filter.tag !== null || filter.supportedOnly;

  // The project's modules in build order, dependencies under the module they came with.
  const inProject = useMemo(() => {
    const entries = projectModules.map(module => ({ module, entry: catalog.byName.get(module.name) ?? unknownModule(module) }));
    const kept = filtering
      ? new Set(
          filterCatalog(
            entries.map(({ entry }) => entry),
            filter,
            true
          ).map(match => match.module.name)
        )
      : null;
    const visible = entries.filter(({ entry }) => !kept || kept.has(entry.name));
    const tops = visible.filter(({ module }) => !module.addedBy || !visible.some(other => other.module.name === module.addedBy));
    return tops.flatMap(top => [top, ...visible.filter(({ module }) => module.addedBy === top.module.name && top.module.addedBy === undefined)]);
  }, [projectModules, catalog.byName, filter, filtering]);

  const rowProps = (module: CatalogModule) => ({
    module,
    selected: selectedName === module.name,
    onSelect: () => onSelect(module.name),
    onAdd: () => onAdd(module.name),
    onEditInput: () => onEditInput(module.name),
    onRemove: () => onRemove(module.name),
    usedBy: usedBy(module.name)
  });

  return (
    <Box sx={{ display: 'flex', flexDirection: 'column', height: '100%', overflow: 'hidden' }}>
      <Box sx={{ p: 2, pb: 1 }}>
        <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', mb: 1.5 }}>
          <Typography sx={{ fontSize: 16, fontWeight: 700, color: 'text.primary' }}>Modules</Typography>
          <IconButton size="small" aria-label="Module list options" onClick={event => setMenuAnchor(event.currentTarget)} sx={{ p: 0.25 }}>
            <MoreHorizIcon sx={{ fontSize: 18 }} />
          </IconButton>
          <Menu anchorEl={menuAnchor} open={Boolean(menuAnchor)} onClose={() => setMenuAnchor(null)}>
            <MenuItem
              onClick={() => {
                setMenuAnchor(null);
                catalog.refresh();
              }}
            >
              Refresh list
            </MenuItem>
            <MenuItem
              onClick={() => {
                setMenuAnchor(null);
                setShowLibraries(current => !current);
              }}
            >
              {showLibraries ? 'Hide libraries' : 'Show libraries'}
            </MenuItem>
          </Menu>
        </Box>
        <TextField
          value={filter.search}
          onChange={event => setFilter(current => ({ ...current, search: event.target.value }))}
          placeholder="Search modules…"
          variant="standard"
          fullWidth
          size="small"
          slotProps={{
            input: {
              startAdornment: (
                <InputAdornment position="start">
                  <SearchIcon sx={{ fontSize: 16, color: 'text.muted' }} />
                </InputAdornment>
              )
            }
          }}
        />
        <Box sx={{ display: 'flex', flexWrap: 'wrap', gap: 0.5, mt: 1.25 }}>
          {[{ label: 'All', tag: null }, ...TAG_CHIPS].map(({ label, tag }) => (
            <Chip
              key={label}
              label={label}
              size="small"
              clickable
              color={filter.tag === tag ? 'primary' : 'default'}
              variant={filter.tag === tag ? 'filled' : 'outlined'}
              onClick={() => setFilter(current => ({ ...current, tag }))}
              sx={{ height: 22, fontSize: 11 }}
            />
          ))}
        </Box>
        <FormControlLabel
          control={
            <Checkbox
              size="small"
              checked={filter.supportedOnly}
              onChange={event => setFilter(current => ({ ...current, supportedOnly: event.target.checked }))}
            />
          }
          label={<Typography sx={{ fontSize: 12 }}>Supported only</Typography>}
          sx={{ mt: 0.5, ml: -0.75 }}
        />
        {catalog.offline && catalog.fetchedAt && (
          <Typography sx={{ fontSize: 11, color: 'text.muted' }}>Offline · list from {shortDate(catalog.fetchedAt)}</Typography>
        )}
      </Box>

      <Box sx={{ flex: 1, overflowY: 'auto', px: 1, pb: 1 }}>
        {(projectModules.length > 0 || !filtering) && (
          <Section title="In this project" count={inProject.length}>
            {inProject.length === 0 ? (
              <Typography sx={{ fontSize: 12, color: 'text.muted', px: 1.25, py: 0.75 }}>
                {filtering ? 'None of them match.' : 'No modules yet. Add one from the list below.'}
              </Typography>
            ) : (
              inProject.map(({ module, entry }) => (
                <ModuleRow key={module.name} {...rowProps(entry)} inProject addedFor={module.addedBy} needsInput={isNeedingInput(module.name)} />
              ))
            )}
          </Section>
        )}
        <Section title="All modules" count={results.length}>
          {catalog.loading && catalog.modules.length === 0 ? (
            <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, px: 1.25, py: 1 }}>
              <CircularProgress size={14} />
              <Typography sx={{ fontSize: 12, color: 'text.muted' }}>Loading the module list…</Typography>
            </Box>
          ) : catalog.modules.length === 0 ? (
            <Box sx={{ px: 1.25, py: 1 }}>
              <Typography sx={{ fontSize: 12, color: 'text.muted' }}>Can’t load the module list. Connect to the internet, then refresh.</Typography>
              <Button size="small" onClick={catalog.refresh} sx={{ mt: 0.5, px: 0 }}>
                Refresh
              </Button>
            </Box>
          ) : results.length === 0 ? (
            <Typography sx={{ fontSize: 13, color: 'text.muted', textAlign: 'center', mt: 1 }}>
              No modules match{filter.search.trim() ? ` “${filter.search.trim()}”` : ''}.
            </Typography>
          ) : (
            results.map(({ module, alias }) => (
              <ModuleRow
                key={module.name}
                {...rowProps(module)}
                inProject={false}
                added={added.has(module.name)}
                alias={alias}
                needsInput={module.input.length > 0}
              />
            ))
          )}
        </Section>
      </Box>
    </Box>
  );
}
