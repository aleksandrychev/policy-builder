import { type ReactNode, useEffect, useMemo, useState } from 'react';

import ContentCopyIcon from '@mui/icons-material/ContentCopy';
import { Alert, Box, Button, Chip, CircularProgress, Link, Paper, Stack, Tab, Tabs, TextField, Typography } from '@mui/material';

import type { GitStatus } from '../../../../preload/api';
import { httpsRepoUrl, indexEntry } from '../../modules/indexEntry';
import { type ModuleInput, inputVariable, moduleInputs } from '../../modules/ownModuleInput';
import { VERSION } from '../../project/cfbsProject';
import type { Failure } from '../../project/deployRuns';
import { useAppDispatch, useAppSelector } from '../../store';
import type { ModuleInputResponse } from '../../store/modulesSlice';
import { selectCurrentProject } from '../../store/projectSlice/selectors';
import { type ThisModuleState, moduleAuthorChanged, moduleVersionChanged } from '../../store/thisModuleSlice';
import { FailureAlert, Line } from '../deploy/shared';
import { ModuleInputForm } from './ModuleInputForm';

type ThisModuleTab = 'input' | 'publish';

export interface ThisModulePageProps {
  dirty: boolean;
  onSave: () => Promise<boolean>;
  // Selects a block on the canvas (its file opened).
  onShowBlock: (fileId: string, instanceId: string) => void;
}

const external = { target: '_blank', rel: 'noreferrer' };
const fieldSx = { '& .MuiInputBase-root': { fontSize: 13 } };
const KIND_LABELS = { text: 'Text', list: 'List', table: 'Table' };

function Muted({ children }: { children: ReactNode }) {
  return <Typography sx={{ fontSize: 13, color: 'text.muted' }}>{children}</Typography>;
}

// The module's inputs: the canvas's Module Input blocks, in order, and what cfbs input shows.
function InputTab({
  inputs,
  isModule,
  moduleName,
  onShowBlock
}: {
  inputs: ModuleInput[];
  isModule: boolean;
  moduleName: string;
  onShowBlock: ThisModulePageProps['onShowBlock'];
}) {
  // The preview's own answers: nothing here is saved.
  const [answers, setAnswers] = useState<Record<string, ModuleInputResponse>>({});
  const published = inputs.filter(input => input.problems.length === 0).map(input => input.question);
  return (
    <Stack spacing={2}>
      <Muted>
        The questions policy sets adding this module answer (cfbs add, or the hub’s Build page). Each is a Module Input block on the canvas (Blocks list,
        Variables &amp; Classes): its variable is the answer, or the default without one, for other blocks to use like any variable.
      </Muted>
      {!isModule && <Alert severity="info">This project is a policy set: its input is only asked once it’s stored as a module (Project Settings).</Alert>}
      {inputs.length > 0 && (
        <Alert severity="warning">
          Once published, renaming, adding or removing an input, or changing its type, makes cfbs update ask everyone using the module for all their answers
          again. Labels, questions and defaults can change.
        </Alert>
      )}
      <Box sx={{ display: 'flex', gap: 3, flexWrap: 'wrap', alignItems: 'flex-start' }}>
        <Stack spacing={1} sx={{ flex: '1 1 480px', minWidth: 0 }}>
          {inputs.length === 0 && <Muted>No inputs yet: add a Module Input block to the canvas.</Muted>}
          {inputs.map(input => (
            <Paper key={input.entryId} variant="outlined" sx={{ p: 1.5 }}>
              <Stack direction="row" spacing={1} sx={{ alignItems: 'center' }}>
                <Chip size="small" label={KIND_LABELS[input.kind]} />
                <Typography sx={{ fontSize: 14, fontWeight: 600 }}>{input.question.label || '(no label)'}</Typography>
                <Typography sx={{ fontSize: 12, fontFamily: 'monospace', color: 'text.muted', flex: 1, overflow: 'hidden', textOverflow: 'ellipsis' }}>
                  {inputVariable(moduleName, input.question.variable ?? '')}
                </Typography>
                <Button size="small" onClick={() => onShowBlock(input.fileId, input.instanceId)}>
                  Show on canvas
                </Button>
              </Stack>
              {input.question.question && <Muted>{input.question.question}</Muted>}
              {input.problems.map(problem => (
                <Typography key={problem} sx={{ fontSize: 12, color: 'error.main' }}>
                  {problem} It isn’t published until fixed.
                </Typography>
              ))}
            </Paper>
          ))}
        </Stack>
        <Paper variant="outlined" sx={{ flex: '0 1 340px', p: 2 }}>
          <Typography sx={{ fontSize: 12, fontWeight: 700, color: 'text.secondary', mb: 1.5 }}>What people adding it see</Typography>
          {published.length ? (
            <ModuleInputForm
              questions={published}
              answers={answers}
              onChange={(variable, response) => setAnswers(current => ({ ...current, [variable]: response }))}
            />
          ) : (
            <Muted>No questions: the module is added as is.</Muted>
          )}
        </Paper>
      </Box>
    </Stack>
  );
}

