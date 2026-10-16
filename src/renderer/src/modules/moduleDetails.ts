// A module's details as build.cfengine.com has them (its js/modules.json, what Mission Portal shows).

export interface ModuleVersion {
  date?: string;
  latest: boolean;
  version: string;
}

export interface ModuleWebDetails {
  author?: { image?: string; name: string; url?: string };
  discussion?: string;
  discussionSearch?: string;
  documentation?: string;
  downloads?: string;
  // The README, as a tree of allowlisted tags and text: rendered as React elements, never as HTML.
  readme: ReadmeNode[];
  updated?: string;
  versions: ModuleVersion[];
  website?: string;
}

const isRecord = (value: unknown): value is Record<string, unknown> => typeof value === 'object' && value !== null && !Array.isArray(value);
// The data writes a missing link as "None".
const text = (value: unknown) => (typeof value === 'string' && value !== '' && value !== 'None' ? value : undefined);
const webUrl = (value: unknown) => {
  const url = text(value);
  return url && /^https?:\/\//.test(url) ? url : undefined;
};

const avatar = (value: unknown) => {
  const url = webUrl(value);
  return url ? githubImage(url) : undefined;
};

export function parseDetails(details: Record<string, unknown>, base?: string): ModuleWebDetails {
  const author = isRecord(details.author) ? details.author : undefined;
  const versions = isRecord(details.versions) ? details.versions : {};
  return {
    author: author && text(author.name) ? { name: text(author.name)!, url: webUrl(author.url), image: avatar(author.image) } : undefined,
    discussion: webUrl(details.discussion),
    discussionSearch: webUrl(details.discussionSearch),
    documentation: webUrl(details.documentation),
    downloads: typeof details.downloads === 'number' ? String(details.downloads) : text(details.downloads),
    readme: readmeTree(text(details.readme) ?? '', base),
    updated: text(details.updated),
    versions: Object.entries(versions)
      .map(([version, info]) => ({ version, date: isRecord(info) ? text(info.date) : undefined, latest: isRecord(info) && info.latest === true }))
      .reverse(),
    website: webUrl(details.website)
  };
}

/** A README element: an allowlisted tag (links with their http(s) target) and its content. */
export interface ReadmeElement {
  alt?: string;
  children: ReadmeNode[];
  href?: string;
  // An image's source: only from GitHub, the hosts the app's content policy allows.
  src?: string;
  tag: string;
}
export type ReadmeNode = ReadmeElement | string;

// What a README keeps; anything else is replaced by its content, and these go with theirs.
export const README_TAGS = new Set(
  'a b blockquote br code dd div dl dt em figcaption figure h1 h2 h3 h4 h5 h6 hr i li ol p pre span strong table tbody td th thead tr ul'.split(' ')
);
const DROPPED = new Set([
  'script',
  'style',
  'iframe',
  'object',
  'embed',
  'form',
  'input',
  'button',
  'textarea',
  'select',
  'svg',
  'math',
  'template',
  'link',
  'meta'
]);

function absolute(href: string, base?: string): string | undefined {
  try {
    const url = new URL(href, base);
    return url.protocol === 'https:' || url.protocol === 'http:' ? url.href : undefined;
  } catch {
    return undefined;
  }
}

// The image hosts the app's content policy allows (index.html's img-src): GitHub's.
const IMAGE_HOSTS = /^(github\.com|raw\.github\.com|[a-z0-9-]+\.githubusercontent\.com)$/;

/** An image URL the app may load: GitHub's, a file shown in a repository (blob/) as its raw file. */
export function githubImage(url: string): string | undefined {
  const parsed = new URL(url);
  if (parsed.protocol !== 'https:' || !IMAGE_HOSTS.test(parsed.hostname)) return undefined;
  const blob = /^\/([^/]+)\/([^/]+)\/blob\/(.+)$/.exec(parsed.pathname);
  return parsed.hostname === 'github.com' && blob ? `https://raw.githubusercontent.com/${blob[1]}/${blob[2]}/${blob[3]}` : parsed.href;
}

function fromElement(element: Element, base: string | undefined): ReadmeNode[] {
  const tag = element.tagName.toLowerCase();
  if (DROPPED.has(tag)) return [];
  if (tag === 'img') {
    const src = absolute(element.getAttribute('src') ?? '', base);
    const label = element.getAttribute('alt') || element.getAttribute('title') || 'Image';
    const image = src && githubImage(src);
    if (image) return [{ tag: 'img', src: image, alt: label, children: [] }];
    // Elsewhere: the picture becomes a link to it.
    return src ? [{ tag: 'a', href: src, children: [`🖼 ${label}`] }] : [label];
  }
  const children = [...element.childNodes].flatMap(child => fromNode(child, base));
  if (!README_TAGS.has(tag)) return children;
  if (tag !== 'a') return [{ tag, children }];
  const href = absolute(element.getAttribute('href') ?? '', base);
  return href ? [{ tag, href, children }] : children;
}

function fromNode(node: Node, base: string | undefined): ReadmeNode[] {
  if (node.nodeType === Node.TEXT_NODE) return [node.textContent ?? ''];
  if (node.nodeType === Node.ELEMENT_NODE) return fromElement(node as Element, base);
  return [];
}

/**
 * A README's HTML as plain data: allowlisted tags without attributes (no classes, styles or
 * handlers), links absolute (http/https only); the rest unwrapped, or dropped with its content.
 * Parsing doesn't run anything. `base`: where relative links point (the module's repository folder).
 */
export function readmeTree(html: string, base?: string): ReadmeNode[] {
  const parsed = new DOMParser().parseFromString(html, 'text/html');
  return [...parsed.body.childNodes].flatMap(node => fromNode(node, base));
}
