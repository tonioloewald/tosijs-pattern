/*
Hydration bundle for the tosijs-pattern doc site, loaded by every page.

The `context` assignment lets a live example's `import { pattern } from 'tosijs-pattern'`
resolve to this repo's SOURCE, so the examples always run the code they document. `show` (from
'tosijs-pattern/demo') prints captioned values into the example's preview.
*/
import 'tosijs-ui'
// A bundle of our own REPLACES tosijs-ui's, and the root import leaves the doc system out
// (since tosijs-ui 1.14.0): without these, pages render with no nav and no live examples.
import 'tosijs-ui/doc-browser'
import 'tosijs-ui/live-example'
import * as pattern from '../src/index'

const asJSON = (v: unknown) => JSON.stringify(v, (_k, x) => (x === undefined ? null : x), 2) ?? String(v)

/**
 * Prints each value into the example's preview under its caption:
 * `show(preview, { 'phone.describe()': phone.describe() })`.
 *
 * A string is shown as text that WRAPS, so a long description is never cut off. Anything else
 * is shown as a JSON code block that keeps its indentation and SCROLLS instead (wrapped JSON is
 * unreadable), up to a height, then vertically too.
 */
function show(preview: HTMLElement, values: Record<string, unknown>): void {
  if (!values || typeof values !== 'object' || Array.isArray(values))
    throw new TypeError('show(preview, { caption: value, … }): give it an object of captions and values')
  for (const [caption, value] of Object.entries(values)) {
    const block = document.createElement('figure')
    block.style.cssText = 'margin: 0 0 12px; min-width: 0; max-width: 100%'
    const label = document.createElement('figcaption')
    label.textContent = caption
    label.style.cssText =
      'font: 600 12px/1.4 system-ui, sans-serif; opacity: 0.7; margin-bottom: 4px; overflow-wrap: anywhere'
    const body = document.createElement('pre')
    const frame = 'margin: 0; padding: 8px 10px; border-left: 3px solid color-mix(in srgb, currentColor 25%, transparent);'
    if (typeof value === 'string') {
      body.textContent = value
      body.style.cssText = frame + ' white-space: pre-wrap; overflow-wrap: break-word'
    } else {
      const code = document.createElement('code')
      code.className = 'language-json'
      code.textContent = asJSON(value)
      body.append(code)
      body.style.cssText = frame + ' white-space: pre; overflow: auto; max-height: 20em'
    }
    block.append(label, body)
    preview.append(block)
  }
}

for (const el of Array.from(document.querySelectorAll('tosi-doc-system'))) {
  ;(el as any).context = {
    'tosijs-pattern': pattern,
    'tosijs-pattern/demo': { show },
  }
}
