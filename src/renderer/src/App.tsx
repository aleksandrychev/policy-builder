import { useEffect, useRef, useState } from 'react';

import { Alert, Box, Snackbar } from '@mui/material';

import { AgentActivityBar } from './components/agent/AgentActivityBar';
import { AgentLock } from './components/agent/AgentLock';
import { AgentLogPanel } from './components/agent/AgentLogPanel';
import { ConnectAgentDialog } from './components/dialogs/ConnectAgentDialog';
import { NewProjectDialog, useMasterfilesVersions } from './components/dialogs/NewProjectDialog';
import { ProjectSettingsDialog } from './components/dialogs/ProjectSettingsDialog';
import { UnsavedChangesDialog } from './components/dialogs/UnsavedChangesDialog';
import { isWorking, useAgentActivity } from './mcp/activity';
import { useMcpTools } from './mcp/useMcpTools';
import NoProjectScreen from './pages/NoProjectScreen';
import ProjectView from './pages/ProjectView';
import { useProjectSession } from './project/useProjectSession';

type Session = ReturnType<typeof useProjectSession>;

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
  const masterfilesVersions = useMasterfilesVersions();

  useEffect(
    () =>
      window.api?.onMenuAction((action, path) => {
        const current = sessionRef.current;
        if (action === 'new-project') current.newProject();
        else if (action === 'try-demo') current.startDemo();
        else if (action === 'save' && !modalOpen()) current.save();
        else if (action === 'close-requested') current.requestClose();
        else if (action === 'open-project' && !modalOpen()) current.openProject();
        else if (action === 'open-recent' && path && !modalOpen()) current.openProject(path);
        else if (action === 'recents-changed') setRecentsVersion(version => version + 1);
        else if (action === 'project-settings' && current.project && !modalOpen()) setSettingsOpen(true);
        else if (action === 'connect-agent' && !modalOpen()) setConnectAgentOpen(true);
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
    window.api?.setDocument({ edited: dirty, title: project?.name ?? null }).catch(() => {});
  }, [dirty, project?.name]);

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
