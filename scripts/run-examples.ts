/** Runs every ```js fence in the given markdown files the way the doc site does (stub preview). bun scripts/run-examples.ts README.md docs-src/*.md */
// Runs every ```js fence in the given markdown files the way the doc site would, with a stub preview.
import * as pattern from '../src/index.ts'
const files = process.argv.slice(2)
let n = 0, bad = 0
for (const f of files) {
  const md = await Bun.file(f).text()
  for (const m of md.matchAll(/^```js\n([\s\S]*?)^```$/gm)) {
    n++
    const out: string[] = []
    const preview = { append: (x: any) => out.push(x.textContent) }
    const show = (_p: any, ...v: any[]) => v.forEach((x) => out.push(typeof x === 'string' ? x : JSON.stringify(x)))
    const body = m[1].replace(/^import .*$/gm, '')
    try {
      new Function('preview', 'show', ...Object.keys(pattern), body)(preview, show, ...Object.values(pattern))
      console.log(`✓ ${f}#${n}: ${out.join(' | ').slice(0, 200)}`)
    } catch (e: any) { bad++; console.log(`✗ ${f}#${n}: ${e.message}`) }
  }
}
console.log(`${n} examples, ${bad} failed`)
