/**
 * Reading a JavaScript regex's SOURCE into a syntax tree, so the translator can reason about it.
 * A loop over the text, like the rest of this library: the host RegExp engine is never used.
 *
 * What it reads is ECMAScript's syntax, with the Annex B leniencies browsers accept when the
 * `u` flag is off (a lone `]`, `{` or `}` is itself; an unknown escape `\q` is `q`). What it
 * cannot read faithfully it REFUSES (see `RegexRefusal`), never guesses: a `\1` that might be a
 * legacy octal escape is a backreference here, and refused as one.
 */
import type { Ranges } from '../nodes'
import { normalize, complement, union, WHITESPACE } from '../chars'
import { PatternError } from '../pattern'

/** Why a regex was not translated. `code` is stable (the report counts by it); `message` explains. */
export type RefusalCode =
  | 'syntax'
  | 'backreference'
  | 'lookbehind'
  | 'word-boundary'
  | 'multiline-start'
  | 'lazy'
  | 'repetition-backtracks'
  | 'alternation-backtracks'
  | 'empty-repetition'
  | 'capture-in-repetition'
  | 'capture-in-lookahead'
  | 'caseless-non-ascii'
  | 'unicode-property'
  | 'unsupported-flag'
  | 'modifiers'
  | 'quantified-assertion'

export class RegexRefusal extends PatternError {
  readonly code: RefusalCode
  /** Offset in the regex source where the problem is. */
  readonly at: number
  /** What to write instead, when there is something. */
  readonly suggestion: string
  constructor(code: RefusalCode, at: number, message: string, suggestion = '') {
    super(`${message}${suggestion ? `. ${suggestion}` : ''}`)
    this.name = 'RegexRefusal'
    this.code = code
    this.at = at
    this.suggestion = suggestion
  }
}

export type RNode = { at: number } & (
  | { t: 'empty' }
  /** One character from a set. `negated` keeps the author's spelling (`[^"]`) for output. */
  | { t: 'set'; ranges: Ranges; negated: boolean; source: string }
  | { t: 'seq'; items: RNode[] }
  | { t: 'alt'; options: RNode[] }
  | { t: 'repeat'; item: RNode; min: number; max: number | null; lazy: boolean }
  /** A capturing group: `name` is the group's name, or `$n` for the n-th unnamed one. */
  | { t: 'capture'; name: string; item: RNode }
  | { t: 'look'; negative: boolean; item: RNode }
  | { t: 'start' }
  | { t: 'end' }
)

export interface Flags {
  i: boolean
  m: boolean
  s: boolean
  u: boolean
}

export const DIGIT: Ranges = [[48, 57]]
export const WORD: Ranges = normalize([[48, 57], [65, 90], [95, 95], [97, 122]])
/** What `.` excludes without the `s` flag, and what `^`/`$` see as line ends with `m`. */
export const LINE_TERMINATORS: Ranges = normalize([[10, 10], [13, 13], [0x2028, 0x2029]])
const KELVIN = 0x212a
const LONG_S = 0x17f

export function parseRegex(source: string, flagString: string): { ast: RNode; flags: Flags } {
  for (const f of flagString) {
    if (f === 'y')
      throw new RegexRefusal('unsupported-flag', 0, 'the y (sticky) flag matches only at lastIndex', 'Use .find(input, { from }) and check the match starts there')
    if (f === 'v')
      throw new RegexRefusal('unsupported-flag', 0, 'the v flag (class set syntax) is not read yet')
    if (!'gimsud'.includes(f))
      throw new RegexRefusal('syntax', 0, `unknown regex flag ${JSON.stringify(f)}`)
  }
  const flags: Flags = {
    i: flagString.includes('i'),
    m: flagString.includes('m'),
    s: flagString.includes('s'),
    u: flagString.includes('u'),
  }
  const p = new Parser(source, flags)
  const ast = p.alternation()
  if (p.pos < source.length)
    throw p.syntax(source[p.pos] === ')' ? 'unmatched )' : `unexpected ${JSON.stringify(source[p.pos])}`)
  return { ast, flags }
}

class Parser {
  pos = 0
  groups = 0
  constructor(
    readonly src: string,
    readonly flags: Flags
  ) {}

