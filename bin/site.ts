/*
The one build entry, a thin wrapper over tosijs-ui/site (the same shape as tosijs-timezones).

  bun bin/site.ts            # build the site and the library, then start the dev server
  bun bin/site.ts --build    # build and exit (0/1)
  bun bin/site.ts --lib      # build only the library (dist/), what npm ships, and exit

`buildSite` writes the doc site to docs/ (served by GitHub Pages). `buildLibrary` writes the
npm artefacts to dist/. Everything shells out to `bun build` rather than calling Bun.build()
in-process: a long-running dev server that rebuilds in-process never gives the bundler's memory
back (see tosijs-timezones' bin/site.ts).
*/
import { $ } from 'bun'
import siteConfig from '../tosijs-pattern-site.config'
import { buildSite, devServer } from 'tosijs-ui/site'

async function buildLibrary(): Promise<void> {
  await $`rm -rf dist`.quiet()
  await $`bun build ./src/index.ts --outdir dist --target browser --format esm --sourcemap=external`.quiet()
  const types = await $`bunx tsc --project tsconfig.build.json`.nothrow().quiet()
  if (types.exitCode !== 0) {
    console.error(`tsc failed:\n${types.stdout.toString()}`)
    process.exit(1)
  }
}

const buildAll = async (): Promise<void> => {
  if (!(await buildSite(siteConfig))) throw new Error('site build failed')
  await buildLibrary()
}

if (process.argv.includes('--lib')) {
  await buildLibrary()
  process.exit(0)
}

await buildAll().catch((e) => {
  console.error(e)
  process.exit(1)
})
if (process.argv.includes('--build')) process.exit(0)
await devServer(siteConfig, { build: buildAll })
