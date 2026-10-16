import { githubImage, parseDetails, readmeTree } from './moduleDetails';

describe('module details', () => {
  it('keeps plain markup only: no scripts, attributes or unsafe links', () => {
    const tree = readmeTree(
      '<h2 id="x" onclick="alert(1)">Use</h2><script>alert(1)</script><p class="y">See <a href="javascript:alert(1)">this</a> and <a href="docs.md">docs</a><style>p{}</style></p><custom-tag>kept text</custom-tag>',
      'https://github.com/o/r/blob/abc/'
    );
    expect(tree).toEqual([
      { tag: 'h2', children: ['Use'] },
      { tag: 'p', children: ['See ', 'this', ' and ', { tag: 'a', href: 'https://github.com/o/r/blob/abc/docs.md', children: ['docs'] }] },
      'kept text'
    ]);
  });

  it('shows GitHub images (a blob page as its raw file), links others', () => {
    expect(githubImage('https://github.com/o/r/blob/abc/shot.png')).toBe('https://raw.githubusercontent.com/o/r/abc/shot.png');
    expect(githubImage('https://avatars.githubusercontent.com/u/1')).toBe('https://avatars.githubusercontent.com/u/1');
    expect(githubImage('https://example.com/a.png')).toBeUndefined();
    expect(readmeTree('<img src="shot.png" alt="Shot"><img src="https://example.com/a.png" alt="A">', 'https://github.com/o/r/blob/abc/')).toEqual([
      { tag: 'img', src: 'https://raw.githubusercontent.com/o/r/abc/shot.png', alt: 'Shot', children: [] },
      { tag: 'a', href: 'https://example.com/a.png', children: ['🖼 A'] }
    ]);
  });

  it('reads the website data: "None" links are none, versions newest first', () => {
    const details = parseDetails({
      author: { name: 'Nick', url: 'https://github.com/nick', image: 'https://avatars.githubusercontent.com/u/2' },
      downloads: 89,
      documentation: 'None',
      versions: { '1.0.0': { date: 'Dec 21, 2022', latest: false }, '2.0.0': { date: 'Jun 30, 2023', latest: true } },
      readme: '<p>Hi</p>'
    });
    expect(details).toMatchObject({ downloads: '89', documentation: undefined, readme: [{ tag: 'p', children: ['Hi'] }] });
    expect(details.author).toEqual({ name: 'Nick', url: 'https://github.com/nick', image: 'https://avatars.githubusercontent.com/u/2' });
    expect(details.versions.map(version => version.version)).toEqual(['2.0.0', '1.0.0']);
  });
});
