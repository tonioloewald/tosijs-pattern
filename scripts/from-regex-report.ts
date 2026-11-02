/**
 * What share of real regexes `fromRegex()` translates, why the rest are refused, and whether
 * every translation AGREES with its regex on generated inputs. Read-only over the corpus.
 *
 *   bun scripts/from-regex-report.ts <dir>… [--json out.json] [--examples n]
 *
 * Every distinct regex literal (source + flags) in the .js/.mjs/.cjs/.ts files under each dir
 * is read (TypeScript is stripped with Bun's transpiler first). Each is translated, or refused
 * with a code; each translation is run against its regex (scripts/regex-diff.ts). A translation
 * that DISAGREES is a translator bug, and the report lists every one.
 */
import { parse } from 'acorn'
import * as walk from 'acorn-walk'
import { readdirSync, readFileSync, lstatSync } from 'fs'
import { join } from 'path'
import { fromRegex, RegexRefusal } from '../src/index'
import { differential, inputsFor } from './regex-diff'

const args = process.argv.slice(2)
const flagValue = (name: string) => {
  const i = args.indexOf(name)
  return i >= 0 ? args.splice(i, 2)[1] : undefined
}
const jsonOut = flagValue('--json')
const exampleCount = Number(flagValue('--examples') ?? 3)
const dirs = args.length ? args : ['node_modules']

const SKIP_DIRS = new Set(['test', 'tests', '__tests__', 'typescript', '.git', 'dist', 'docs'])
function filesUnder(dir: string, depth = 0, out: string[] = []): string[] {
  if (depth > 8) return out
  let entries: string[] = []
  try {
    entries = readdirSync(dir)
  } catch {
    return out
  }
  for (const e of entries) {
    const p = join(dir, e)
    let st
    try {
      st = lstatSync(p) // not following symlinks: node_modules links back into itself
    } catch {
      continue
    }
    if (st.isDirectory()) {
      if (!SKIP_DIRS.has(e)) filesUnder(p, depth + 1, out)
    } else if (/\.(m?js|cjs|ts|mts)$/.test(e) && !/\.(min\.js|d\.ts)$/.test(e) && st.size < 400_000) out.push(p)
  }
  return out
}

const ts = new Bun.Transpiler({ loader: 'ts' })
function regexLiterals(file: string): { source: string; flags: string }[] {
  let src: string
  try {
    src = readFileSync(file, 'utf8')
  } catch {
    return []
  }
  if (/\.m?ts$/.test(file)) {
    try {
      src = ts.transformSync(src)
    } catch {
      return []
    }
  }
  let ast: any
  for (const sourceType of ['module', 'script'] as const) {
    try {
      ast = parse(src, { ecmaVersion: 'latest', sourceType, allowHashBang: true, allowReturnOutsideFunction: true })
      break
    } catch {}
  }
  if (!ast) return []
  const out: { source: string; flags: string }[] = []
  walk.simple(ast, {
    Literal(n: any) {
      if (n.regex) out.push({ source: n.regex.pattern, flags: n.regex.flags })
    },
  })
  return out
}

interface Row {
  source: string
  flags: string
  outcome: 'agrees' | 'DISAGREES' | 'refused' | 'host-invalid'
  code?: string
  message?: string
  describe?: string
  disagreement?: unknown
}

const seen = new Map<string, Row>()
const files = dirs.flatMap((d) => filesUnder(d))
for (const f of files)
  for (const { source, flags } of regexLiterals(f)) {
    const key = `/${source}/${flags}`
    if (seen.has(key)) continue
    let regex: RegExp
    try {
      regex = new RegExp(source, flags)
    } catch {
      seen.set(key, { source, flags, outcome: 'host-invalid' })
      continue
    }
    try {
      const pattern = fromRegex(regex)
      const d = differential(regex, pattern, inputsFor(source, flags, 120, 1), 1)
      seen.set(key, {
        source,
        flags,
        outcome: d.length ? 'DISAGREES' : 'agrees',
        describe: pattern.describe(),
        ...(d.length ? { disagreement: d[0] } : {}),
      })
    } catch (e) {
      if (e instanceof RegexRefusal) seen.set(key, { source, flags, outcome: 'refused', code: e.code, message: e.message })
      else seen.set(key, { source, flags, outcome: 'refused', code: `crash: ${(e as Error).name}`, message: (e as Error).message })
    }
  }

const rows = [...seen.values()].filter((r) => r.outcome !== 'host-invalid')
const n = rows.length
const pct = (k: number) => `${((100 * k) / Math.max(n, 1)).toFixed(1)}%`
const count = (pred: (r: Row) => boolean) => rows.filter(pred).length
const agrees = count((r) => r.outcome === 'agrees')
const disagrees = rows.filter((r) => r.outcome === 'DISAGREES')
const refused = rows.filter((r) => r.outcome === 'refused')

console.log(`# fromRegex over ${dirs.join(', ')}`)
console.log(`\n${files.length} files, ${n} distinct regex literals\n`)
console.log(`| Outcome | Regexes | Share |`)
console.log(`| --- | ---: | ---: |`)
console.log(`| translated, agrees on every generated input | ${agrees} | ${pct(agrees)} |`)
console.log(`| translated, DISAGREES (a translator bug) | ${disagrees.length} | ${pct(disagrees.length)} |`)
console.log(`| refused | ${refused.length} | ${pct(refused.length)} |`)

const byCode = new Map<string, Row[]>()
for (const r of refused) byCode.set(r.code!, [...(byCode.get(r.code!) ?? []), r])
console.log(`\n## Refusals, ranked\n`)
console.log(`| Reason | Regexes | Share of all | Examples |`)
console.log(`| --- | ---: | ---: | --- |`)
for (const [code, rs] of [...byCode].sort((a, b) => b[1].length - a[1].length))
  console.log(
    `| \`${code}\` | ${rs.length} | ${pct(rs.length)} | ${rs
      .slice(0, exampleCount)
      .map((r) => '`/' + r.source.slice(0, 40).replaceAll('|', '\\|').replaceAll('`', 'ˋ') + '/' + r.flags + '`')
      .join(' ')} |`
  )

if (disagrees.length) {
  console.log(`\n## Disagreements (each is a bug)\n`)
  for (const r of disagrees.slice(0, 30)) console.log(`- \`/${r.source}/${r.flags}\`: ${JSON.stringify(r.disagreement)}`)
}

if (jsonOut) await Bun.write(jsonOut, JSON.stringify(rows, null, 1))