  syntax(message: string, at = this.pos): RegexRefusal {
    return new RegexRefusal('syntax', at, `not a valid regex: ${message} (at ${at})`)
  }

  peek(n = 0): string | undefined {
    return this.src[this.pos + n]
  }

  eat(s: string): boolean {
    if (this.src.startsWith(s, this.pos)) {
      this.pos += s.length
      return true
    }
    return false
  }

  /** The code point at pos (a surrogate pair is one, in the source as in Pattern). */
  codePoint(): number {
    const cp = this.src.codePointAt(this.pos)!
    this.pos += cp > 0xffff ? 2 : 1
    return cp
  }

  alternation(): RNode {
    const at = this.pos
    const options = [this.sequence()]
    while (this.eat('|')) options.push(this.sequence())
    return options.length === 1 ? options[0]! : { t: 'alt', options, at }
  }

  sequence(): RNode {
    const at = this.pos
    const items: RNode[] = []
    while (this.pos < this.src.length && this.peek() !== '|' && this.peek() !== ')') {
      const term = this.quantified()
      if (term.t === 'seq') items.push(...term.items)
      else if (term.t !== 'empty') items.push(term)
    }
    return items.length === 0 ? { t: 'empty', at } : items.length === 1 ? items[0]! : { t: 'seq', items, at }
  }

  quantified(): RNode {
    const at = this.pos
    const atom = this.atom()
    const q = this.quantifier()
    if (!q) return atom
    if (atom.t === 'start' || atom.t === 'end' || atom.t === 'look' || atom.t === 'empty')
      throw new RegexRefusal('quantified-assertion', at, 'a quantifier on an assertion (it matches no characters, so repeating it means nothing)')
    if (q.max !== null && q.max < q.min) throw this.syntax('numbers out of order in {} quantifier', at)
    return { t: 'repeat', item: atom, ...q, at }
  }

  quantifier(): { min: number; max: number | null; lazy: boolean } | null {
    let min: number
    let max: number | null
    const c = this.peek()
    if (c === '*') [min, max] = [0, null]
    else if (c === '+') [min, max] = [1, null]
    else if (c === '?') [min, max] = [0, 1]
    else if (c === '{') {
      const b = this.braces()
      if (!b) return null
      ;[min, max] = b
      this.pos--
    } else return null
    this.pos++
    const lazy = this.eat('?')
    return { min, max, lazy }
  }

  /** `{n}`, `{n,}`, `{n,m}` at pos: the numbers, leaving pos on the `}`; or null (a literal `{`). */
  braces(): [number, number | null] | null {
    const start = this.pos
    this.pos++
    const n = this.digits()
    if (n === null) return this.notBraces(start)
    let max: number | null = n
    if (this.eat(',')) max = this.digits()
    if (this.peek() !== '}') return this.notBraces(start)
    this.pos++
    return [n, max]
  }

  notBraces(start: number): null {
    if (this.flags.u) throw this.syntax('incomplete quantifier', start)
    this.pos = start
    return null
  }

  digits(): number | null {
    const start = this.pos
    while (this.pos < this.src.length && this.src.charCodeAt(this.pos) >= 48 && this.src.charCodeAt(this.pos) <= 57) this.pos++
    return this.pos > start ? Number(this.src.slice(start, this.pos)) : null
  }

  atom(): RNode {
    const at = this.pos
    const c = this.peek()!
    switch (c) {
      case '^':
        this.pos++
        if (this.flags.m)
          throw new RegexRefusal('multiline-start', at, '^ with the m flag looks at the character BEFORE the position, which Pattern cannot yet', 'Split the input into lines (split on lineBreak) and anchor each with start')
        return { t: 'start', at }
      case '$':
        this.pos++
        if (this.flags.m) {
          // The end of the input, or just before a line terminator: a lookahead says exactly that.
          return {
            t: 'look',
            negative: false,
            at,
            item: { t: 'alt', at, options: [{ t: 'end', at }, this.set(LINE_TERMINATORS, false, '$', at)] },
          }
        }
        return { t: 'end', at }
      case '.':
        this.pos++
        return this.flags.s
          ? this.set([[0, 0x10ffff]], false, '.', at)
          : this.set(complement(LINE_TERMINATORS), true, '.', at)
      case '(':
        return this.group()
      case '[':
        return this.characterClass()
      case '\\':
        return this.escape()
      case '*':
      case '+':
      case '?':
        throw this.syntax('nothing to repeat')
      case '{':
        if (this.flags.u || this.braces()) throw this.syntax('nothing to repeat', at)
        this.pos++
        return this.literal(c.codePointAt(0)!, at)
      case ')':
        throw this.syntax('unmatched )')
      default: {
        if ((c === ']' || c === '}') && this.flags.u) throw this.syntax(`lone ${c}`)
        const cp = this.codePoint()
        return this.literal(cp, at)
      }
    }
  }

