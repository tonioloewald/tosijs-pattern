/**
 * The differential check for `fromRegex()`: a regex and its translation, run on the same
 * generated inputs, must find the same matches (where, how long, and every group's text).
 * This file and the tests are the only places the host RegExp runs: here it is the ORACLE.
 *
 * Inputs are generated from the regex's own syntax tree (strings it should match, then those
 * strings mutated, joined and padded with nearby characters), so they probe the boundaries a
 * translation could get wrong, not random noise that matches nothing.
 */
import { parseRegex, type RNode } from '../src/regex/parse'
import type { Pattern, Match } from '../src/index'

export interface Disagreement {
  input: string
  regex: string
  pattern: string
}

/** A small seeded PRNG (mulberry32), so every run generates the same inputs. */
export function rng(seed: number) {
  let a = seed >>> 0
  return () => {
    a = (a + 0x6d2b79f5) >>> 0
    let t = a
    t = Math.imul(t ^ (t >>> 15), t | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

const BMP_SAFE = (cp: number) => cp < 0xd800 || (cp > 0xdfff && cp <= 0xffff)

export function inputsFor(source: string, flags: string, count = 300, seed = 1): string[] {
  const { ast } = parseRegex(source, flags)
  const astral = flags.includes('u')
  const random = rng(seed)
  const pick = <T>(xs: T[]): T => xs[Math.floor(random() * xs.length)]!
  // Characters worth trying: a few from every set in the regex, their neighbours, and the usual
  // suspects (space, newline, quote, backslash, a letter, a digit).
  const alphabet = new Set<number>([32, 10, 13, 34, 92, 97, 65, 48, 95, 45, 44, 46])
  const visit = (n: RNode) => {
    if (n.t === 'set') {
      for (const [a, b] of n.ranges.slice(0, 8)) {
        for (const cp of [a, b, a + 1, b - 1, a - 1, b + 1, a + Math.floor((b - a) / 2)])
          if (cp >= 0 && cp <= 0x10ffff && (astral || BMP_SAFE(cp))) alphabet.add(cp)
      }
    }
    if ('item' in n) visit(n.item)
    if (n.t === 'seq') n.items.forEach(visit)
    if (n.t === 'alt') n.options.forEach(visit)
  }
  visit(ast)
  const chars = [...alphabet].filter((cp) => astral || BMP_SAFE(cp)).map((cp) => String.fromCodePoint(cp))
  const member = (ranges: [number, number][]): string => {
    const usable = ranges.filter(([a]) => astral || BMP_SAFE(a))
    if (!usable.length) return pick(chars)
    if (random() < 0.5) {
      const inSet = chars.filter((c) => usable.some(([a, b]) => c.codePointAt(0)! >= a && c.codePointAt(0)! <= b))
      if (inSet.length) return pick(inSet)
    }
    const [a, b] = pick(usable)
    let cp = a + Math.floor(random() * Math.min(b - a + 1, 200))
    if (!astral && !BMP_SAFE(cp)) cp = a
    return String.fromCodePoint(cp)
  }
  const gen = (n: RNode, depth = 0): string => {
    if (depth > 30) return ''
    switch (n.t) {
      case 'set':
        return member(n.ranges)
      case 'seq':
        return n.items.map((i) => gen(i, depth + 1)).join('')
      case 'alt':
        return gen(pick(n.options), depth + 1)
      case 'repeat': {
        const extra = Math.floor(random() * 4)
        const times = Math.min(n.max ?? n.min + extra, n.min + extra)
        let s = ''
        for (let i = 0; i < times; i++) s += gen(n.item, depth + 1)
        return s
      }
      case 'capture':
        return gen(n.item, depth + 1)
      case 'look':
        return n.negative ? '' : random() < 0.5 ? gen(n.item, depth + 1) : ''
      default:
        return ''
    }
  }
  const mutate = (s: string): string => {
    const units = [...s]
    const op = random()
    const at = Math.floor(random() * (units.length + 1))
    if (op < 0.3 && units.length) units.splice(Math.min(at, units.length - 1), 1)
    else if (op < 0.6) units.splice(at, 0, pick(chars))
    else if (op < 0.8 && units.length) units[Math.min(at, units.length - 1)] = pick(chars)
    else units.splice(at, 0, ...units.slice(at, at + 2))
    return units.join('')
  }
  const out = new Set<string>(['', ...chars])
  const samples: string[] = []
  for (let i = 0; i < count && out.size < count * 4; i++) {
    const s = gen(ast)
    samples.push(s)
    out.add(s)
    out.add(mutate(s))
    out.add(mutate(mutate(s)))
    out.add(pick(chars) + s + pick(chars))
    if (samples.length > 1) out.add(pick(samples) + pick(chars) + s)
  }
  return [...out]
}

/** Group names a translation captures: `$1`… for unnamed groups, names for named ones. */
function groupNames(source: string, flags: string): string[] {
  const names: string[] = []
  const visit = (n: RNode) => {
    if (n.t === 'capture') names.push(n.name)
    if ('item' in n) visit(n.item)
    if (n.t === 'seq') n.items.forEach(visit)
    if (n.t === 'alt') n.options.forEach(visit)
  }
  visit(parseRegex(source, flags).ast)
  return names
}

const groupText = (m: RegExpExecArray, name: string): string | undefined =>
  name.startsWith('$') ? m[Number(name.slice(1))] : m.groups?.[name]

const show = (x: unknown) => JSON.stringify(x)

/** Compare the regex and the pattern on every input; return the disagreements (at most `limit`). */
export function differential(
  regex: RegExp,
  pattern: Pattern,
  inputs: string[],
  limit = 5
): Disagreement[] {
  const names = groupNames(regex.source, regex.flags)
  const base = regex.flags.replace(/[gy]/g, '')
  const once = new RegExp(regex.source, base)
  const all = new RegExp(regex.source, base + 'g')
  const out: Disagreement[] = []
  const describeRegex = (m: RegExpExecArray | null) =>
    m ? show({ at: m.index, text: m[0], groups: Object.fromEntries(names.map((n) => [n, groupText(m, n)])) }) : 'null'
  const describeMatch = (m: Match | null) =>
    m ? show({ at: m.start, text: m.text, groups: Object.fromEntries(names.map((n) => [n, m.texts[n]])) }) : 'null'
  for (const input of inputs) {
    const r = describeRegex(once.exec(input))
    const p = describeMatch(pattern.find(input))
    if (r !== p) out.push({ input, regex: r, pattern: p })
    else {
      const rs = show([...input.matchAll(all)].map((m) => [m.index, m[0].length]))
      const ps = show(pattern.findAll(input).map((m) => [m.start, m.end - m.start]))
      if (rs !== ps) out.push({ input, regex: `findAll ${rs}`, pattern: `findAll ${ps}` })
    }
    if (out.length >= limit) break
  }
  return out
}
