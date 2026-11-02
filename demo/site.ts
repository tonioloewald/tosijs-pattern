/*
Hydration bundle for the tosijs-pattern doc site, loaded by every page.

The `context` assignment lets a live example's `import { oneOrMore, digit } from 'tosijs-pattern'`
resolve to this repo's SOURCE, so the examples always run the code they document. `show` (from
'tosijs-pattern/demo') prints values into the example's preview, one block each.
*/
import 'tosijs-ui'
// A bundle of our own REPLACES tosijs-ui's, and the root import leaves the doc system out
// (since tosijs-ui 1.14.0): without these, pages render with no nav and no live examples.
import 'tosijs-ui/doc-browser'
import 'tosijs-ui/live-example'
import * as pattern from '../src/index'

function show(preview: HTMLElement, ...values: unknown[]): void {
  for (const v of values) {
    const pre = document.createElement('pre')
    pre.textContent =
      typeof v === 'string' ? v : JSON.stringify(v, (_k, x) => (x === undefined ? null : x), 2)
    preview.append(pre)
  }
}

for (const el of Array.from(document.querySelectorAll('tosi-doc-system'))) {
  ;(el as any).context = {
    'tosijs-pattern': pattern,
    'tosijs-pattern/demo': { show },
  }
}