  group(): RNode {
    const at = this.pos
    this.pos++ // (
    let node: RNode
    if (this.eat('?:')) node = this.alternation()
    else if (this.eat('?=') || this.eat('?!')) {
      const negative = this.src[this.pos - 1] === '!'
      node = { t: 'look', negative, item: this.alternation(), at }
    } else if (this.eat('?<=') || this.eat('?<!'))
      throw new RegexRefusal('lookbehind', at, 'a lookbehind looks at text BEFORE the position, which Pattern cannot yet', 'Capture what comes before instead, or match it and keep only the part you need')
    else if (this.eat('?<')) {
      const end = this.src.indexOf('>', this.pos)
      if (end < 0) throw this.syntax('unterminated group name')
      const name = this.src.slice(this.pos, end)
      this.pos = end + 1
      this.groups++
      node = { t: 'capture', name, item: this.alternation(), at }
    } else if (this.peek() === '?')
      throw new RegexRefusal('modifiers', at, 'inline modifiers like (?i:…) are not read yet', 'Use .anyCase(…) on the part that ignores case')
    else {
      this.groups++
      node = { t: 'capture', name: `$${this.groups}`, item: this.alternation(), at }
    }
    if (!this.eat(')')) throw this.syntax('unterminated group', at)
    return node
  }

  /** One character, with the `i` flag's case variants (ASCII only; see `caseVariants`). */
  literal(cp: number, at: number): RNode {
    const source = String.fromCodePoint(cp)
    return this.set(this.flags.i ? this.caseClosure([[cp, cp]], at) : [[cp, cp]], false, source, at)
  }

  set(ranges: Ranges, negated: boolean, source: string, at: number): RNode {
    return { t: 'set', ranges: normalize(ranges), negated, source, at }
  }

  /**
   * The `i` flag's set: every character that matches one of `ranges` ignoring case. Exact for
   * ASCII letters; with `u`, `k` and `s` also match the Kelvin sign and the long s (Unicode case
   * folding). A cased character beyond ASCII is refused: getting it right needs the Unicode case
   * tables, which this library does not carry yet.
   */
  caseClosure(ranges: Ranges, at: number): Ranges {
    const out: Ranges = [...ranges]
    for (const [a, b] of ranges) {
      for (let cp = Math.max(a, 65); cp <= Math.min(b, 122); cp++) {
        if (cp >= 65 && cp <= 90) out.push([cp + 32, cp + 32])
        else if (cp >= 97 && cp <= 122) out.push([cp - 32, cp - 32])
      }
      if (b >= 128) {
        if (b - Math.max(a, 128) > 0x30000)
          throw new RegexRefusal('caseless-non-ascii', at, 'the i flag on a set this large beyond ASCII needs Unicode case tables')
        for (let cp = Math.max(a, 128); cp <= b; cp++) {
          if (this.flags.u && (cp === KELVIN || cp === LONG_S)) continue
          const ch = String.fromCodePoint(cp)
          if (ch.toLowerCase() !== ch || ch.toUpperCase() !== ch)
            throw new RegexRefusal('caseless-non-ascii', at, `the i flag on ${JSON.stringify(ch)} (beyond ASCII) needs Unicode case tables, which Pattern does not carry yet`)
        }
      }
    }
    if (this.flags.u) {
      const has = (cp: number) => out.some(([a, b]) => cp >= a && cp <= b)
      if (has(0x6b) || has(0x4b) || has(KELVIN)) out.push([0x4b, 0x4b], [0x6b, 0x6b], [KELVIN, KELVIN])
      if (has(0x73) || has(0x53) || has(LONG_S)) out.push([0x53, 0x53], [0x73, 0x73], [LONG_S, LONG_S])
    }
    return normalize(out)
  }

