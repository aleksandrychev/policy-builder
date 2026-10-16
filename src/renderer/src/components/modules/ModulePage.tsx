import { type ReactNode, createElement, useState } from 'react';

import ArrowBackIcon from '@mui/icons-material/ArrowBack';
import { Box, Button, CircularProgress, Link, Tab, Tabs, Typography } from '@mui/material';

import { type CatalogModule, sourceUrl } from '../../modules/catalog';
import type { ReadmeNode } from '../../modules/moduleDetails';
import type { ModuleDetailsState } from '../../modules/useModuleDetails';
import type { ModuleInputResponse, ProjectModule } from '../../store/modulesSlice';
import { ModuleInputForm } from './ModuleInputForm';
import { KIND_LABELS, ModuleBadges } from './ModuleRow';

const readmeSx = {
  fontSize: 14,
  lineHeight: 1.6,
  color: 'text.primary',
  wordBreak: 'break-word',
  '& h1, & h2, & h3, & h4': { fontWeight: 700, lineHeight: 1.3, mt: 3, mb: 1 },
  '& h1': { fontSize: 22 },
  '& h2': { fontSize: 18 },
  '& h3': { fontSize: 15 },
  '& h4': { fontSize: 14 },
  '& p, & ul, & ol, & dl, & table, & pre, & blockquote, & figure': { my: 1.25 },
  '& ul, & ol': { pl: 3 },
  '& dt': { fontWeight: 700 },
  '& dd': { ml: 3 },
  '& a': { color: 'primary.main' },
  '& code': { fontFamily: 'monospace', fontSize: 12.5, bgcolor: 'background.default', px: 0.5, borderRadius: '4px' },
  '& pre': { fontFamily: 'monospace', fontSize: 12.5, bgcolor: 'background.default', p: 1.5, borderRadius: '4px', overflowX: 'auto' },
  '& pre code': { bgcolor: 'transparent', p: 0 },
  '& table': { borderCollapse: 'collapse', display: 'block', overflowX: 'auto' },
  '& th, & td': { border: '1px solid', borderColor: 'divider', px: 1, py: 0.5, textAlign: 'left', verticalAlign: 'top' },
  '& blockquote': { borderLeft: '3px solid', borderColor: 'divider', pl: 1.5, color: 'text.muted', mx: 0 },
  '& hr': { border: 0, borderTop: '1px solid', borderColor: 'divider' },
  '& img': { maxWidth: '100%', height: 'auto', verticalAlign: 'middle' }
};

function SideHeading({ children }: { children: string }) {
  return <Typography sx={{ fontSize: 12, fontWeight: 700, color: 'text.primary', mt: 2.5, mb: 0.75 }}>{children}</Typography>;
}

function Muted({ children }: { children: ReactNode }) {
  return <Typography sx={{ fontSize: 13, color: 'text.muted' }}>{children}</Typography>;
}

const external = { target: '_blank', rel: 'noreferrer' };

interface ModulePageProps {
  // Its place in the project's build order, when added.
  added?: { index: number; module: ProjectModule; total: number };
  backLabel: string;
  module: CatalogModule;
  needsInput: boolean;
  onAdd: () => void;
  onBack: () => void;
  onInputChange: (variable: string, response: ModuleInputResponse) => void;
  onOpenModule: (name: string) => void;
  onRemove: () => void;
  // The Input tab first (Edit input).
  openInput?: boolean;
  // The blocks using its promise type: it stays while they're there.
  usedBy: string[];
  web: ModuleDetailsState;
  // The dependencies adding it would bring that the project doesn't have yet.
  wouldAdd: string[];
}

// The README tree as React elements: text stays text, links open outside the app.
function renderReadme(nodes: ReadmeNode[]): ReactNode[] {
  return nodes.map((node, index) => {
    if (typeof node === 'string') return node;
    if (node.tag === 'img') return createElement('img', { key: index, src: node.src, alt: node.alt, loading: 'lazy' });
    const props = { key: index, ...(node.href ? { href: node.href, ...external } : {}) };
    return createElement(node.tag, props, ...(node.tag === 'br' || node.tag === 'hr' ? [] : renderReadme(node.children)));
  });
}

