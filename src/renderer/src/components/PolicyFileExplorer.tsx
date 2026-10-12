import { type HTMLAttributes, type ReactNode, useEffect, useRef, useState } from 'react';

import CreateNewFolderOutlinedIcon from '@mui/icons-material/CreateNewFolderOutlined';
import DeleteOutlineIcon from '@mui/icons-material/DeleteOutlineOutlined';
import DescriptionOutlinedIcon from '@mui/icons-material/DescriptionOutlined';
import EditOutlinedIcon from '@mui/icons-material/EditOutlined';
import FilterAltOutlinedIcon from '@mui/icons-material/FilterAltOutlined';
import FolderOpenOutlinedIcon from '@mui/icons-material/FolderOpenOutlined';
import FolderOutlinedIcon from '@mui/icons-material/FolderOutlined';
import NoteAddOutlinedIcon from '@mui/icons-material/NoteAddOutlined';
import { Box, IconButton, Menu, MenuItem, TextField, Tooltip, Typography } from '@mui/material';
import { SimpleTreeView, TreeItem } from '@mui/x-tree-view';

import { describeFileCondition } from '../canvas/fileCondition';
import type { BlockInstance } from '../store/canvasSlice/types';
import { type FileTreeNode, MAX_NAME_LENGTH, buildFileTree, collectFolderDescendants } from '../store/filesSlice/fileTree';
import type { PolicyFile, PolicyFolder } from '../store/filesSlice/types';
import { ConfirmDialog } from './dialogs/ConfirmDialog';

interface PolicyFileExplorerProps {
  currentFileId: string | null;
  files: PolicyFile[];
  folders: PolicyFolder[];
  instances: BlockInstance[];
  onAddFile: (name: string, parentId: string | null) => void;
  onAddFolder: (name: string, parentId: string | null) => void;
  onDeleteFile: (fileId: string) => void;
  onDeleteFolder: (folderId: string) => void;
  onMove: (kind: 'file' | 'folder', id: string, parentId: string | null) => void;
  onRenameFile: (fileId: string, name: string) => void;
  onRenameFolder: (folderId: string, name: string) => void;
  onSelectFile: (fileId: string) => void;
}

interface EditingState {
  id: string;
  kind: 'file' | 'folder';
  name: string;
}

interface DraftState {
  kind: 'file' | 'folder';
  parentId: string | null;
}

interface ContextMenuState {
  mouseX: number;
  mouseY: number;
  target: { id: string; kind: 'file' | 'folder' } | { kind: 'background' };
}

interface DeleteTarget {
  id: string;
  kind: 'file' | 'folder';
}

type DragProps = Pick<HTMLAttributes<HTMLElement>, 'draggable' | 'onDragEnd' | 'onDragOver' | 'onDragStart' | 'onDrop'>;

// The drop target meaning the project's root (null is "no target").
const ROOT_TARGET = '__root__';
const DRAG_MIME_TYPE = 'application/x-cfpb-tree-item';
// Hovering a collapsed folder this long while dragging opens it.
const EXPAND_DELAY_MS = 600;

function ancestorFolderIds(folders: PolicyFolder[], parentId: string | null): string[] {
  const ids: string[] = [];
  let current = parentId;
  while (current) {
    ids.push(current);
    current = folders.find(folder => folder.id === current)?.parentId ?? null;
  }
  return ids;
}

// Rows below are declared at module scope, not nested inside
// PolicyFileExplorer, on purpose: a component declared inside another
// component's body gets a new function identity every render, so React
// treats it as a different component type and remounts it — including its
// inline-edit TextField, which drops focus/selection on every keystroke.
// Confirmed live: typing into a nested version of this field left only the
// last character, because each keystroke's remount re-ran autoFocus +
// onFocus's select() before the next keystroke landed.
const rowSx = {
  position: 'relative' as const,
  display: 'flex',
  alignItems: 'center',
  gap: 1,
  px: 1.25,
  py: 0.75,
  borderRadius: '4px',
  '&:hover .file-row-actions, &:focus-within .file-row-actions': { opacity: 1 }
};

