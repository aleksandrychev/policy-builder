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
  type Theme,
  Typography,
  alpha
} from '@mui/material';

import { type CatalogFilter, type CatalogModule, TAG_CHIPS, filterCatalog, modulesToAdd } from '../../modules/catalog';
import type { ModuleCatalog } from '../../modules/useModuleCatalog';
import type { ProjectModule } from '../../store/modulesSlice';
import { DependencyRow, ModuleRow } from './ModuleRow';

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

// A count next to a title: grey, or green for the project's modules.
function CountBadge({ count, success }: { count: number; success?: boolean }) {
  return (
    <Box
      component="span"
      sx={(theme: Theme) => ({
        px: 0.75,
        borderRadius: '4px',
        fontSize: 12,
        fontWeight: 600,
        lineHeight: '20px',
        color: success ? theme.palette.success.dark : 'text.secondary',
        bgcolor: success ? alpha(theme.palette.success.main, 0.12) : 'action.hover'
      })}
    >
      {count}
    </Box>
  );
}

function Section({ children, count, success, title }: { children: ReactNode; count: number; success?: boolean; title: string }) {
  const [collapsed, setCollapsed] = useState(false);
  return (
    <Box>
      <ButtonBase
        onClick={() => setCollapsed(current => !current)}
        aria-expanded={!collapsed}
        sx={{ display: 'flex', width: '100%', alignItems: 'center', gap: 1, px: 0.5, py: 1.25, borderRadius: '4px', justifyContent: 'flex-start' }}
      >
        <ExpandMoreIcon sx={{ fontSize: 18, color: 'text.muted', transform: collapsed ? 'rotate(-90deg)' : 'none', transition: 'transform 0.15s' }} />
        <Typography sx={{ fontSize: 12, fontWeight: 700, letterSpacing: 1, textTransform: 'uppercase', color: 'text.secondary' }}>{title}</Typography>
        <CountBadge count={count} success={success} />
      </ButtonBase>
      {!collapsed && children}
    </Box>
  );
}

