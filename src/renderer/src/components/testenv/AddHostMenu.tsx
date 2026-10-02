import { Divider, ListSubheader, Menu, MenuItem, Typography } from '@mui/material';

import { PLATFORMS, type PlatformSupport } from '../../store/testEnvironmentsSlice/types';

export interface AddHostMenuProps {
  anchor: HTMLElement | null;
  // The platform offered first: the last host's.
  last?: string;
  onClose: () => void;
  // Opens the custom image dialog.
  onOther: () => void;
  onSelect: (platform: string) => void;
  support: PlatformSupport | null;
}

/** Picks the platform a new client host runs; platforms without a client package are disabled. */
export function AddHostMenu({ anchor, last, onClose, onOther, onSelect, support }: AddHostMenuProps) {
  const item = (platform: (typeof PLATFORMS)[number], key: string = platform.id) => {
    const missing = support?.[platform.id] && !support[platform.id].client;
    return (
      <MenuItem key={key} disabled={Boolean(missing)} onClick={() => onSelect(platform.id)} sx={{ fontSize: 14 }}>
        {platform.label}
        {missing && <Typography sx={{ fontSize: 11, color: 'text.muted', ml: 1 }}>no package</Typography>}
      </MenuItem>
    );
  };
  const same = PLATFORMS.find(platform => platform.id === last);
  return (
    <Menu anchorEl={anchor} open={Boolean(anchor)} onClose={onClose} slotProps={{ paper: { sx: { minWidth: 260 } } }}>
      <ListSubheader sx={{ lineHeight: '32px' }}>New client host runs</ListSubheader>
      {same && [item(same, 'last'), <Divider key="divider" />]}
      {PLATFORMS.filter(platform => platform !== same).map(platform => item(platform))}
      <Divider />
      <MenuItem onClick={onOther} sx={{ fontSize: 14 }}>
        Other image…
      </MenuItem>
    </Menu>
  );
}
