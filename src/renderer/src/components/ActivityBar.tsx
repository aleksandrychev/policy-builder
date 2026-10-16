import type { SvgIconComponent } from '@mui/icons-material';
import ExtensionOutlinedIcon from '@mui/icons-material/ExtensionOutlined';
import WidgetsOutlinedIcon from '@mui/icons-material/WidgetsOutlined';
import { Badge, Box, ButtonBase, Tooltip } from '@mui/material';

export type SideView = 'modules' | 'policy';

const isMac = typeof navigator !== 'undefined' && /Mac/.test(navigator.platform);
const shortcut = (key: string) => (isMac ? `⇧⌘${key}` : `Ctrl+Shift+${key}`);

export const SIDE_VIEWS: { icon: SvgIconComponent; id: SideView; label: string; shortcut: string }[] = [
  { id: 'policy', label: 'Blocks and files', icon: WidgetsOutlinedIcon, shortcut: shortcut('E') },
  { id: 'modules', label: 'Modules', icon: ExtensionOutlinedIcon, shortcut: shortcut('X') }
];

interface ActivityBarProps {
  // The open view; null while the side bar is collapsed.
  active: SideView | null;
  badges?: Partial<Record<SideView, number>>;
  onSelect: (view: SideView) => void;
}

/** The strip of view icons left of the side bar, as in VS Code: a click opens a view, or collapses the open one. */
export function ActivityBar({ active, badges = {}, onSelect }: ActivityBarProps) {
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
        pt: 0.5,
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
            <ButtonBase
              aria-label={label}
              aria-pressed={selected}
              onClick={() => onSelect(id)}
              sx={{
                width: 44,
                height: 44,
                borderLeft: '2px solid',
                borderColor: selected ? 'primary.main' : 'transparent',
                color: selected ? 'text.primary' : 'text.muted',
                '&:hover': { color: 'text.primary' }
              }}
            >
              <Badge badgeContent={count} color="warning" max={99} overlap="circular" sx={{ '& .MuiBadge-badge': { fontSize: 10, height: 16, minWidth: 16 } }}>
                <Icon sx={{ fontSize: 22 }} />
              </Badge>
            </ButtonBase>
          </Tooltip>
        );
      })}
    </Box>
  );
}