  /** `\w` (and `\W`'s complement): with `iu`, Unicode case folding adds two characters. */
  word(): Ranges {
    return this.flags.i && this.flags.u ? union(WORD, [[LONG_S, LONG_S], [KELVIN, KELVIN]]) : WORD
  }

  escape(): RNode {
    const at = this.pos
    this.pos++ // \
    const c = this.peek()
    if (c === undefined) throw this.syntax('\\ at end of pattern', at)
    const cls = this.classEscape()
    if (cls) return this.set(cls.ranges, cls.negated, this.src.slice(at, this.pos), at)
    if (c === 'b' || c === 'B')
      throw new RegexRefusal('word-boundary', at, `\\${c} looks at the character BEFORE the position, which Pattern cannot yet`, c === 'b' ? 'Say what is on each side: notFollowedBy(wordChar) after a word, or start the match at a non-word character' : '')
    if (c >= '1' && c <= '9')
      throw new RegexRefusal('backreference', at, `\\${c} is a backreference (memory of an earlier match), which a pattern does not have`, 'Capture both and compare them in code')
    if (c === 'k' && (this.flags.u || this.src.includes('(?<')))
      throw new RegexRefusal('backreference', at, '\\k<…> is a backreference (memory of an earlier match), which a pattern does not have', 'Capture both and compare them in code')
    const cp = this.characterEscape()
    return this.literal(cp, at)
  }

  /** `\d \D \w \W \s \S` (and `\p`, refused). Advances past it, or returns null and does not. */
  classEscape(): { ranges: Ranges; negated: boolean } | null {
    const c = this.peek()
    let r: Ranges | null = null
    let negated = false
    if (c === 'd' || c === 'D') r = DIGIT
    else if (c === 'w' || c === 'W') r = this.word()
    else if (c === 's' || c === 'S') r = WHITESPACE
    else if ((c === 'p' || c === 'P') && this.flags.u)
      throw new RegexRefusal('unicode-property', this.pos - 1, `\\${c}{…} needs the Unicode property tables, which Pattern does not carry yet`, 'Name the characters with .charIn(…), or use .letter() / .digit() (ASCII)')
    if (!r) return null
    negated = c === 'D' || c === 'W' || c === 'S'
    this.pos++
    return { ranges: negated ? complement(r) : r, negated }
  }

  /** A single-character escape after the `\`; returns its code point. */
  characterEscape(): number {
    const at = this.pos - 1
    const c = this.peek()!
    const simple: Record<string, number> = { n: 10, r: 13, t: 9, v: 11, f: 12 }
    if (c in simple) {
      this.pos++
      return simple[c]!
    }
    if (c === '0' && !(this.peek(1)! >= '0' && this.peek(1)! <= '9')) {
      this.pos++
      return 0
    }
    if (c >= '0' && c <= '9') {
      if (this.flags.u) throw this.syntax('invalid escape', at)
      throw new RegexRefusal('backreference', at, `\\${c} is a legacy octal escape or a backreference; neither is read`, 'Write the character itself, or \\x / \\u')
    }
    if (c === 'x') {
      const h = this.hex(1, 2)
      if (h !== null) return h
      if (this.flags.u) throw this.syntax('invalid \\x escape', at)
      this.pos++
      return 0x78
    }
    if (c === 'u') {
      if (this.flags.u && this.peek(1) === '{') {
        const close = this.src.indexOf('}', this.pos)
        const cp = close > 0 ? parseHex(this.src.slice(this.pos + 2, close)) : null
        if (cp === null || cp > 0x10ffff) throw this.syntax('invalid \\u{…} escape', at)
        this.pos = close + 1
        return cp
      }
      const h = this.hex(1, 4)
      if (h === null) {
        if (this.flags.u) throw this.syntax('invalid \\u escape', at)
        this.pos++
        return 0x75
      }
      // A surrogate pair written as two escapes is one code point with `u`.
      if (this.flags.u && h >= 0xd800 && h <= 0xdbff && this.src.startsWith('\\u', this.pos)) {
        const save = this.pos
        this.pos++
        const lo = this.hex(1, 4)
        if (lo !== null && lo >= 0xdc00 && lo <= 0xdfff) return 0x10000 + ((h - 0xd800) << 10) + (lo - 0xdc00)
        this.pos = save
      }
      return h
    }
    if (c === 'c') {
      const l = this.src.charCodeAt(this.pos + 1)
      if ((l >= 65 && l <= 90) || (l >= 97 && l <= 122)) {
        this.pos += 2
        return l % 32
      }
      if (this.flags.u) throw this.syntax('invalid \\c escape', at)
      return 0x5c // Annex B: a lone \ before c; the c is read next
    }
    // An identity escape: the character itself. With `u` only syntax characters may be escaped.
    if (this.flags.u && !'^$\\.*+?()[]{}|/-'.includes(c)) throw this.syntax(`invalid escape \\${c}`, at)
    return this.codePoint()
  }

