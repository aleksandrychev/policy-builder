import { useEffect, useRef, useState } from 'react';

import { Alert, Box, Snackbar } from '@mui/material';

import { AgentActivityBar } from './components/agent/AgentActivityBar';
import { AgentLock } from './components/agent/AgentLock';
import { AgentLogPanel } from './components/agent/AgentLogPanel';
import { ConnectAgentDialog } from './components/dialogs/ConnectAgentDialog';
import { KeyboardShortcutsDialog } from './components/dialogs/KeyboardShortcutsDialog';
import { NewProjectDialog, useMasterfilesVersions } from './components/dialogs/NewProjectDialog';
import { ProjectSettingsDialog } from './components/dialogs/ProjectSettingsDialog';
import { UnsavedChangesDialog } from './components/dialogs/UnsavedChangesDialog';
import { isWorking, useAgentActivity } from './mcp/activity';
import { useMcpTools } from './mcp/useMcpTools';
import NoProjectScreen from './pages/NoProjectScreen';
import ProjectView from './pages/ProjectView';
import { runMenuCommand } from './pages/menuCommands';
import { useProjectSession } from './project/useProjectSession';

type Session = ReturnType<typeof useProjectSession>;
type MenuAction = Parameters<Parameters<NonNullable<Window['api']>['onMenuAction']>[0]>[0];
type MenuHandlers = Partial<Record<MenuAction, () => unknown>>;

// A menu's Save while a dialog is up would act behind it.
const modalOpen = () => Boolean(document.querySelector('[role="dialog"]'));

export default function App() {
  const session = useProjectSession();
  useMcpTools(session.tools);
  const activity = useAgentActivity();
  const agentWorking = isWorking(activity);
  const [logOpen, setLogOpen] = useState(false);
  // The log opens when an agent starts working; the user may close it again.
  const [wasWorking, setWasWorking] = useState(false);
  if (agentWorking !== wasWorking) {
    setWasWorking(agentWorking);
    if (agentWorking) setLogOpen(true);
  }
  const { project, dirty, projectDialog, unsavedPrompt } = session;
  // The native menu (main/index.ts's buildApplicationMenu) outlives renders: it always reaches the latest session.
  const sessionRef = useRef<Session>(session);
  useEffect(() => {
    sessionRef.current = session;
  });
  // Bumped when main reports the recent-projects list changed.
  const [recentsVersion, setRecentsVersion] = useState(0);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [connectAgentOpen, setConnectAgentOpen] = useState(false);
  const [shortcutsOpen, setShortcutsOpen] = useState(false);
  const masterfilesVersions = useMasterfilesVersions();

  useEffect(
    () =>
      window.api?.onMenuAction((action, argument) => {
        const current = sessionRef.current;
        const path = current.project?.path;
        const always: MenuHandlers = {
          command: () => argument && runMenuCommand(argument),
          'close-requested': () => current.requestClose(),
          'keyboard-shortcuts': () => !modalOpen() && setShortcutsOpen(true),
          'new-project': () => current.newProject(),
          'recents-changed': () => setRecentsVersion(version => version + 1),
          'show-project-folder': () => path && window.api?.revealProject(path).catch(() => {}),
          'try-demo': () => current.startDemo()
        };
        // Not while a dialog is up: they would act behind it.
        const whenIdle: MenuHandlers = {
          'close-project': () => current.project && current.closeProject(),
          'connect-agent': () => setConnectAgentOpen(true),
          'open-project': () => current.openProject(),
          'open-recent': () => argument && current.openProject(argument),
          'project-settings': () => current.project && setSettingsOpen(true),
          'reload-project': () => path && current.revertProject(),
          save: () => current.save()
        };
        (always[action] ?? (modalOpen() ? undefined : whenIdle[action]))?.();
      }),
    []
  );

  // A project folder or cfbs.json dropped anywhere on the window opens it (drops an editor handled are left alone).
  useEffect(() => {
    const hasFiles = (event: DragEvent) => Boolean(event.dataTransfer?.types.includes('Files'));
    const onDragOver = (event: DragEvent) => {
      if (!hasFiles(event)) return;
      event.preventDefault();
      if (event.dataTransfer) event.dataTransfer.dropEffect = modalOpen() ? 'none' : 'copy';
    };
    const onDrop = (event: DragEvent) => {
      const file = event.dataTransfer?.files[0];
      if (!file || event.defaultPrevented) return;
      event.preventDefault();
      const path = window.api?.getPathForFile(file);
      if (path && !modalOpen()) sessionRef.current.openProject(path);
    };
    window.addEventListener('dragover', onDragOver);
    window.addEventListener('drop', onDrop);
    return () => {
      window.removeEventListener('dragover', onDragOver);
      window.removeEventListener('drop', onDrop);
    };
  }, []);

  useEffect(() => {
    window.api?.setDocument({ edited: dirty, onDisk: Boolean(project?.path), title: project?.name ?? null }).catch(() => {});
  }, [dirty, project?.name, project?.path]);

  return (
    <Box sx={{ height: '100vh', display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
      <AgentActivityBar activity={activity} onToggleLog={() => setLogOpen(open => !open)} />
      <Box sx={{ flex: 1, minHeight: 0, position: 'relative' }}>
        {project ? (
          <ProjectView
            key={project.id}
            locked={agentWorking}
            dirty={dirty}
            onSave={session.save}
            onReload={session.reloadProject}
            onOpenSettings={() => setSettingsOpen(true)}
            onConnectAgent={() => setConnectAgentOpen(true)}
          />
        ) : (
          <NoProjectScreen
            onNewProject={session.newProject}
            onOpenProject={session.openProject}
            onTryDemo={session.startDemo}
            recentsVersion={recentsVersion}
          />
        )}
        {/* The start screen has nothing to watch: the lock covers all of it. */}
        {!project && agentWorking && <AgentLock />}
      </Box>
      {(logOpen || activity.log.length > 0 || agentWorking || activity.paused) && (
        <AgentLogPanel activity={activity} open={logOpen} onToggle={() => setLogOpen(open => !open)} />
      )}
      {connectAgentOpen && <ConnectAgentDialog onClose={() => setConnectAgentOpen(false)} />}
      {shortcutsOpen && <KeyboardShortcutsDialog onClose={() => setShortcutsOpen(false)} />}
      {project && settingsOpen && (
        <ProjectSettingsDialog
          project={project}
          latestMasterfiles={masterfilesVersions.latest}
          onTypeChange={session.changeProjectType}
          onClose={() => setSettingsOpen(false)}
        />
      )}
      {projectDialog && (
        <NewProjectDialog
          mode={projectDialog}
          initialName={projectDialog === 'saveAs' ? project?.name : undefined}
          initialDescription={projectDialog === 'saveAs' ? project?.description || undefined : undefined}
          initialType={projectDialog === 'saveAs' ? project?.type : undefined}
          onClose={session.closeProjectDialog}
          onSubmit={session.submitProjectDialog}
        />
      )}
      {unsavedPrompt && project && <UnsavedChangesDialog projectName={project.name} {...unsavedPrompt} />}
      <Snackbar open={Boolean(session.error)} onClose={session.dismissError} anchorOrigin={{ vertical: 'bottom', horizontal: 'center' }}>
        <Alert severity="error" onClose={session.dismissError}>
          {session.error}
        </Alert>
      </Snackbar>
    </Box>
  );
}
