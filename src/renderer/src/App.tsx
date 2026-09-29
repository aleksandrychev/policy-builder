import { useEffect, useRef, useState } from 'react';

import { Alert, Snackbar } from '@mui/material';

import { NewProjectDialog } from './components/dialogs/NewProjectDialog';
import { UnsavedChangesDialog } from './components/dialogs/UnsavedChangesDialog';
import NoProjectScreen from './pages/NoProjectScreen';
import ProjectView from './pages/ProjectView';
import { useProjectSession } from './project/useProjectSession';

type Session = ReturnType<typeof useProjectSession>;

// A menu's Save while a dialog is up would act behind it.
const modalOpen = () => Boolean(document.querySelector('[role="dialog"]'));

export default function App() {
  const session = useProjectSession();
  const { project, dirty, projectDialog, unsavedPrompt } = session;
  // The native menu (main/index.ts's buildApplicationMenu) outlives renders: it always reaches the latest session.
  const sessionRef = useRef<Session>(session);
  useEffect(() => {
    sessionRef.current = session;
  });
  // Bumped when main reports the recent-projects list changed.
  const [recentsVersion, setRecentsVersion] = useState(0);

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
    <>
      {project ? (
        <ProjectView key={project.id} dirty={dirty} onSave={session.save} />
      ) : (
        <NoProjectScreen onNewProject={session.newProject} onOpenProject={session.openProject} onTryDemo={session.startDemo} recentsVersion={recentsVersion} />
      )}
      {projectDialog && (
        <NewProjectDialog
          mode={projectDialog}
          initialName={projectDialog === 'saveAs' ? project?.name : undefined}
          initialDescription={projectDialog === 'saveAs' ? project?.description || undefined : undefined}
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
    </>
  );
}
