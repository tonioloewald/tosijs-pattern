/*
Doc-site configuration for tosijs-pattern, consumed by `bin/site.ts` and fed to tosijs-ui/site's
`buildSite` / `devServer` (the same setup as tosijs-timezones). The README is the home page;
`docs-src/` holds the guide pages. Every ```js fence is a LIVE example: it runs in the page,
and `import … from 'tosijs-pattern'` resolves to this repo's source through `demo/site.ts`.
*/
import { defineSiteConfig } from 'tosijs-ui/site'

const PROJECT = 'tosijs-pattern'

export default defineSiteConfig({
  name: PROJECT,
  description:
    'Matching that reads like what it means: a fluent, declarative alternative to regular expressions.',
  // UNCONFIRMED: the domain is the owner's call (see CLAUDE.md, "Open decisions").
  baseUrl: 'https://pattern.tosijs.net',
  host: 'github-pages',

  // 8787 tosijs-ui, 8788 tosijs-product, 8789 editor2, 8790 timezones, 8791 in use,
  // 8797 tjs-lang's site preview. Take one nobody uses.
  port: 8792,

  projectLinks: {
    tosijs: 'https://tosijs.net',
    github: `https://github.com/tonioloewald/${PROJECT}`,
  },
  navbarLinks: [
    { href: 'https://tosijs.net', label: 'tosijs', icon: 'tosi' },
    { href: `https://github.com/tonioloewald/${PROJECT}`, label: 'github', icon: 'github' },
    { href: `https://www.npmjs.com/package/${PROJECT}`, label: 'npmjs', icon: 'npm' },
  ],

  // Exposes this library to live examples (demo/site.ts sets the runtime context) ...
  bundleEntry: './demo/site.ts',
  // ... and this tells the build's example check about the same modules.
  checkExamples: { contextKeys: ['tosijs-pattern', 'tosijs-pattern/demo'] },

  // The README is the home page; docs-src/ the guide. 'docs' is the OUTPUT dir — never a source.
  docPaths: ['README.md', 'docs-src'],

  editableSources: true,
  emitLibrary: false,
})
