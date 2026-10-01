import { FormControl, FormControlLabel, FormLabel, Radio, RadioGroup, Typography } from '@mui/material';

import type { ProjectType } from '../../store/projectSlice/types';

const OPTIONS: { description: string; label: string; value: ProjectType }[] = [
  {
    value: 'policy-set',
    label: 'Policy set',
    description: 'A complete policy: masterfiles plus this project, built and deployed with cfbs build.'
  },
  {
    value: 'module',
    label: 'Module',
    description: 'A cfbs module other policy sets add with cfbs add <git URL>; they choose the masterfiles.'
  }
];

/** "Store as": how the project's cfbs.json is shaped (its `type`). */
export function ProjectTypeField({ disabled, onChange, value }: { disabled?: boolean; onChange: (type: ProjectType) => void; value: ProjectType }) {
  return (
    <FormControl disabled={disabled}>
      <FormLabel id="project-type-label" sx={{ fontSize: 14 }}>
        Store as
      </FormLabel>
      <RadioGroup aria-labelledby="project-type-label" value={value} onChange={event => onChange(event.target.value as ProjectType)}>
        {OPTIONS.map(option => (
          <FormControlLabel
            key={option.value}
            value={option.value}
            control={<Radio size="small" />}
            label={
              <>
                {option.label}
                <Typography component="span" sx={{ display: 'block', fontSize: 12, color: 'text.muted' }}>
                  {option.description}
                </Typography>
              </>
            }
          />
        ))}
      </RadioGroup>
    </FormControl>
  );
}
