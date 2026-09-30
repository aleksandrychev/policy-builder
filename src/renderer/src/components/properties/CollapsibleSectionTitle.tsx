import ExpandMoreIcon from '@mui/icons-material/ExpandMore';
import { ButtonBase, Typography } from '@mui/material';

// A section title that doubles as a collapse/expand toggle for whatever
// body content follows it — used by both the "Data transformation" and
// "Condition" sections, which can otherwise get long enough to push
// everything else in the panel out of view.
export function CollapsibleSectionTitle({ title, expanded, onToggle }: { expanded: boolean; onToggle: () => void; title: string }) {
  return (
    <ButtonBase aria-expanded={expanded} onClick={onToggle} sx={{ display: 'flex', alignItems: 'center', gap: 0.5, borderRadius: '4px' }}>
      <ExpandMoreIcon sx={{ fontSize: 16, color: 'text.muted', transform: expanded ? 'none' : 'rotate(-90deg)', transition: 'transform 0.15s' }} />
      <Typography sx={{ fontSize: 11, fontWeight: 700, color: 'text.muted' }}>{title}</Typography>
    </ButtonBase>
  );
}