type Validation =
  | { failure: Failure; phase: 'failed' }
  | { phase: 'idle' }
  | { phase: 'running' }
  | { phase: 'valid'; provided: { module: Record<string, unknown>; name: string } | null };

type Tone = 'error' | 'success' | 'warning';

// The project's git status, re-read on demand (the check).
function useGitStatus(path: string | null) {
  const [git, setGit] = useState<GitStatus | null>(null);
  const read = () => (path && window.api ? window.api.gitStatus(path).then(result => (result.ok ? result.status : null)) : Promise.resolve(null));
  useEffect(() => {
    let current = true;
    void read().then(status => current && setGit(status));
    return () => {
      current = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [path]);
  return { git, refresh: () => read().then(setGit) };
}

// Pushed: every change committed, and the remote has the last commit.
const isPushed = (git: GitStatus | null) => Boolean(git?.repo && git.remote && git.upstream && git.ahead === 0 && git.changedFiles === 0 && git.lastCommit);

function gitLine(git: GitStatus | null, repo: string | null): [Tone, string] {
  if (!git?.repo) return ['warning', 'Not a git repository: commit and push it from the Deployment tab'];
  if (!git.remote) return ['warning', 'No remote: set one in the Deployment tab'];
  if (!repo) return ['warning', `The remote (${git.remote}) has no https URL`];
  return isPushed(git) ? ['success', `Pushed to ${repo}`] : ['warning', 'Commits or changes not pushed: commit and push from the Deployment tab'];
}

function inputLine(inputs: ModuleInput[]): [Tone, string] {
  if (!inputs.length) return ['success', 'No input: added as is'];
  const incomplete = inputs.filter(input => input.problems.length > 0).length;
  if (incomplete) return ['warning', `${incomplete} of ${inputs.length} inputs incomplete: they aren’t published`];
  const required = inputs.filter(input => input.kind === 'text' && !input.question.default?.trim()).length;
  return ['success', `${inputs.length} ${inputs.length === 1 ? 'input' : 'inputs'}${required ? `, ${required} without a default (must be answered)` : ''}`];
}

function IndexEntry({ entry }: { entry: string }) {
  const [copied, setCopied] = useState(false);
  const copy = () =>
    void navigator.clipboard.writeText(entry).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    });
  return (
    <Box>
      <Stack direction="row" spacing={1} sx={{ alignItems: 'center', mb: 0.75 }}>
        <Typography sx={{ fontSize: 13, fontWeight: 700, flex: 1 }}>Index entry</Typography>
        <Button size="small" startIcon={<ContentCopyIcon />} onClick={copy}>
          {copied ? 'Copied' : 'Copy'}
        </Button>
      </Stack>
      <Box
        component="pre"
        sx={{ m: 0, p: 1.5, fontSize: 12, fontFamily: 'monospace', bgcolor: 'background.default', borderRadius: '4px', overflow: 'auto', maxHeight: 360 }}
      >
        {entry}
      </Box>
      <Muted>
        Add it to the “index” of cfbs.json in{' '}
        <Link href="https://github.com/cfengine/build-index" {...external}>
          github.com/cfengine/build-index ↗
        </Link>{' '}
        with a pull request. A new release is the entry with a new version and commit.
      </Muted>
    </Box>
  );
}

function SourceFields({ thisModule }: { thisModule: ThisModuleState }) {
  const dispatch = useAppDispatch();
  const versionBad = thisModule.version !== '' && !VERSION.test(thisModule.version);
  return (
    <Stack direction="row" spacing={1.5}>
      <TextField
        label="Version"
        size="small"
        placeholder="1.0.0"
        value={thisModule.version}
        onChange={event => dispatch(moduleVersionChanged({ value: event.target.value.trim() }))}
        error={versionBad}
        helperText={versionBad ? 'Like 1.0.0 or 1.0.0-1' : 'Raise it with each release.'}
        sx={{ ...fieldSx, width: 180 }}
      />
      <TextField
        label="Author"
        size="small"
        placeholder="https://github.com/your-name"
        value={thisModule.by}
        onChange={event => dispatch(moduleAuthorChanged({ value: event.target.value.trim() }))}
        error={thisModule.by !== '' && !AUTHOR.test(thisModule.by)}
        helperText="Your profile’s https URL: the index’s “by”."
        sx={{ ...fieldSx, flex: 1 }}
      />
    </Stack>
  );
}

const AUTHOR = /^https:\/\/\S+$/;

