import type { ReactNode } from 'react';

import type { SvgIconComponent } from '@mui/icons-material';
import CallMergeOutlinedIcon from '@mui/icons-material/CallMergeOutlined';
import CallSplitOutlinedIcon from '@mui/icons-material/CallSplitOutlined';
import CancelOutlinedIcon from '@mui/icons-material/CancelOutlined';
import CheckCircleOutlineOutlinedIcon from '@mui/icons-material/CheckCircleOutlineOutlined';
import DataObjectIcon from '@mui/icons-material/DataObject';
import DescriptionOutlinedIcon from '@mui/icons-material/DescriptionOutlined';
import EditNoteOutlinedIcon from '@mui/icons-material/EditNoteOutlined';
import FormatListBulletedIcon from '@mui/icons-material/FormatListBulleted';
import FormatQuoteIcon from '@mui/icons-material/FormatQuote';
import InfoOutlinedIcon from '@mui/icons-material/InfoOutlined';
import RuleOutlinedIcon from '@mui/icons-material/RuleOutlined';
import SettingsEthernetIcon from '@mui/icons-material/SettingsEthernet';
import TerminalIcon from '@mui/icons-material/Terminal';
import { Box, ListItemIcon, ListItemText, MenuItem, Typography } from '@mui/material';

export const VALUE_SOURCE_ICONS: Record<string, SvgIconComponent> = {
  literal: FormatQuoteIcon,
  list: FormatListBulletedIcon,
  'structured-data-literal': DataObjectIcon,
  'command-output': TerminalIcon,
  'file-lines': FormatListBulletedIcon,
  'file-content': DescriptionOutlinedIcon,
  'file-metadata': InfoOutlinedIcon,
  'environment-variable': SettingsEthernetIcon,
  'structured-data-json': DataObjectIcon,
  // Define Class's condition types.
  'always-true': CheckCircleOutlineOutlinedIcon,
  'always-false': CancelOutlinedIcon,
  'combine-and': CallMergeOutlinedIcon,
  'combine-or': CallSplitOutlinedIcon,
  'check-file-exists': RuleOutlinedIcon,
  'check-dir-exists': RuleOutlinedIcon,
  'check-variable-defined': RuleOutlinedIcon,
  'check-matches-pattern': RuleOutlinedIcon,
  'check-values-equal': RuleOutlinedIcon,
  'check-greater-than': RuleOutlinedIcon,
  'check-less-than': RuleOutlinedIcon,
  'check-command-succeeds': TerminalIcon,
  custom: EditNoteOutlinedIcon
};

interface MenuSourceLike {
  badge?: string;
  group?: string;
  id: string;
  label: string;
}

// Grouped under a header where a source declares `group` (e.g. Define
// Class's Always/Combine/Check/Custom); ungrouped sources (Define Variable
// and the Condition type picker have none) render as a flat list, unchanged
// from before grouping existed. Takes the minimal shared shape rather than
// BlockValueSource specifically so the Condition type picker (ConditionType[])
// can reuse this same rendering instead of a second, near-identical one.
export function valueSourceMenuItems(sources: MenuSourceLike[]): ReactNode[] {
  const seenGroups = new Set<string>();
  const items: ReactNode[] = [];
  for (const source of sources) {
    if (source.group && !seenGroups.has(source.group)) {
      seenGroups.add(source.group);
      items.push(
        <Box key={`group-${source.group}`} sx={{ px: 1.5, pt: seenGroups.size > 1 ? 1 : 0, pb: 0.25 }}>
          <Typography sx={{ fontSize: 11, fontWeight: 700, color: 'text.muted' }}>{source.group}</Typography>
        </Box>
      );
    }
    const Icon = VALUE_SOURCE_ICONS[source.id];
    items.push(
      <MenuItem key={source.id} value={source.id}>
        {Icon && (
          <ListItemIcon sx={{ minWidth: 32 }}>
            <Icon sx={{ fontSize: 18, color: 'text.muted' }} />
          </ListItemIcon>
        )}
        <ListItemText primary={source.label} />
        {source.badge && <Typography sx={{ fontSize: 11, fontFamily: 'monospace', color: 'text.muted', ml: 1 }}>{source.badge}</Typography>}
      </MenuItem>
    );
  }
  return items;
}
