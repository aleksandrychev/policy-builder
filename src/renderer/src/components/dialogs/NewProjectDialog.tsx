import { useEffect, useState } from 'react';

import {
  Alert,
  Box,
  Button,
  Checkbox,
  Collapse,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  FormControl,
  FormControlLabel,
  FormLabel,
  LinearProgress,
  Link,
  Radio,
  RadioGroup,
  Stack,
  TextField,
  Typography
} from '@mui/material';

import { projectFolderName } from '../../project/cfbsProject';
import type { ProjectType } from '../../store/projectSlice/types';
import { ProjectTypeField } from './ProjectTypeField';

export const DEFAULT_DESCRIPTION = 'Policy built with CFEngine Policy Builder';
const FALLBACK_VERSIONS = { latest: '3.27.1' };

// Generated policy evaluates top-down, which needs CFEngine 3.27+.
type MasterfilesChoice = 'latest' | 'master';
type TargetCheck = Awaited<ReturnType<NonNullable<Window['api']>['checkProjectTarget']>>;

export interface ProjectFormValues {
  description: string;
  folderName: string;
  git: boolean;
  // An exact version ("3.27.1") or "master".
  masterfiles: string;
  name: string;
  // null without the Electron bridge (tests): the project stays in memory.
  parent: string | null;
  type: ProjectType;
}

export type SubmitResult = { ok: true } | { details: string; message: string; ok: false };

interface NewProjectDialogProps {
  initialDescription?: string;
  initialName?: string;
  initialType?: ProjectType;
  // 'saveAs': gives an in-memory project (the demo) its folder on disk.
  mode: 'new' | 'saveAs';
  onClose: () => void;
  onSubmit: (values: ProjectFormValues) => Promise<SubmitResult>;
}

const joinPath = (parent: string, name: string) => {
  const separator = parent.includes('\\') && !parent.includes('/') ? '\\' : '/';
  return `${parent.replace(/[/\\]+$/, '')}${separator}${name}`;
};

function useDefaultParent() {
  const [parent, setParent] = useState<string | null>(null);
  useEffect(() => {
    window.api
      ?.getDefaultProjectParent()
      .then(path => setParent(current => current ?? path))
      .catch(() => {});
  }, []);
  return [parent, setParent] as const;
}

export function useMasterfilesVersions() {
  const [versions, setVersions] = useState(FALLBACK_VERSIONS);
  useEffect(() => {
    window.api
      ?.getMasterfilesVersions()
      .then(setVersions)
      .catch(() => {});
  }, []);
  return versions;
}