function PublishTab({
  dirty,
  inputs,
  isModule,
  onSave,
  thisModule
}: {
  dirty: boolean;
  inputs: ModuleInput[];
  isModule: boolean;
  onSave: () => Promise<boolean>;
  thisModule: ThisModuleState;
}) {
  const path = useAppSelector(selectCurrentProject)?.path ?? null;
  const { git, refresh } = useGitStatus(path);
  const [validation, setValidation] = useState<Validation>({ phase: 'idle' });

  const check = async () => {
    if (!path || !window.api || (dirty && !(await onSave()))) return;
    setValidation({ phase: 'running' });
    const [result] = await Promise.all([window.api.validateCfbsProject(path), refresh()]);
    setValidation(result.ok ? { phase: 'valid', provided: result.provided } : { phase: 'failed', failure: result });
  };

  const repo = httpsRepoUrl(git?.remote);
  const source = { by: thisModule.by, commit: isPushed(git) ? (git?.lastCommit?.hash ?? '') : '', repo: repo ?? '', version: thisModule.version };
  const complete = VERSION.test(source.version) && AUTHOR.test(source.by) && source.repo !== '' && source.commit !== '';
  const provided = validation.phase === 'valid' ? validation.provided : null;
  const entry = provided && complete ? JSON.stringify(indexEntry(provided.name, provided.module, source), null, 2) : null;
  const lines: [Tone, string][] = [
    isModule ? ['success', 'Stored as a cfbs module'] : ['error', 'A policy set: store it as a module in Project Settings'],
    VERSION.test(source.version) ? ['success', `Version ${source.version}`] : ['warning', 'No version'],
    AUTHOR.test(source.by) ? ['success', `By ${source.by}`] : ['warning', 'No author URL'],
    inputLine(inputs),
    dirty ? ['warning', 'Unsaved edits (the check saves them)'] : ['success', 'All saved'],
    gitLine(git, repo),
    ...(validation.phase === 'valid' ? [['success', 'cfbs validate: no problems'] as [Tone, string]] : [])
  ];

  return (
    <Stack spacing={2} sx={{ maxWidth: 760 }}>
      <Muted>
        Modules in the CFEngine Build index are listed on build.cfengine.com and can be added with cfbs add. A module is listed by a pull request adding its
        entry to the index’s cfbs.json, pointing at a commit of its git repository.
      </Muted>
      <SourceFields thisModule={thisModule} />
      <Paper variant="outlined" sx={{ p: 2 }}>
        <Stack spacing={0.75}>
          {lines.map(([tone, text]) => (
            <Line key={text} tone={tone}>
              {text}
            </Line>
          ))}
        </Stack>
        <Stack direction="row" spacing={1} sx={{ alignItems: 'center', mt: 1.5 }}>
          <Button variant="contained" size="small" disabled={!path || validation.phase === 'running'} onClick={() => void check()}>
            Check for the index
          </Button>
          {validation.phase === 'running' && <CircularProgress size={16} />}
        </Stack>
        {validation.phase === 'failed' && (
          <Box sx={{ mt: 1.5 }}>
            <FailureAlert failure={validation.failure} />
          </Box>
        )}
      </Paper>
      {entry && <IndexEntry entry={entry} />}
      {validation.phase === 'valid' && !entry && <Muted>Set the version and author, and push the project, for its index entry.</Muted>}
    </Stack>
  );
}

/** The Module tab: the input a module project asks for, and publishing it to the CFEngine Build index. */
export function ThisModulePage({ dirty, onSave, onShowBlock }: ThisModulePageProps) {
  const project = useAppSelector(selectCurrentProject);
  const thisModule = useAppSelector(state => state.thisModule);
  const canvas = useAppSelector(state => state.canvas);
  const files = useAppSelector(state => state.files.files);
  const inputs = useMemo(() => moduleInputs(canvas, files), [canvas, files]);
  const [tab, setTab] = useState<ThisModuleTab>('input');
  const moduleName = project?.moduleName ?? '';
  const isModule = project?.type === 'module';
  return (
    <Box sx={{ flex: 1, minWidth: 0, display: 'flex', flexDirection: 'column', bgcolor: 'background.paper', overflow: 'hidden' }}>
      <Box sx={{ flex: 1, overflowY: 'auto' }}>
        <Box sx={{ p: 3, maxWidth: 1200 }}>
          <Stack direction="row" spacing={1.5} sx={{ alignItems: 'baseline', flexWrap: 'wrap' }}>
            <Typography component="h1" sx={{ fontSize: 24, fontWeight: 700, color: 'text.primary', wordBreak: 'break-word' }}>
              {moduleName}
            </Typography>
            {thisModule.version && <Typography sx={{ fontSize: 13, fontFamily: 'monospace', color: 'text.muted' }}>{thisModule.version}</Typography>}
          </Stack>
          <Typography sx={{ fontSize: 14, color: 'text.primary', mt: 1 }}>{project?.description || 'Policy built with CFEngine Policy Builder'}</Typography>
          <Tabs
            value={tab}
            onChange={(_event, value: ThisModuleTab) => setTab(value)}
            sx={{ mt: 2, mb: 2, borderBottom: '1px solid', borderColor: 'divider', minHeight: 36 }}
          >
            <Tab value="input" label={`Input (${inputs.length})`} sx={{ minHeight: 36, textTransform: 'none' }} />
            <Tab value="publish" label="Publish" sx={{ minHeight: 36, textTransform: 'none' }} />
          </Tabs>
          {tab === 'input' ? (
            <InputTab inputs={inputs} isModule={isModule} moduleName={moduleName} onShowBlock={onShowBlock} />
          ) : (
            <PublishTab dirty={dirty} inputs={inputs} isModule={isModule} onSave={onSave} thisModule={thisModule} />
          )}
        </Box>
      </Box>
    </Box>
  );
}
