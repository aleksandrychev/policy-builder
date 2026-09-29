import { useEffect, useRef } from 'react';

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

  useEffect(
    () =>
      window.api?.onMenuAction(action => {
        const current = sessionRef.current;
        if (action === 'new-project') current.newProject();
        else if (action === 'try-demo') current.startDemo();
        else if (action === 'save' && !modalOpen()) current.save();
        else if (action === 'close-requested') current.requestClose();
        // 'open-project' has no renderer behavior yet — mirrors the
        // still-inert "Open Project…" button on NoProjectScreen.
      }),
    []
  );

  useEffect(() => {
    window.api?.setDocument({ edited: dirty, title: project?.name ?? null }).catch(() => {});
  }, [dirty, project?.name]);

  return (
    <>
      {project ? (
        <ProjectView key={project.id} dirty={dirty} onSave={session.save} />
      ) : (
        <NoProjectScreen onNewProject={session.newProject} onTryDemo={session.startDemo} />
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
      <Snackbar open={Boolean(session.saveError)} onClose={session.dismissSaveError} anchorOrigin={{ vertical: 'bottom', horizontal: 'center' }}>
        <Alert severity="error" onClose={session.dismissSaveError}>
          {session.saveError}
        </Alert>
      </Snackbar>
    </>
  );
}