  /** `count` hex digits after `skip` characters (the x or u), advancing past them; or null. */
  hex(skip: number, count: number): number | null {
    const text = this.src.slice(this.pos + skip, this.pos + skip + count)
    const v = text.length === count ? parseHex(text) : null
    if (v === null) return null
    this.pos += skip + count
    return v
  }

  characterClass(): RNode {
    const at = this.pos
    this.pos++ // [
    const negated = this.eat('^')
    const ranges: Ranges = []
    for (;;) {
      if (this.pos >= this.src.length) throw this.syntax('unterminated character class', at)
      if (this.eat(']')) break
      const from = this.classAtom()
      if (this.peek() === '-' && this.peek(1) !== ']' && this.peek(1) !== undefined) {
        const save = this.pos
        this.pos++
        const to = this.classAtom()
        if (typeof from === 'number' && typeof to === 'number') {
          if (to < from) throw this.syntax('range out of order in character class', save)
          ranges.push([from, to])
          continue
        }
        if (this.flags.u) throw this.syntax('a class escape cannot bound a range', save)
        // Annex B: `[\d-x]` is \d, '-', x.
        add(ranges, from)
        ranges.push([45, 45])
        add(ranges, to)
        continue
      }
      add(ranges, from)
    }
    let set = normalize(ranges)
    if (this.flags.i) set = this.caseClosure(set, at)
    return this.set(negated ? complement(set) : set, negated, this.src.slice(at, this.pos), at)
  }

  /** One member of a class: a code point, or a set (`\d` and kin). */
  classAtom(): number | Ranges {
    if (this.peek() === '\\') {
      const at = this.pos
      this.pos++
      const cls = this.classEscape()
      if (cls) return cls.ranges
      const c = this.peek()
      if (c === 'b') {
        this.pos++
        return 8 // backspace, inside a class
      }
      if (c === '-') {
        this.pos++
        return 45
      }
      if (c === 'c' && !this.flags.u) {
        const l = this.src.charCodeAt(this.pos + 1)
        // Annex B: inside a class, \c also takes digits and _.
        if ((l >= 48 && l <= 57) || l === 95) {
          this.pos += 2
          return l % 32
        }
      }
      if (c !== undefined && c >= '1' && c <= '9' && !this.flags.u)
        throw new RegexRefusal('backreference', at, `\\${c} inside a class is a legacy octal escape, which is not read`, 'Write the character itself, or \\x / \\u')
      return this.characterEscape()
    }
    return this.codePoint()
  }
}

function add(ranges: Ranges, x: number | Ranges): void {
  if (typeof x === 'number') ranges.push([x, x])
  else ranges.push(...x)
}

function parseHex(text: string): number | null {
  if (!text) return null
  let v = 0
  for (const ch of text) {
    const c = ch.charCodeAt(0)
    const d = c >= 48 && c <= 57 ? c - 48 : c >= 97 && c <= 102 ? c - 87 : c >= 65 && c <= 70 ? c - 55 : -1
    if (d < 0) return null
    v = v * 16 + d
  }
  return v
}
