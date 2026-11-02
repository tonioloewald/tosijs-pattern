/**
 * Pattern against native RegExp and (when tjs-lang is checked out beside this repo) tjs-lang's
 * linear regex engine, on the same tasks and inputs. Best of 9 runs, interleaved so machine load
 * hits every engine equally, after a warm-up. Results are compared first: a row whose answers
 * differ says so (the `$amounts` row differs until templates insert matched text, #3756).
 *
 *   bun scripts/bench.ts
 *
 * Inputs are DISTINCT per call where it matters: JavaScriptCore appears to cache test() on an
 * identical regex and string, which once made native CSV matching read 0.00ms.
 */
import { sequence, start, end, times, digit, oneOrMore, charIn, capture, number, letter, wordChar, zeroOrMore, oneOf, whitespace, charNotIn, quoted, optional } from '../src/index.ts'

// tjs-lang's linear engine, if tjs-lang is checked out beside this repo: it is what AsyncJS runs
// today instead of native regex, so it is the comparison that matters for the VM builtin.
// A variable specifier, so this repo's typecheck does not follow it into tjs-lang's source.
const TJS_REGEX = '../../tjs-lang/src/vm/regex.ts'
const lin: any = await import(TJS_REGEX).catch(() => null)
const compileRegex = (src: string, flags = '') => (lin ? lin.compileRegex(src, flags) : null)
const execRegex = (re: any, s: string, at: number, charge: () => void) => lin.execRegex(re, s, at, charge)
const free = () => {}
// tjs-lang's linear engine (a Pike VM in JS): what AsyncJS runs today instead of native regex.
const linTest = (re: any, s: string) => execRegex(re, s, 0, free) !== null
const linAll = (re: any, s: string) => { let n = 0, at = 0; for (;;) { const m = execRegex(re, s, at, free); if (!m) return n; n++; at = m.end > m.index ? m.end : m.index + 1 } }
// Inputs
const words = 'alpha beta 42 gamma 3.14 delta $7.50 epsilon 1e3 zeta '.repeat(2000) // ~110KB
const phones = Array.from({ length: 20000 }, (_, i) => (i % 3 ? `555-${String(1000 + (i % 9000))}` : `55-12${i % 10}`))
const emails = Array.from({ length: 20000 }, (_, i) => (i % 4 ? `user${i}@example.com` : `bad${i}@`))
const csvLines = Array.from({ length: 500 }, (_, j) => Array.from({ length: 200 }, (_, i) => (i % 5 ? `field${i}_${j}` : `"quoted, ${i} ${j}"`)).join(','))
const csvLine = Array.from({ length: 200 }, (_, i) => (i % 5 ? `field${i}` : `"quoted, ${i}"`)).join(',')

const phoneP = sequence(start, times(3, digit), '-', times(4, digit), end)
const phoneR = /^\d{3}-\d{4}$/
const emailP = sequence(start, oneOrMore(charIn('a-z0-9._')), '@', oneOrMore(charIn('a-z0-9-')), oneOrMore(sequence('.', oneOrMore(letter))), end)
const emailR = /^[a-z0-9._]+@[a-z0-9-]+(?:\.[a-zA-Z]+)+$/
const numP = number
const numR = /-?(?:0|[1-9]\d*)(?:\.\d+)?(?:[eE][+-]?\d+)?/g
const wordP = oneOrMore(letter)
const wordR = /[A-Za-z]+/g
const dollarP = sequence('$', capture('n', number))
const dollarR = /\$(-?(?:0|[1-9]\d*)(?:\.\d+)?)/g
const fieldP = oneOf(quoted('"'), zeroOrMore(charNotIn(',')))
const csvP = sequence(fieldP, zeroOrMore(sequence(',', fieldP)))
const csvR = /^(?:"[^"]*"|[^,]*)(?:,(?:"[^"]*"|[^,]*))*$/

const L = {
  phone: compileRegex('^\\d{3}-\\d{4}$'),
  email: compileRegex('^[a-z0-9._]+@[a-z0-9-]+(?:\\.[a-zA-Z]+)+$'),
  num: compileRegex('-?(?:0|[1-9]\\d*)(?:\\.\\d+)?(?:[eE][+-]?\\d+)?', 'g'),
  word: compileRegex('[A-Za-z]+', 'g'),
  csv: compileRegex('^(?:"[^"]*"|[^,]*)(?:,(?:"[^"]*"|[^,]*))*$'),
}
const cases: [string, () => unknown, () => unknown, (() => unknown)?][] = [
  ['validate 20k phone numbers (whole string)', () => phones.filter((s) => phoneP.matches(s)).length, () => phones.filter((s) => phoneR.test(s)).length, () => phones.filter((s) => linTest(L.phone, s)).length],
  ['validate 20k emails (whole string)', () => emails.filter((s) => emailP.matches(s)).length, () => emails.filter((s) => emailR.test(s)).length, () => emails.filter((s) => linTest(L.email, s)).length],
  ['find all numbers in 110KB', () => numP.findAll(words).length, () => words.match(numR)!.length, () => linAll(L.num, words)],
  ['find all words in 110KB', () => wordP.findAll(words).length, () => words.match(wordR)!.length, () => linAll(L.word, words)],
  ['replace $amounts in 110KB', () => dollarP.replaceAll(words, '{n} USD').length, () => words.replace(dollarR, '$1 USD').length],
  ['match 500 distinct 200-field CSV lines', () => csvLines.filter((l) => csvP.matches(l)).length, () => csvLines.filter((l) => csvR.test(l)).length, () => csvLines.filter((l) => linTest(L.csv, l)).length],
]

const time = (f: () => unknown) => { const t = performance.now(); f(); return performance.now() - t }
for (const [name, p, r, l] of cases) {
  const pa = p(), ra = r()
  if (JSON.stringify(pa) !== JSON.stringify(ra)) console.log(`  ! results differ: pattern ${pa} vs regex ${ra}`)
  for (let i = 0; i < 3; i++) { p(); r() } // warm up both
  if (lin && l && JSON.stringify(l()) !== JSON.stringify(ra)) console.log(`  ! linear engine differs: ${l()} vs ${ra}`)
  let bp = Infinity, br = Infinity, bl = Infinity
  for (let i = 0; i < 9; i++) { bp = Math.min(bp, time(p)); br = Math.min(br, time(r)); if (lin && l) bl = Math.min(bl, time(l)) } // interleaved, best of 9
  console.log(`${name.padEnd(42)} pattern ${bp.toFixed(2).padStart(7)}ms | native ${br.toFixed(2).padStart(6)}ms (${(bp / br).toFixed(0)}x) | tjs linear ${lin && l ? bl.toFixed(2).padStart(7) + 'ms (pattern ' + (bp / bl).toFixed(2) + 'x)' : '   n/a'}`)
}
