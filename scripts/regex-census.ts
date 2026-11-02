/**
 * Regex census: every distinct regex literal in a tree of JavaScript, classified by how it is
 * USED (its parent call) and which FEATURES it needs. Read-only.
 *
 *   bun scripts/regex-census.ts [dir]     (default: node_modules)
 *
 * The feature checks are approximate (they read the pattern source with simple tests; "anchor ^"
 * also counts the ^ in [^...]). The translator should replace them with its own parse, and report
 * what translates and what is refused, with reasons.
 */
// Read-only census: every regex literal in node_modules JS, one copy per package+version,
// classified by how it is USED (parent call) and which FEATURES it needs.
import { parse } from 'acorn'
import * as walk from 'acorn-walk'
import { readdirSync, readFileSync, statSync } from 'fs'
import { join } from 'path'
const root = process.argv[2] ?? "node_modules" // any directory of JavaScript
const files: string[] = []
const seen = new Set<string>()
const visit = (d: string, depth = 0) => {
  if (depth > 6) return
  let es: string[] = []
  try { es = readdirSync(d) } catch { return }
  for (const e of es) {
    const p = join(d, e)
    let st; try { st = statSync(p) } catch { continue }
    if (st.isDirectory()) { if (e === 'test' || e === 'tests' || e === '__tests__' || e === 'typescript') continue; visit(p, depth + 1) }
    else if (/\.(m?js|cjs)$/.test(e) && !/\.min\.js$/.test(e) && st.size < 400_000) files.push(p)
  }
}
visit(root)
const use: Record<string, number> = {}
const feat: Record<string, number> = {}
const shape: Record<string, number> = {}
let total = 0
const uniq = new Set<string>()
const bump = (o: Record<string, number>, k: string) => (o[k] = (o[k] ?? 0) + 1)
for (const f of files) {
  let src = ''; try { src = readFileSync(f, 'utf8') } catch { continue }
  let ast: any
  try { ast = parse(src, { ecmaVersion: 'latest', sourceType: 'module', allowHashBang: true, allowReturnOutsideFunction: true }) } catch {
    try { ast = parse(src, { ecmaVersion: 'latest', sourceType: 'script', allowHashBang: true, allowReturnOutsideFunction: true }) } catch { continue } }
  walk.ancestor(ast, {
    Literal(n: any, anc: any[]) {
      if (!n.regex) return
      const key = n.regex.pattern + '/' + n.regex.flags
      if (uniq.has(key)) return
      uniq.add(key); total++
      const p = n.regex.pattern
      const parent = anc[anc.length - 2]
      let u = 'other'
      if (parent?.type === 'MemberExpression' && parent.object === n) u = 're.' + (parent.property?.name ?? '?')
      else if (parent?.type === 'CallExpression' && parent.arguments.includes(n) && parent.callee?.type === 'MemberExpression') u = 'str.' + (parent.callee.property?.name ?? '?') + '(re)'
      else if (parent?.type === 'VariableDeclarator' || parent?.type === 'Property' || parent?.type === 'AssignmentExpression') u = 'stored'
      bump(use, u)
      const F: [string, RegExp][] = [
        ['anchor ^', /^\^|[^\\]\^/], ['anchor $', /\$$/], ['char class []', /\[/], ['negated class [^', /\[\^/],
        ['\\d \\w \\s', /\\[dwsDWS]/], ['any .', /(^|[^\\])\./], ['* + ?', /[*+?]/], ['{n,m}', /\{\d/], ['alternation |', /\|/],
        ['capture ()', /\((?!\?)/], ['non-capture (?:', /\(\?:/], ['named group', /\(\?</], ['lookahead', /\(\?[=!]/], ['lookbehind', /\(\?<[=!]/],
        ['backreference', /\\[1-9]|\\k</], ['lazy *? +?', /[*+]\?/], ['unicode \\p', /\\p\{/],
      ]
      for (const [k, re] of F) if (re.test(p)) bump(feat, k)
      for (const fl of n.regex.flags) bump(feat, 'flag ' + fl)
      // shape: is it expressible without a regex engine?
      const literal = !/[\\^$.|?*+()[\]{}]/.test(p.replace(/\\[\\/.\-]/g, ''))
      const alts = /^\^?\(?(?:\?:)?[\w\- ]+(\|[\w\- ]+)+\)?\$?$/.test(p)
      const charRun = /^\^?\[\^?[^\]]+\][*+]?\$?$/.test(p) || /^\^?\\[sdw][*+]\$?$/.test(p)
      const trim = /^\^\\s\+\|\\s\+\$$/.test(p) || /^\\s\+\$|^\^\\s\+$/.test(p)
      bump(shape, literal ? 'plain literal string' : alts ? 'alternation of literals' : charRun ? 'one char class (run)' : trim ? 'trim-like whitespace' : 'other')
    },
  })
}
const show = (t: string, o: Record<string, number>, n = 20) => {
  console.log(`\n${t}`)
  for (const [k, v] of Object.entries(o).sort((a, b) => b[1] - a[1]).slice(0, n)) console.log(`  ${k.padEnd(26)} ${String(v).padStart(6)}  ${(100 * v / total).toFixed(1)}%`)
}
console.log(`${files.length} files, ${total} distinct regex literals`)
show('USE (how the literal is consumed)', use)
show('FEATURES (share of regexes using each)', feat, 30)
show('SHAPE (could a simple non-regex primitive do it?)', shape)