interface ModulesViewProps {
  // False in a module project: modules go into policy sets.
  canAdd: boolean;
  catalog: ModuleCatalog;
  // What the search starts with (Browse modules… from the Blocks palette).
  initialSearch?: string;
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
export function ModulesView({
  canAdd,
  catalog,
  initialSearch = '',
  isNeedingInput,
  onAdd,
  onEditInput,
  onRemove,
  onSelect,
  projectModules,
  selectedName,
  usedBy
}: ModulesViewProps) {
  const [filter, setFilter] = useState<CatalogFilter>({ search: initialSearch, supportedOnly: false, tag: null });
  const [showLibraries, setShowLibraries] = useState(false);
  const [menuAnchor, setMenuAnchor] = useState<HTMLElement | null>(null);

  const added = useMemo(() => new Set(projectModules.map(module => module.name)), [projectModules]);
  const results = useMemo(() => filterCatalog(catalog.modules, filter, showLibraries), [catalog.modules, filter, showLibraries]);
  // All the list holds, whatever the filter: libraries only with their chip.
  const total = useMemo(() => filterCatalog(catalog.modules, { search: '', supportedOnly: false, tag: null }, false).length, [catalog.modules]);
  const filtering = filter.search.trim() !== '' || filter.tag !== null || filter.supportedOnly;

  // The project's modules in build order, dependencies under the module they came with.
  const inProject = useMemo(() => {
    // Dependencies cfbs adds on save that the project doesn't list yet (a block's module brings none).
    const pending = projectModules.flatMap(module =>
      module.addedBy
        ? []
        : modulesToAdd(
            catalog.byName,
            module.name,
            projectModules.filter(other => other !== module)
          )
            .slice(1)
            .map(dependency => ({ ...dependency, pending: true }))
    );
    const entries = [...projectModules, ...pending].map(module => ({ module, entry: catalog.byName.get(module.name) ?? unknownModule(module) }));
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
    return tops.map(top => ({
      ...top,
      dependencies: top.module.addedBy === undefined ? visible.filter(({ module }) => module.addedBy === top.module.name) : []
    }));
  }, [projectModules, catalog.byName, filter, filtering]);

  const rowProps = (module: CatalogModule) => ({
    module,
    selected: selectedName === module.name,
    onSelect: () => onSelect(module.name),
    onAdd: () => onAdd(module.name),
    onEditInput: () => onEditInput(module.name),
    onRemove: () => onRemove(module.name),
    usedBy: usedBy(module.name),
    canAdd
  });

  return (
    <Box sx={{ display: 'flex', flexDirection: 'column', height: '100%', overflow: 'hidden', bgcolor: 'background.default' }}>
      <Box sx={{ p: 2, pb: 1.25, bgcolor: 'background.paper', borderBottom: '1px solid', borderColor: 'divider' }}>
        <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, mb: 1.5 }}>
          <Typography sx={{ fontSize: 18, fontWeight: 700, color: 'text.primary' }}>Modules</Typography>
          {total > 0 && <CountBadge count={total} />}
          <IconButton size="small" aria-label="Module list options" onClick={event => setMenuAnchor(event.currentTarget)} sx={{ p: 0.25, ml: 'auto' }}>
            <MoreHorizIcon sx={{ fontSize: 20 }} />
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
          placeholder="Search modules, promise types…"
          fullWidth
          size="small"
          slotProps={{
            input: {
              sx: { fontSize: 13, borderRadius: '6px' },
              startAdornment: (
                <InputAdornment position="start">
                  <SearchIcon sx={{ fontSize: 16, color: 'text.muted' }} />
                </InputAdornment>
              )
            }
          }}
        />
        <Box sx={{ display: 'flex', gap: 0.75, mt: 1.5, overflowX: 'auto', scrollbarWidth: 'none', '&::-webkit-scrollbar': { display: 'none' } }}>
          {[{ label: 'All', tag: null }, ...TAG_CHIPS].map(({ label, tag }) => (
            <Chip
              key={label}
              label={label}
              size="small"
              clickable
              color={filter.tag === tag ? 'primary' : 'default'}
              variant={filter.tag === tag ? 'filled' : 'outlined'}
              onClick={() => setFilter(current => ({ ...current, tag }))}
              sx={{ height: 28, px: 0.5, fontSize: 12, borderRadius: '14px', flexShrink: 0 }}
            />
          ))}
        </Box>
        <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', mt: 0.75 }}>
          <FormControlLabel
            control={
              <Checkbox
                size="small"
                checked={filter.supportedOnly}
                onChange={event => setFilter(current => ({ ...current, supportedOnly: event.target.checked }))}
              />
            }
            label={<Typography sx={{ fontSize: 13 }}>Supported only</Typography>}
            sx={{ ml: -0.75 }}
          />
          {catalog.modules.length > 0 && (
            <Typography sx={{ fontSize: 12, fontFamily: 'monospace', color: 'text.muted' }}>{results.length} available</Typography>
          )}
        </Box>
        {catalog.offline && catalog.fetchedAt && (
          <Typography sx={{ fontSize: 11, color: 'text.muted' }}>Offline · list from {shortDate(catalog.fetchedAt)}</Typography>
        )}
      </Box>

      <Box sx={{ flex: 1, overflowY: 'auto', px: 1.5, pb: 1.5, pt: 0.5 }}>
        {(projectModules.length > 0 || !filtering) && (
          <Section title="In this project" count={inProject.reduce((count, top) => count + 1 + top.dependencies.length, 0)} success>
            {inProject.length === 0 ? (
              <Typography sx={{ fontSize: 12, color: 'text.muted', px: 1.25, py: 0.75 }}>
                {filtering ? 'None of them match.' : 'No modules yet. Add one from the list below.'}
              </Typography>
            ) : (
              inProject.map(({ module, entry, dependencies }) => (
                <ModuleRow
                  key={module.name}
                  {...rowProps(entry)}
                  inProject
                  addedFor={module.addedBy}
                  needsInput={isNeedingInput(module.name)}
                  dependencies={dependencies.map(dependency => (
                    <DependencyRow
                      key={dependency.module.name}
                      {...rowProps(dependency.entry)}
                      addedFor={module.name}
                      pending={'pending' in dependency.module}
                    />
                  ))}
                />
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
