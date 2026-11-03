/**
 * Character sets as sorted code-point ranges. No RegExp anywhere in this library: a set is
 * data, and membership is a binary search.
 */
import type { Ranges } from './nodes'

/** Merge overlapping or adjacent ranges and sort them. */
export function normalize(ranges: Ranges): Ranges {
  const sorted = ranges
    .map(([a, b]) => (a <= b ? [a, b] : [b, a]) as [number, number])
    .sort((x, y) => x[0] - y[0])
  const out: Ranges = []
  for (const r of sorted) {
    const last = out[out.length - 1]
    if (last && r[0] <= last[1] + 1) last[1] = Math.max(last[1], r[1])
    else out.push([r[0], r[1]])
  }
  return out
}

/**
 * Parse a RANGE STRING into ranges: `'a-z0-9_'`. A `-` between two characters is a range;
 * a `-` first or last is itself. `\` makes the next character literal (`'\\-'`). There are no
 * other escapes and no classes: name the set you want (`digit`, `whitespace`) instead.
 */
export function parseRangeString(spec: string): Ranges {
  const cps: number[] = []
  const literal: boolean[] = []
  for (let i = 0; i < spec.length; ) {
    let cp = spec.codePointAt(i)!
    let isLiteral = false
    if (cp === 0x5c /* \ */ && i + 1 < spec.length) {
      i += 1
      cp = spec.codePointAt(i)!
      isLiteral = true
    }
    cps.push(cp)
    literal.push(isLiteral)
    i += cp > 0xffff ? 2 : 1
  }
  const ranges: Ranges = []
  for (let k = 0; k < cps.length; k++) {
    const isDash = cps[k + 1] === 0x2d && !literal[k + 1]
    if (isDash && k + 2 < cps.length) {
      ranges.push([cps[k]!, cps[k + 2]!])
      k += 2
    } else ranges.push([cps[k]!, cps[k]!])
  }
  return normalize(ranges)
}

export function inRanges(ranges: Ranges, cp: number): boolean {
  let lo = 0
  let hi = ranges.length - 1
  while (lo <= hi) {
    const mid = (lo + hi) >> 1
    const r = ranges[mid]!
    if (cp < r[0]) hi = mid - 1
    else if (cp > r[1]) lo = mid + 1
    else return true
  }
  return false
}

/** The ranges back as a range string, for descriptions and messages. */
export function rangeString(ranges: Ranges): string {
  const show = (cp: number) => {
    const c = String.fromCodePoint(cp)
    if (c === '\n') return '\\n'
    if (c === '\t') return '\\t'
    if (c === '\r') return '\\r'
    if (c === ' ') return '␠'
    if (c === '-' || c === '\\') return '\\' + c
    return c
  }
  return ranges
    .map(([a, b]) =>
      a === b ? show(a) : b === a + 1 ? show(a) + show(b) : `${show(a)}-${show(b)}`
    )
    .join('')
}

/**
 * JavaScript's `\s`, as data: the whitespace and line terminators ECMAScript defines.
 * Spelled out so the set is visible and testable (`pattern.test.ts` checks it against `\s` over the whole BMP).
 */
export const WHITESPACE: Ranges = normalize([
  [0x09, 0x0d],
  [0x20, 0x20],
  [0xa0, 0xa0],
  [0x1680, 0x1680],
  [0x2000, 0x200a],
  [0x2028, 0x2029],
  [0x202f, 0x202f],
  [0x205f, 0x205f],
  [0x3000, 0x3000],
  [0xfeff, 0xfeff],
])

/**
 * Is `name` a JavaScript identifier (ASCII) that can name a capture or a column? A loop, not a
 * RegExp: this library uses none. `__proto__` is refused: assigning it sets an object's
 * prototype instead of a key, so the value would be silently lost.
 */
export function isIdentifier(name: string): boolean {
  if (!name || name === '__proto__') return false
  for (let i = 0; i < name.length; i++) {
    const c = name.charCodeAt(i)
    const letterLike = (c >= 65 && c <= 90) || (c >= 97 && c <= 122) || c === 95 || c === 36
    if (!(letterLike || (i > 0 && c >= 48 && c <= 57))) return false
  }
  return true
}

export const MAX_CODE_POINT = 0x10ffff

/** Every code point in either set. */
export function union(a: Ranges, b: Ranges): Ranges {
  return normalize([...a, ...b])
}

/** Every code point NOT in the set. */
export function complement(ranges: Ranges): Ranges {
  const out: Ranges = []
  let next = 0
  for (const [a, b] of normalize(ranges)) {
    if (a > next) out.push([next, a - 1])
    next = b + 1
  }
  if (next <= MAX_CODE_POINT) out.push([next, MAX_CODE_POINT])
  return out
}

/** Every code point in both sets. */
export function intersect(a: Ranges, b: Ranges): Ranges {
  const x = normalize(a)
  const y = normalize(b)
  const out: Ranges = []
  let i = 0
  let j = 0
  while (i < x.length && j < y.length) {
    const lo = Math.max(x[i]![0], y[j]![0])
    const hi = Math.min(x[i]![1], y[j]![1])
    if (lo <= hi) out.push([lo, hi])
    if (x[i]![1] < y[j]![1]) i++
    else j++
  }
  return out
}

export const sameRanges = (a: Ranges, b: Ranges): boolean =>
  a.length === b.length && a.every((r, i) => r[0] === b[i]![0] && r[1] === b[i]![1])
