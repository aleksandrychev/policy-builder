import type { SvgIconComponent } from '@mui/icons-material';
import FileCopyOutlinedIcon from '@mui/icons-material/FileCopyOutlined';
import GridViewOutlinedIcon from '@mui/icons-material/GridViewOutlined';
import TuneIcon from '@mui/icons-material/Tune';
import { Badge, Box, ButtonBase, type SxProps, type Theme, Tooltip } from '@mui/material';

export type SideView = 'modules' | 'policy';

const isMac = typeof navigator !== 'undefined' && /Mac/.test(navigator.platform);
const shortcut = (key: string) => (isMac ? `⇧⌘${key}` : `Ctrl+Shift+${key}`);

export const SIDE_VIEWS: { icon: SvgIconComponent; id: SideView; label: string; shortcut: string }[] = [
  { id: 'policy', label: 'Blocks and files', icon: FileCopyOutlinedIcon, shortcut: shortcut('E') },
  { id: 'modules', label: 'Modules', icon: GridViewOutlinedIcon, shortcut: shortcut('X') }
];

interface ActivityBarProps {
  // The open view; null while the side bar is collapsed.
  active: SideView | null;
  badges?: Partial<Record<SideView, number>>;
  // The settings at the bottom, as VS Code's Manage: the project's.
  onOpenSettings?: () => void;
  onSelect: (view: SideView) => void;
  settingsDisabled?: boolean;
}

const buttonSx = (selected: boolean): SxProps<Theme> => ({
  position: 'relative',
  width: 36,
  height: 36,
  my: 0.5,
  borderRadius: '8px',
  bgcolor: selected ? 'action.selected' : 'transparent',
  color: selected ? 'primary.main' : 'text.muted',
  '&:hover': { color: selected ? 'primary.main' : 'text.primary', bgcolor: selected ? 'action.selected' : 'action.hover' },
  '&.Mui-disabled': { opacity: 0.4 },
  // The open view's marker, on the strip's left edge.
  '&::before': selected ? { content: '""', position: 'absolute', left: -4, top: 8, bottom: 8, width: 2, borderRadius: 1, bgcolor: 'primary.main' } : {}
});

/** The strip of view icons left of the side bar, as in VS Code: a click opens a view, or collapses the open one. */
export function ActivityBar({ active, badges = {}, onOpenSettings, onSelect, settingsDisabled }: ActivityBarProps) {
  return (
    <Box
      component="nav"
      aria-label="Side bar views"
      sx={{
        width: 44,
        flexShrink: 0,
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        py: 0.5,
        bgcolor: 'background.paper',
        borderRight: '1px solid',
        borderColor: 'divider'
      }}
    >
      {SIDE_VIEWS.map(({ icon: Icon, id, label, shortcut: keys }) => {
        const selected = active === id;
        const count = badges[id] ?? 0;
        return (
          <Tooltip key={id} title={`${label} (${keys})`} placement="right">
            <ButtonBase aria-label={label} aria-pressed={selected} onClick={() => onSelect(id)} sx={buttonSx(selected)}>
              <Badge badgeContent={count} color="warning" max={99} overlap="circular" sx={{ '& .MuiBadge-badge': { fontSize: 10, height: 16, minWidth: 16 } }}>
                <Icon sx={{ fontSize: 22 }} />
              </Badge>
            </ButtonBase>
          </Tooltip>
        );
      })}
      {onOpenSettings && (
        <Tooltip title={`Project settings (${isMac ? '⌘,' : 'Ctrl+,'})`} placement="right">
          <span style={{ marginTop: 'auto' }}>
            <ButtonBase aria-label="Project settings" onClick={onOpenSettings} disabled={settingsDisabled} sx={buttonSx(false)}>
              <TuneIcon sx={{ fontSize: 22 }} />
            </ButtonBase>
          </span>
        </Tooltip>
      )}
    </Box>
  );
}
