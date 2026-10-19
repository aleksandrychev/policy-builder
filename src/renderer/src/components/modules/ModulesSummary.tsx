import ChevronRightIcon from '@mui/icons-material/ChevronRight';
import GridViewOutlinedIcon from '@mui/icons-material/GridViewOutlined';
import { ButtonBase, Typography } from '@mui/material';

interface ModulesSummaryProps {
  count: number;
  needingInput: number;
  onClick: () => void;
}

/** Under Configurations: the project's modules, a click away from the Modules view. Nothing while it has none. */
export function ModulesSummary({ count, needingInput, onClick }: ModulesSummaryProps) {
  if (count === 0) return null;
  return (
    <ButtonBase
      onClick={onClick}
      aria-label={`Modules: ${count} in the project${needingInput ? `, ${needingInput} needing input` : ''}`}
      sx={{
        display: 'flex',
        alignItems: 'center',
        gap: 1,
        flexShrink: 0,
        px: 2,
        py: 1.25,
        borderTop: '1px solid',
        borderColor: 'divider',
        justifyContent: 'flex-start',
        '&:hover': { bgcolor: 'action.hover' }
      }}
    >
      <GridViewOutlinedIcon sx={{ fontSize: 18, color: 'text.muted' }} />
      <Typography sx={{ fontSize: 13, fontWeight: 600, color: 'text.primary' }}>Modules</Typography>
      <Typography sx={{ fontSize: 12, color: 'text.muted' }}>{count}</Typography>
      {needingInput > 0 && <Typography sx={{ fontSize: 12, color: 'warning.dark' }}>· {needingInput} needs input</Typography>}
      <ChevronRightIcon sx={{ fontSize: 18, color: 'text.muted', ml: 'auto' }} />
    </ButtonBase>
  );
}