// Debounced; null while the check for the current parent/folder is pending.
function useTargetCheck(parent: string | null, folderName: string): TargetCheck | null {
  const key = `${parent}\0${folderName}`;
  const [check, setCheck] = useState<{ key: string; result: TargetCheck } | null>(null);
  useEffect(() => {
    if (!parent || !folderName) return;
    let cancelled = false;
    const timer = setTimeout(() => {
      window.api
        ?.checkProjectTarget(parent, folderName)
        .catch((): TargetCheck => ({ parentWritable: false, targetState: 'new' }))
        .then(result => !cancelled && setCheck({ key: `${parent}\0${folderName}`, result }));
    }, 250);
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [parent, folderName]);
  return check?.key === key ? check.result : null;
}

interface LocationFieldProps {
  check: TargetCheck | null;
  disabled: boolean;
  folderName: string;
  onChange: (parent: string) => void;
  parent: string | null;
}

function LocationField({ parent, folderName, check, disabled, onChange }: LocationFieldProps) {
  const choose = () =>
    window.api
      ?.pickDirectory(parent ?? undefined)
      .then(path => path && onChange(path))
      .catch(() => {});
  const nonEmpty = check?.targetState === 'nonEmpty';
  return (
    <Box>
      <Stack direction="row" spacing={1} sx={{ alignItems: 'flex-start' }}>
        <TextField
          label="Location"
          value={parent ?? ''}
          fullWidth
          size="small"
          disabled={disabled}
          error={check?.parentWritable === false}
          helperText={check?.parentWritable === false ? 'Can’t create a folder here — choose another location.' : undefined}
          slotProps={{ input: { readOnly: true }, htmlInput: { title: parent ?? '' } }}
        />
        <Button variant="outlined" color="primary" onClick={choose} disabled={disabled} sx={{ flexShrink: 0 }}>
          Choose…
        </Button>
      </Stack>
      {parent && folderName && (
        <Typography sx={{ fontSize: 12, mt: 0.5, color: nonEmpty ? 'error.main' : 'text.muted', wordBreak: 'break-all' }}>
          {nonEmpty ? `A folder named '${folderName}' already exists and isn’t empty.` : `Will be created at: ${joinPath(parent, folderName)}`}
        </Typography>
      )}
    </Box>
  );
}

function ErrorAlert({ error }: { error: { details: string; message: string } }) {
  const [showDetails, setShowDetails] = useState(false);
  return (
    <Alert severity="error">
      <Typography sx={{ fontSize: 14 }}>{error.message}</Typography>
      {error.details && (
        <>
          <Link component="button" type="button" onClick={() => setShowDetails(shown => !shown)} sx={{ fontSize: 12 }}>
            {showDetails ? 'Hide details' : 'Details'}
          </Link>
          <Collapse in={showDetails}>
            <Box component="pre" sx={{ fontSize: 11, maxHeight: 200, overflow: 'auto', whiteSpace: 'pre-wrap', wordBreak: 'break-word', m: 0, mt: 1 }}>
              {error.details}
            </Box>
          </Collapse>
        </>
      )}
    </Alert>
  );
}

/**
 * Creates a cfbs project folder on disk (`cfbs init` via main) and opens it.
 * Without the Electron bridge (tests) the project is created in memory only.
 */
export function NewProjectDialog({
  mode,
  initialName = '',
  initialDescription = DEFAULT_DESCRIPTION,
  initialType = 'policy-set',
  onClose,
  onSubmit
}: NewProjectDialogProps) {
  const persistent = Boolean(window.api);
  const [name, setName] = useState(initialName);
  const [description, setDescription] = useState(initialDescription);
  const [parent, setParent] = useDefaultParent();
  const versions = useMasterfilesVersions();
  const [masterfiles, setMasterfiles] = useState<MasterfilesChoice>('latest');
  const [git, setGit] = useState(true);
  const [type, setType] = useState<ProjectType>(initialType);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<{ details: string; message: string } | null>(null);

  const folderName = projectFolderName(name);
  const check = useTargetCheck(parent, folderName);
  const nameInvalid = Boolean(name.trim()) && !folderName;
  const locationValid = !persistent || (check !== null && check.parentWritable && check.targetState !== 'nonEmpty');
  const canSubmit = Boolean(folderName && description.trim()) && locationValid && !submitting;
  const version = { latest: versions.latest, master: 'master' }[masterfiles];
  const saveAs = mode === 'saveAs';

  const handleSubmit = async () => {
    if (!canSubmit) return;
    setSubmitting(true);
    setError(null);
    // A module brings no masterfiles: the policy sets that add it do.
    const masterfilesValue = type === 'module' ? 'no' : version;
    const values = {
      name: name.trim(),
      description: description.trim(),
      parent: persistent ? parent : null,
      folderName,
      masterfiles: masterfilesValue,
      git,
      type
    };
    const result = await onSubmit(values).catch((cause: unknown): SubmitResult => ({
      ok: false,
      message: String((cause as Error)?.message ?? cause),
      details: ''
    }));
    // On success the dialog is unmounted by its owner.
    if (!result.ok) {
      setError(result);
      setSubmitting(false);
    }
  };

  const progress =
    type === 'module'
      ? 'Creating the module…'
      : masterfiles === 'master'
        ? 'Downloading masterfiles from the master branch…'
        : `Downloading masterfiles ${version}…`;

  return (
    <Dialog open onClose={submitting ? undefined : onClose} fullWidth maxWidth="sm">
      <DialogTitle>{saveAs ? 'Save Project As' : 'New Project'}</DialogTitle>
      {submitting && <LinearProgress />}
      <form
        onSubmit={event => {
          event.preventDefault();
          handleSubmit();
        }}
      >
        <DialogContent sx={{ pt: submitting ? 1.5 : undefined }}>
          <Stack spacing={2.5} sx={{ pt: 1 }}>
            <Box>
              <TextField
                label="Project name"
                value={name}
                onChange={event => setName(event.target.value)}
                autoFocus
                required
                fullWidth
                size="small"
                disabled={submitting}
                error={nameInvalid}
                helperText={nameInvalid ? 'Use at least one letter or digit.' : undefined}
                slotProps={{ htmlInput: { maxLength: 100 } }}
              />
              {!saveAs && (
                <Typography sx={{ fontSize: 12, fontStyle: 'italic', color: 'text.muted', mt: 0.5 }}>
                  This can’t be changed later — it also becomes the first policy file’s namespace.
                </Typography>
              )}
            </Box>
            <TextField
              label="Description"
              value={description}
              onChange={event => setDescription(event.target.value)}
              required
              fullWidth
              size="small"
              disabled={submitting}
              slotProps={{ htmlInput: { maxLength: 500 } }}
            />
            {persistent && (
              <>
                <LocationField parent={parent} folderName={folderName} check={check} disabled={submitting} onChange={setParent} />
                <FormControl disabled={submitting} sx={{ display: type === 'module' ? 'none' : undefined }}>
                  <FormLabel id="masterfiles-label" sx={{ fontSize: 14 }}>
                    Which version of masterfiles would you like to use?
                  </FormLabel>
                  <RadioGroup
                    aria-labelledby="masterfiles-label"
                    value={masterfiles}
                    onChange={event => setMasterfiles(event.target.value as MasterfilesChoice)}
                  >
                    <FormControlLabel value="latest" control={<Radio size="small" />} label={`Latest (${versions.latest})`} />
                    <FormControlLabel value="master" control={<Radio size="small" />} label="Master branch" />
                  </RadioGroup>
                </FormControl>
                <ProjectTypeField value={type} onChange={setType} disabled={submitting} />
                <Box>
                  <FormControlLabel
                    control={<Checkbox size="small" checked={git} onChange={event => setGit(event.target.checked)} disabled={submitting} />}
                    label="Initialize a git repository"
                  />
                  <Typography sx={{ fontSize: 12, color: 'text.muted', ml: 4 }}>Makes one initial commit</Typography>
                </Box>
              </>
            )}
            {submitting && persistent && <Typography sx={{ fontSize: 12, color: 'text.muted' }}>{progress}</Typography>}
            {error && <ErrorAlert error={error} />}
          </Stack>
        </DialogContent>
        <DialogActions>
          <Button variant="text" color="primary" onClick={onClose} disabled={submitting}>
            Cancel
          </Button>
          <Button type="submit" variant="contained" color="primary" disabled={!canSubmit}>
            {submitting ? (saveAs ? 'Saving…' : 'Creating…') : saveAs ? 'Save' : 'Create'}
          </Button>
        </DialogActions>
      </form>
    </Dialog>
  );
}