function Description({ web }: { web: ModuleDetailsState }) {
  if (web.loading)
    return (
      <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
        <CircularProgress size={14} />
        <Muted>Loading the description from build.cfengine.com…</Muted>
      </Box>
    );
  if (!web.details?.readme.length)
    return <Muted>{web.details ? 'This module has no description.' : `Can’t load the description${web.error ? ` (${web.error})` : ''}.`}</Muted>;
  return <Box sx={readmeSx}>{renderReadme(web.details.readme)}</Box>;
}

/** A module's page, as on build.cfengine.com: description, links, stats, versions and what it needs. */
export function ModulePage({
  added,
  backLabel,
  module,
  needsInput,
  onAdd,
  onBack,
  onInputChange,
  onOpenModule,
  onRemove,
  openInput,
  usedBy,
  web,
  wouldAdd
}: ModulePageProps) {
  const [tab, setTab] = useState(openInput && module.input.length > 0 ? 2 : 0);
  const details = web.details;
  const repo = module.repo?.startsWith('https://') ? module.repo.replace(/\/$/, '') : undefined;
  const source = sourceUrl(module);
  const links = [
    source && { label: 'Repository', href: source },
    repo?.startsWith('https://github.com/') && { label: 'Report issue', href: `${repo}/issues` },
    details?.documentation && { label: 'Documentation', href: details.documentation },
    details?.website && { label: 'Website', href: details.website },
    details?.discussionSearch && { label: 'Discussions', href: details.discussionSearch },
    { label: 'build.cfengine.com', href: `https://build.cfengine.com/modules/${encodeURIComponent(module.name)}/` }
  ].filter((link): link is { href: string; label: string } => Boolean(link));

  return (
    <Box sx={{ flex: 1, minWidth: 0, display: 'flex', flexDirection: 'column', bgcolor: 'background.paper', overflow: 'hidden' }}>
      <Box sx={{ display: 'flex', alignItems: 'center', px: 1, py: 0.5, borderBottom: '1px solid', borderColor: 'divider' }}>
        <Button size="small" startIcon={<ArrowBackIcon />} onClick={onBack}>
          Back to {backLabel}
        </Button>
      </Box>
      <Box sx={{ flex: 1, overflowY: 'auto' }}>
        <Box sx={{ display: 'flex', gap: 4, p: 3, maxWidth: 1200, flexWrap: 'wrap-reverse' }}>
          <Box sx={{ flex: '1 1 480px', minWidth: 0 }}>
            <Box sx={{ display: 'flex', alignItems: 'center', gap: 1.5, flexWrap: 'wrap' }}>
              <Typography component="h1" sx={{ fontSize: 24, fontWeight: 700, color: 'text.primary', wordBreak: 'break-word' }}>
                {module.name}
              </Typography>
              {module.version && <Typography sx={{ fontSize: 13, fontFamily: 'monospace', color: 'text.muted' }}>{module.version}</Typography>}
              <Box sx={{ flex: 1 }} />
              {added ? (
                !added.module.addedBy && (
                  <Button color="error" variant="outlined" size="small" onClick={onRemove} disabled={usedBy.length > 0}>
                    Remove
                  </Button>
                )
              ) : (
                <Button variant="contained" size="small" onClick={onAdd}>
                  Add to project
                </Button>
              )}
            </Box>
            <Typography sx={{ fontSize: 14, color: 'text.primary', mt: 1 }}>{module.description}</Typography>
            <Box sx={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: 0.75, mt: 1 }}>
              <Typography sx={{ fontSize: 12, color: 'text.muted' }}>{KIND_LABELS[module.kind]}</Typography>
              <ModuleBadges module={module} needsInput={Boolean(added) && needsInput} />
            </Box>
            <Box sx={{ display: 'flex', flexWrap: 'wrap', gap: 2, mt: 1.5 }}>
              {links.map(link => (
                <Link key={link.label} href={link.href} {...external} sx={{ fontSize: 13 }}>
                  {link.label} ↗
                </Link>
              ))}
            </Box>
            {added?.module.addedBy && <Muted>Added for {added.module.addedBy}: it’s removed with it, unless another module needs it.</Muted>}
            {!added && wouldAdd.length > 0 && <Muted>Adding it also adds {wouldAdd.join(', ')}.</Muted>}
            {usedBy.length > 0 && <Muted>Used by {usedBy.join(', ')}: delete those blocks to remove it.</Muted>}
            {module.kind === 'promise-type' && <Muted>Adds a promise type for your own policy. Hosts need python3 to run it.</Muted>}

            <Tabs
              value={tab}
              onChange={(_event, value: number) => setTab(value)}
              sx={{ mt: 2, borderBottom: '1px solid', borderColor: 'divider', minHeight: 36 }}
            >
              <Tab label="Description" sx={{ minHeight: 36, textTransform: 'none' }} />
              <Tab label={`Dependencies (${module.dependencies.length})`} sx={{ minHeight: 36, textTransform: 'none' }} />
              {module.input.length > 0 && <Tab label="Input" sx={{ minHeight: 36, textTransform: 'none' }} />}
            </Tabs>
            <Box sx={{ pt: 2 }}>
              {tab === 0 && <Description web={web} />}
              {tab === 1 &&
                (module.dependencies.length === 0 ? (
                  <Muted>This module has no dependencies.</Muted>
                ) : (
                  module.dependencies.map(name => (
                    <Link
                      key={name}
                      component="button"
                      onClick={() => onOpenModule(name)}
                      sx={{ display: 'block', fontSize: 13, fontFamily: 'monospace', mb: 0.5 }}
                    >
                      {name}
                    </Link>
                  ))
                ))}
              {tab === 2 && (
                <>
                  {added ? (
                    <ModuleInputForm questions={module.input} answers={added.module.input ?? {}} onChange={onInputChange} />
                  ) : (
                    <>
                      <Muted>Add the module to answer its questions:</Muted>
                      {module.input.map((question, index) => (
                        <Typography key={question.variable ?? index} sx={{ fontSize: 13, mt: 1 }}>
                          <strong>{question.label ?? question.variable}</strong>
                          {question.question && ` — ${question.question}`}
                          <Typography component="span" sx={{ fontSize: 12, color: 'text.muted' }}>
                            {' '}
                            ({question.type === 'list' ? 'a list' : 'text'})
                          </Typography>
                        </Typography>
                      ))}
                    </>
                  )}
                </>
              )}
            </Box>
          </Box>

          <Box sx={{ flex: '0 0 240px' }}>
            {details?.author && (
              <>
                <SideHeading>Maintainer</SideHeading>
                {details.author.image && (
                  <Box component="img" src={details.author.image} alt="" sx={{ width: 48, height: 48, borderRadius: '4px', display: 'block', mb: 0.75 }} />
                )}
                {details.author.url ? (
                  <Link href={details.author.url} {...external} sx={{ fontSize: 13 }}>
                    {details.author.name}
                  </Link>
                ) : (
                  <Muted>{details.author.name}</Muted>
                )}
              </>
            )}
            {(details?.downloads || details?.updated) && (
              <>
                <SideHeading>Module stats</SideHeading>
                {details.downloads && <Muted>Total downloads: {details.downloads}</Muted>}
                {details.updated && <Muted>Updated: {details.updated}</Muted>}
              </>
            )}
            {added && (
              <>
                <SideHeading>In this project</SideHeading>
                <Muted>
                  Runs before your policy, {added.index + 1} of {added.total} modules.
                </Muted>
              </>
            )}
            {details && details.versions.length > 0 && (
              <>
                <SideHeading>Versions</SideHeading>
                {details.versions.map(version => (
                  <Typography key={version.version} sx={{ fontSize: 13, color: version.latest ? 'text.primary' : 'text.muted' }}>
                    <Box component="span" sx={{ fontFamily: 'monospace' }}>
                      {version.version}
                    </Box>
                    {version.date && ` · ${version.date}`}
                    {version.latest && ' · latest'}
                  </Typography>
                ))}
              </>
            )}
            {module.tags.length > 0 && (
              <>
                <SideHeading>Tags</SideHeading>
                <Muted>{module.tags.join(', ')}</Muted>
              </>
            )}
            {module.aliases.length > 0 && (
              <>
                <SideHeading>Also known as</SideHeading>
                <Muted>{module.aliases.join(', ')}</Muted>
              </>
            )}
            {web.offline && details && <Typography sx={{ fontSize: 11, color: 'text.muted', mt: 2.5 }}>Offline: shown from the last download.</Typography>}
          </Box>
        </Box>
      </Box>
    </Box>
  );
}

/** The open module's page over the center area, or else what it shows (`children`). */
export function ModulePageOr({ children, page }: { children: ReactNode; page?: ModulePageProps }) {
  // A page per module: another one starts on its own tab.
  return page ? <ModulePage key={`${page.module.name}:${page.openInput ? 'input' : ''}`} {...page} /> : children;
}