function RowActions({ onRename, onDelete, disabled, name }: { disabled?: boolean; name: string; onDelete: () => void; onRename: () => void }) {
  return (
    <Box
      className="file-row-actions"
      sx={{
        position: 'absolute',
        zIndex: 1,
        right: 8,
        top: '50%',
        transform: 'translateY(-50%)',
        display: 'flex',
        gap: 0.5,
        opacity: 0,
        transition: 'opacity 0.15s'
      }}
    >
      <IconButton
        size="small"
        aria-label={`Rename ${name}`}
        onClick={event => {
          event.stopPropagation();
          onRename();
        }}
        sx={{ p: 0.5, bgcolor: 'background.default', boxShadow: 1, border: '1px solid', borderColor: 'divider', '&:hover': { bgcolor: 'action.hover' } }}
      >
        <EditOutlinedIcon sx={{ fontSize: 14 }} />
      </IconButton>
      <IconButton
        size="small"
        disabled={disabled}
        aria-label={`Delete ${name}`}
        onClick={event => {
          event.stopPropagation();
          onDelete();
        }}
        sx={{ p: 0.5, bgcolor: 'background.default', boxShadow: 1, border: '1px solid', borderColor: 'divider', '&:hover': { bgcolor: 'action.hover' } }}
      >
        <DeleteOutlineIcon sx={{ fontSize: 14 }} />
      </IconButton>
    </Box>
  );
}

interface FileRowProps {
  blockCount: number;
  canDelete: boolean;
  dragProps: DragProps;
  editingName: string;
  file: PolicyFile;
  isEditing: boolean;
  onCancelRename: () => void;
  onCommitRename: () => void;
  onContextMenu: (event: React.MouseEvent) => void;
  onDeleteRequest: () => void;
  onEditingNameChange: (value: string) => void;
  onSelect: () => void;
  onStartRename: () => void;
  selected: boolean;
}

