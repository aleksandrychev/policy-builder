import { Box } from '@mui/material';

interface BlockNodesIconProps {
  color?: string;
  size?: number;
}

export function BlockNodesIcon({ size = 56, color = 'text.muted' }: BlockNodesIconProps) {
  return (
    <Box
      component="svg"
      width={size}
      height={size}
      viewBox="0 0 56 56"
      fill="none"
      stroke="currentColor"
      strokeWidth={2}
      strokeLinecap="round"
      strokeLinejoin="round"
      sx={{ color }}
    >
      <rect x={4} y={16} width={14} height={14} rx={2} />
      <rect x={38} y={7} width={14} height={14} rx={2} />
      <rect x={38} y={27} width={14} height={14} rx={2} />
      <path d="M18 23H28V14H38" />
      <path d="M28 23V34H38" />
      <circle cx={28} cy={46} r={3} />
      <path d="M11 30V46H25" strokeDasharray="2 2" />
    </Box>
  );
}