function FileRow({
  file,
  selected,
  isEditing,
  editingName,
  blockCount,
  canDelete,
  onSelect,
  onStartRename,
  onEditingNameChange,
  onCommitRename,
  onCancelRename,
  onContextMenu,
  onDeleteRequest,
  dragProps
}: FileRowProps) {
  const gate = describeFileCondition(file.condition);
  return (
    <Box
      {...dragProps}
      onClick={() => !isEditing && onSelect()}
      onDoubleClick={onStartRename}
      onContextMenu={onContextMenu}
      sx={{ ...rowSx, cursor: isEditing ? 'default' : 'pointer' }}
    >
      <DescriptionOutlinedIcon sx={{ fontSize: 16, color: 'text.muted', flexShrink: 0 }} />
      {isEditing ? (
        <Box sx={{ display: 'flex', alignItems: 'baseline', gap: 0.5, flex: 1, minWidth: 0 }}>
          <TextField
            value={editingName}
            onChange={event => onEditingNameChange(event.target.value.slice(0, MAX_NAME_LENGTH))}
            onClick={event => event.stopPropagation()}
            onFocus={event => event.target.select()}
            onBlur={onCommitRename}
            onKeyDown={event => {
              // MUI X Tree View's own keyboard type-ahead/navigation listens
              // on ancestor elements — without this, letter keystrokes typed
              // here also reach it and steal focus back mid-edit (confirmed
              // live: typing got cut off after ~3 characters).
              event.stopPropagation();
              if (event.key === 'Enter') onCommitRename();
              if (event.key === 'Escape') onCancelRename();
            }}
            autoFocus
            size="small"
            variant="standard"
            fullWidth
            slotProps={{ htmlInput: { maxLength: MAX_NAME_LENGTH } }}
            sx={{ flex: 1, minWidth: 0 }}
          />
          <Typography sx={{ fontSize: 13, color: 'text.muted', flexShrink: 0 }}>.cf</Typography>
        </Box>
      ) : (
        <Box sx={{ flex: 1, minWidth: 0 }}>
          <Tooltip title={file.description ?? ''} placement="right" enterDelay={400} slotProps={{ tooltip: { sx: { whiteSpace: 'pre-line', maxWidth: 320 } } }}>
            <Typography
              sx={{ fontSize: 13, fontWeight: selected ? 700 : 400, color: 'text.primary', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}
            >
              {file.name}.cf
            </Typography>
          </Tooltip>
          <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.5, minWidth: 0 }}>
            <Typography sx={{ fontSize: 11, color: 'text.muted', flexShrink: 0 }}>{blockCount} blocks</Typography>
            {gate && (
              <Box title={`The whole file ${gate}`} sx={{ display: 'flex', alignItems: 'center', gap: 0.25, minWidth: 0, color: 'text.muted' }}>
                <FilterAltOutlinedIcon sx={{ fontSize: 12 }} />
                <Typography sx={{ fontSize: 11, fontFamily: 'monospace', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                  {file.condition?.className}
                </Typography>
              </Box>
            )}
          </Box>
        </Box>
      )}
      {!isEditing && <RowActions name={`${file.name}.cf`} disabled={!canDelete} onRename={onStartRename} onDelete={onDeleteRequest} />}
    </Box>
  );
}

interface FolderRowProps {
  canDelete: boolean;
  dragProps: DragProps;
  dropTarget: boolean;
  editingName: string;
  expanded: boolean;
  folder: PolicyFolder;
  isEditing: boolean;
  onCancelRename: () => void;
  onCommitRename: () => void;
  onContextMenu: (event: React.MouseEvent) => void;
  onDeleteRequest: () => void;
  onEditingNameChange: (value: string) => void;
  onStartRename: () => void;
  onToggleExpanded: () => void;
}

function FolderRow({
  folder,
  isEditing,
  editingName,
  expanded,
  canDelete,
  onToggleExpanded,
  onStartRename,
  onEditingNameChange,
  onCommitRename,
  onCancelRename,
  onContextMenu,
  onDeleteRequest,
  dragProps,
  dropTarget
}: FolderRowProps) {
  return (
    <Box
      {...dragProps}
      onClick={() => !isEditing && onToggleExpanded()}
      onDoubleClick={onStartRename}
      onContextMenu={onContextMenu}
      sx={{
        ...rowSx,
        cursor: isEditing ? 'default' : 'pointer',
        ...(dropTarget && { bgcolor: 'action.selected', outline: '1px solid', outlineColor: 'primary.main' })
      }}
    >
      {expanded ? (
        <FolderOpenOutlinedIcon sx={{ fontSize: 16, color: 'text.muted', flexShrink: 0 }} />
      ) : (
        <FolderOutlinedIcon sx={{ fontSize: 16, color: 'text.muted', flexShrink: 0 }} />
      )}
      {isEditing ? (
        <TextField
          value={editingName}
          onChange={event => onEditingNameChange(event.target.value.slice(0, MAX_NAME_LENGTH))}
          onClick={event => event.stopPropagation()}
          onFocus={event => event.target.select()}
          onBlur={onCommitRename}
          onKeyDown={event => {
            // See FileRow's identical handler for why this is needed.
            event.stopPropagation();
            if (event.key === 'Enter') onCommitRename();
            if (event.key === 'Escape') onCancelRename();
          }}
          autoFocus
          size="small"
          variant="standard"
          fullWidth
          slotProps={{ htmlInput: { maxLength: MAX_NAME_LENGTH } }}
          sx={{ flex: 1, minWidth: 0 }}
        />
      ) : (
        <Typography
          sx={{
            fontSize: 13,
            fontWeight: 700,
            color: 'text.primary',
            flex: 1,
            minWidth: 0,
            whiteSpace: 'nowrap',
            overflow: 'hidden',
            textOverflow: 'ellipsis'
          }}
        >
          {folder.name}
        </Typography>
      )}
      {!isEditing && <RowActions name={folder.name} disabled={!canDelete} onRename={onStartRename} onDelete={onDeleteRequest} />}
    </Box>
  );
}

interface DraftRowProps {
  kind: 'file' | 'folder';
  name: string;
  onCancel: () => void;
  onCommit: () => void;
  onNameChange: (value: string) => void;
}

function DraftRow({ kind, name, onNameChange, onCommit, onCancel }: DraftRowProps) {
  return (
    <Box sx={{ ...rowSx, cursor: 'default' }}>
      {kind === 'file' ? (
        <DescriptionOutlinedIcon sx={{ fontSize: 16, color: 'text.muted', flexShrink: 0 }} />
      ) : (
        <FolderOutlinedIcon sx={{ fontSize: 16, color: 'text.muted', flexShrink: 0 }} />
      )}
      <Box sx={{ display: 'flex', alignItems: 'baseline', gap: 0.5, flex: 1, minWidth: 0 }}>
        <TextField
          value={name}
          onChange={event => onNameChange(event.target.value.slice(0, MAX_NAME_LENGTH))}
          onFocus={event => event.target.select()}
          onBlur={onCommit}
          onKeyDown={event => {
            // See FileRow's identical handler for why this is needed.
            event.stopPropagation();
            if (event.key === 'Enter') onCommit();
            if (event.key === 'Escape') onCancel();
          }}
          autoFocus
          size="small"
          variant="standard"
          fullWidth
          slotProps={{ htmlInput: { maxLength: MAX_NAME_LENGTH } }}
          sx={{ flex: 1, minWidth: 0 }}
        />
        {kind === 'file' && <Typography sx={{ fontSize: 13, color: 'text.muted', flexShrink: 0 }}>.cf</Typography>}
      </Box>
    </Box>
  );
}

/**
 * A project can hold multiple independent policy files, organized into
 * folders, each file its own block canvas/bundle chain and its own
 * namespace (see architecture-plan.md's Namespaces section). Folders are
 * purely organizational — see PolicyFile.parentId.
 */
export function PolicyFileExplorer({
  files,
  folders,
  currentFileId,
  instances,
  onSelectFile,
  onAddFile,
  onAddFolder,
  onRenameFile,
  onRenameFolder,
  onDeleteFile,
  onDeleteFolder,
  onMove
}: PolicyFileExplorerProps) {
  const [expandedItems, setExpandedItems] = useState<string[]>([]);
  const [editing, setEditing] = useState<EditingState | null>(null);
  const [editingName, setEditingName] = useState('');
  const [draft, setDraft] = useState<DraftState | null>(null);
  const [draftName, setDraftName] = useState('');
  const [contextMenu, setContextMenu] = useState<ContextMenuState | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<DeleteTarget | null>(null);
  const [dragging, setDragging] = useState<DeleteTarget | null>(null);
  const [dropTarget, setDropTarget] = useState<string | null>(null);
  const expandTimer = useRef<{ folderId: string; timer: ReturnType<typeof setTimeout> } | null>(null);

  // Keeps the current file's folder visible after switching files (e.g.
  // loading a project, or a cross-file jump) — same idea as an editor's
  // "reveal in explorer".
  useEffect(() => {
    if (!currentFileId) return;
    const parentId = files.find(file => file.id === currentFileId)?.parentId ?? null;
    const ancestors = ancestorFolderIds(folders, parentId);
    if (ancestors.length === 0) return;
    const frame = requestAnimationFrame(() => {
      setExpandedItems(current => [...new Set([...current, ...ancestors])]);
    });
    return () => cancelAnimationFrame(frame);
    // Only when the selected file changes, not on every files/folders edit.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [currentFileId]);

  // A file selected from elsewhere (an AI agent, a cross-file jump) is scrolled to, and takes over
  // the tree's keyboard focus if the tree had it: otherwise the last-clicked file stays highlighted.
  const listRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const frame = requestAnimationFrame(() => {
      const item = listRef.current?.querySelector('[data-selected]')?.closest<HTMLElement>('[role="treeitem"]');
      if (!item) return;
      item.scrollIntoView?.({ block: 'nearest' }); // jsdom has none
      if (listRef.current?.contains(document.activeElement) && document.activeElement !== item) item.focus({ preventScroll: true });
    });
    return () => cancelAnimationFrame(frame);
  }, [currentFileId]);

  const blockCountFor = (fileId: string) => instances.filter(instance => instance.fileId === fileId).length;

  const startRename = (kind: 'file' | 'folder', id: string, name: string) => {
    setEditing({ kind, id, name });
    setEditingName(name);
  };

  const commitRename = () => {
    if (!editing) return;
    const trimmed = editingName.trim().slice(0, MAX_NAME_LENGTH);
    if (trimmed) {
      if (editing.kind === 'file') onRenameFile(editing.id, trimmed);
      else onRenameFolder(editing.id, trimmed);
    }
    setEditing(null);
  };

  const startCreate = (kind: 'file' | 'folder', parentId: string | null) => {
    setContextMenu(null);
    if (parentId) setExpandedItems(current => (current.includes(parentId) ? current : [...current, parentId]));
    setDraft({ kind, parentId });
    setDraftName(kind === 'file' ? 'New file' : 'New folder');
  };

  const commitCreate = () => {
    if (!draft) return;
    const trimmed = draftName.trim().slice(0, MAX_NAME_LENGTH);
    if (trimmed) {
      if (draft.kind === 'file') onAddFile(trimmed, draft.parentId);
      else onAddFolder(trimmed, draft.parentId);
    }
    setDraft(null);
  };

  const canDeleteFile = files.length > 1;
  const canDeleteFolder = (folderId: string) => {
    const { fileIds } = collectFolderDescendants(files, folders, folderId);
    return files.length - fileIds.length > 0;
  };
  const canDeleteTarget = (target: DeleteTarget) => (target.kind === 'file' ? canDeleteFile : canDeleteFolder(target.id));

  const deleteMessage = () => {
    if (!deleteTarget) return '';
    if (deleteTarget.kind === 'file') {
      const file = files.find(item => item.id === deleteTarget.id);
      return `"${file?.name}.cf" and its ${blockCountFor(deleteTarget.id)} block(s) will be removed. You can undo this with ⌘Z / Ctrl+Z.`;
    }
    const folder = folders.find(item => item.id === deleteTarget.id);
    const { fileIds } = collectFolderDescendants(files, folders, deleteTarget.id);
    const totalBlocks = fileIds.reduce((sum, fileId) => sum + blockCountFor(fileId), 0);
    return `"${folder?.name}" and its ${fileIds.length} file(s) (${totalBlocks} total block(s)) will be removed. You can undo this with ⌘Z / Ctrl+Z.`;
  };

  const confirmDelete = () => {
    if (!deleteTarget) return;
    if (deleteTarget.kind === 'file') onDeleteFile(deleteTarget.id);
    else onDeleteFolder(deleteTarget.id);
    setDeleteTarget(null);
  };

  const cancelExpandTimer = () => {
    if (expandTimer.current) clearTimeout(expandTimer.current.timer);
    expandTimer.current = null;
  };

  const endDrag = () => {
    cancelExpandTimer();
    setDragging(null);
    setDropTarget(null);
  };

  // A file can't land where it already is; a folder neither, nor inside itself.
  const canDropInto = (parentId: string | null) => {
    if (!dragging) return false;
    if (dragging.kind === 'file') return files.find(file => file.id === dragging.id)?.parentId !== parentId;
    if (folders.find(folder => folder.id === dragging.id)?.parentId === parentId) return false;
    return parentId !== dragging.id && !ancestorFolderIds(folders, parentId).includes(dragging.id);
  };

  // Hovering a folder opens it after a moment, so a drag can reach its nested folders.
  const scheduleExpand = (folderId: string) => {
    if (expandTimer.current?.folderId === folderId) return;
    cancelExpandTimer();
    if (expandedItems.includes(folderId)) return;
    expandTimer.current = {
      folderId,
      timer: setTimeout(() => setExpandedItems(current => (current.includes(folderId) ? current : [...current, folderId])), EXPAND_DELAY_MS)
    };
  };

  // `item` is what the row drags; `parentId` is where a drop on the row moves things.
  const dragPropsFor = (item: DeleteTarget, parentId: string | null, isEditing: boolean): DragProps => ({
    draggable: !isEditing,
    onDragStart: event => {
      event.stopPropagation();
      event.dataTransfer.setData(DRAG_MIME_TYPE, item.id);
      event.dataTransfer.effectAllowed = 'move';
      setDragging(item);
    },
    onDragEnd: endDrag,
    onDragOver: event => {
      if (!dragging) return;
      event.stopPropagation();
      if (item.kind === 'folder' && item.id !== dragging.id) scheduleExpand(item.id);
      else cancelExpandTimer();
      if (!canDropInto(parentId)) {
        event.dataTransfer.dropEffect = 'none';
        setDropTarget(null);
        return;
      }
      event.preventDefault();
      event.dataTransfer.dropEffect = 'move';
      setDropTarget(parentId ?? ROOT_TARGET);
    },
    onDrop: event => {
      event.preventDefault();
      event.stopPropagation();
      if (dragging && canDropInto(parentId)) {
        onMove(dragging.kind, dragging.id, parentId);
        if (parentId) setExpandedItems(current => [...new Set([...current, ...ancestorFolderIds(folders, parentId)])]);
      }
      endDrag();
    }
  });

  function renderChildren(parentId: string | null, nodes: FileTreeNode[]): ReactNode {
    return (
      <>
        {draft && draft.parentId === parentId && (
          <TreeItem
            itemId={`__draft_${draft.kind}__`}
            label={<DraftRow kind={draft.kind} name={draftName} onNameChange={setDraftName} onCommit={commitCreate} onCancel={() => setDraft(null)} />}
            disableSelection
          />
        )}
        {nodes.map(node => {
          if (node.kind === 'folder') {
            const folder = folders.find(item => item.id === node.id)!;
            const isEditing = editing?.kind === 'folder' && editing.id === folder.id;
            return (
              <TreeItem
                key={node.id}
                itemId={node.id}
                disableSelection
                label={
                  <FolderRow
                    folder={folder}
                    isEditing={isEditing}
                    editingName={editingName}
                    expanded={expandedItems.includes(folder.id)}
                    canDelete={canDeleteFolder(folder.id)}
                    onToggleExpanded={() =>
                      setExpandedItems(current => (current.includes(folder.id) ? current.filter(id => id !== folder.id) : [...current, folder.id]))
                    }
                    onStartRename={() => startRename('folder', folder.id, folder.name)}
                    onEditingNameChange={setEditingName}
                    onCommitRename={commitRename}
                    onCancelRename={() => setEditing(null)}
                    onContextMenu={event => {
                      event.preventDefault();
                      event.stopPropagation();
                      setContextMenu({ mouseX: event.clientX, mouseY: event.clientY, target: { kind: 'folder', id: folder.id } });
                    }}
                    onDeleteRequest={() => setDeleteTarget({ kind: 'folder', id: folder.id })}
                    dragProps={dragPropsFor({ kind: 'folder', id: folder.id }, folder.id, isEditing)}
                    dropTarget={dropTarget === folder.id}
                  />
                }
              >
                {renderChildren(node.id, node.children)}
              </TreeItem>
            );
          }

          const file = node.file;
          const isEditing = editing?.kind === 'file' && editing.id === file.id;
          return (
            <TreeItem
              key={node.id}
              itemId={node.id}
              disableSelection
              label={
                <FileRow
                  file={file}
                  selected={file.id === currentFileId}
                  isEditing={isEditing}
                  editingName={editingName}
                  blockCount={blockCountFor(file.id)}
                  canDelete={canDeleteFile}
                  onSelect={() => onSelectFile(file.id)}
                  onStartRename={() => startRename('file', file.id, file.name)}
                  onEditingNameChange={setEditingName}
                  onCommitRename={commitRename}
                  onCancelRename={() => setEditing(null)}
                  onContextMenu={event => {
                    event.preventDefault();
                    event.stopPropagation();
                    setContextMenu({ mouseX: event.clientX, mouseY: event.clientY, target: { kind: 'file', id: file.id } });
                  }}
                  onDeleteRequest={() => setDeleteTarget({ kind: 'file', id: file.id })}
                  dragProps={dragPropsFor({ kind: 'file', id: file.id }, file.parentId, isEditing)}
                />
              }
            />
          );
        })}
      </>
    );
  }

  const tree = buildFileTree(files, folders);

  return (
    <Box
      sx={{ display: 'flex', flexDirection: 'column', height: '100%', overflow: 'hidden' }}
      onContextMenu={event => {
        // Only the empty background reaches here — row handlers stop propagation.
        event.preventDefault();
        setContextMenu({ mouseX: event.clientX, mouseY: event.clientY, target: { kind: 'background' } });
      }}
    >
      <Box sx={{ px: 2, pt: 1.5, pb: 1, display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 0.5 }}>
        <Typography sx={{ fontSize: 16, fontWeight: 700, color: 'text.primary' }}>Configurations</Typography>
        <Box sx={{ display: 'flex', gap: 0.5 }}>
          <IconButton size="small" title="New file" onClick={() => startCreate('file', null)} sx={{ p: 0.5 }}>
            <NoteAddOutlinedIcon sx={{ fontSize: 18 }} />
          </IconButton>
          <IconButton size="small" title="New folder" onClick={() => startCreate('folder', null)} sx={{ p: 0.5 }}>
            <CreateNewFolderOutlinedIcon sx={{ fontSize: 18 }} />
          </IconButton>
        </Box>
      </Box>

      <Box
        ref={listRef}
        // Only the empty background reaches here — rows stop propagation. It moves things to the root.
        onDragOver={event => {
          if (!dragging) return;
          cancelExpandTimer();
          if (!canDropInto(null)) {
            setDropTarget(null);
            return;
          }
          event.preventDefault();
          event.dataTransfer.dropEffect = 'move';
          setDropTarget(ROOT_TARGET);
        }}
        onDrop={event => {
          event.preventDefault();
          if (dragging && canDropInto(null)) onMove(dragging.kind, dragging.id, null);
          endDrag();
        }}
        sx={{
          flex: 1,
          overflowY: 'auto',
          px: 1,
          borderRadius: '4px',
          ...(dropTarget === ROOT_TARGET && { outline: '1px solid', outlineColor: 'primary.main', outlineOffset: -1 })
        }}
      >
        <SimpleTreeView
          expandedItems={expandedItems}
          onExpandedItemsChange={(_event, itemIds) => setExpandedItems(itemIds)}
          selectedItems={currentFileId}
          // The rows carry their own 6px; the tree item's padding would double it.
          sx={{ '& .MuiTreeItem-content': { py: 0 } }}
        >
          {renderChildren(null, tree)}
        </SimpleTreeView>
      </Box>

      <Menu
        open={contextMenu !== null}
        onClose={() => setContextMenu(null)}
        anchorReference="anchorPosition"
        anchorPosition={contextMenu ? { top: contextMenu.mouseY, left: contextMenu.mouseX } : undefined}
      >
        {contextMenu?.target.kind === 'folder' && [
          <MenuItem key="new-file" onClick={() => startCreate('file', contextMenu.target.kind === 'folder' ? contextMenu.target.id : null)}>
            New File
          </MenuItem>,
          <MenuItem key="new-folder" onClick={() => startCreate('folder', contextMenu.target.kind === 'folder' ? contextMenu.target.id : null)}>
            New Folder
          </MenuItem>
        ]}
        {contextMenu?.target.kind === 'background' && [
          <MenuItem key="new-file" onClick={() => startCreate('file', null)}>
            New File
          </MenuItem>,
          <MenuItem key="new-folder" onClick={() => startCreate('folder', null)}>
            New Folder
          </MenuItem>
        ]}
        {(contextMenu?.target.kind === 'file' || contextMenu?.target.kind === 'folder') && [
          <MenuItem
            key="rename"
            onClick={() => {
              const target = contextMenu.target as { id: string; kind: 'file' | 'folder' };
              const name = target.kind === 'file' ? files.find(file => file.id === target.id)?.name : folders.find(folder => folder.id === target.id)?.name;
              if (name !== undefined) startRename(target.kind, target.id, name);
              setContextMenu(null);
            }}
          >
            Rename
          </MenuItem>,
          <MenuItem
            key="delete"
            disabled={!canDeleteTarget(contextMenu.target as DeleteTarget)}
            onClick={() => {
              const target = contextMenu.target as { id: string; kind: 'file' | 'folder' };
              setDeleteTarget({ kind: target.kind, id: target.id });
              setContextMenu(null);
            }}
          >
            Delete
          </MenuItem>
        ]}
      </Menu>

      <ConfirmDialog
        open={deleteTarget !== null}
        title={deleteTarget?.kind === 'folder' ? 'Delete folder' : 'Delete policy file'}
        message={deleteMessage()}
        onCancel={() => setDeleteTarget(null)}
        onConfirm={confirmDelete}
      />
    </Box>
  );
}
