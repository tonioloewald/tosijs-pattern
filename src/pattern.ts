/**
 * The vocabulary. The test for every name here is READ-ALOUD: a pattern should read the way a
 * fluent engineer reads a clean regex aloud, and drawing its railroad diagram should be
 * mechanical (one piece per box, nested as the boxes nest).
 *
 *   /^\d{3}-\d{4}$/          sequence(start, times(3, digit), '-', times(4, digit), end)
 *   /[a-z]+/                 oneOrMore(lowercase)
 *   /(,\s*)?/                optional(sequence(',', zeroOrMore(whitespace)))
 *
 * NOUNS are characters (`digit`, `letter`, `whitespace`, `charIn('a-f')`). VERBS take nouns or
 * other patterns (`oneOrMore`, `optional`, `oneOf`). A plain string anywhere is that literal
 * text: there is nothing to escape, ever.
 *
 * Patterns are immutable values. Every function returns a new one; none has a side effect.
 */
import type { Node, Ranges } from './nodes'
import { normalize, parseRangeString, WHITESPACE, isIdentifier } from './chars'
import {
  context,
  match,
  expectation,
  PatternBudgetError,
  type Captures,
  type Texts,
} from './engine'
import { describe } from './describe'

export type Piece = Pattern | string

/** Default ceiling on engine steps per operation. Generous; set `maxSteps` to taste. */
export const DEFAULT_MAX_STEPS = 10_000_000

export interface Options {
  /** Ceiling on engine work for this call; exceeding it throws `PatternBudgetError`. */
  maxSteps?: number
}

/** One match found in a larger string. */
export interface Match {
  text: string
  start: number
  end: number
  /** Each capture's VALUE: its text, or a number, a list, or unescaped content. */
  captures: Captures
  /** Each capture's matched TEXT, exactly as it appears in the input (what templates insert). */
  texts: Texts
  /** The pattern's value: its text, or a number, a list, or unescaped content (see DECISIONS.md). */
  value: unknown
}

export interface ParseError {
  /** Offset, line and column (both 1-based) of the farthest point the pattern reached. */
  at: number
  line: number
  column: number
  /** What would have let it continue there. */
  expected: string[]
  message: string
}

export type ParseResult =
  | { ok: true; captures: Captures; texts: Texts; value: unknown; steps: number }
  /** A failed parse still has (empty) `captures`, so `p.parse(s).captures.x` reads safely. */
  | { ok: false; error: ParseError; captures: Captures; texts: Texts; value: undefined; steps: number }

export class PatternError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'PatternError'
  }
}

export { PatternBudgetError }

const isPattern = (x: unknown): x is Pattern => x instanceof Pattern

function toNode(piece: Piece, where: string): Node {
  if (typeof piece === 'string') {
    if (!piece) throw new PatternError(`${where}: an empty string matches nothing; leave it out`)
    return { kind: 'literal', text: piece }
  }
  if (isPattern(piece)) return piece.node
  throw new PatternError(
    `${where}: expected a pattern or a string, got ${piece === null ? 'null' : typeof piece}`
  )
}

function count(n: unknown, where: string): number {
  if (typeof n !== 'number' || !Number.isInteger(n) || n < 0)
    throw new PatternError(`${where}: expected a whole number ≥ 0, got ${String(n)}`)
  return n
}

export class Pattern {
  readonly node: Node
  #checked = false

  constructor(node: Node) {
    this.node = freezeNode(node)
    Object.freeze(this)
  }

  /** Does the WHOLE string match? */
  matches(input: string, options?: Options): boolean {
    return this.parse(input, options).ok
  }

  /**
   * Match the WHOLE string, and say where and why when it does not:
   * `expected a number at line 1, column 6`.
   */
  parse(input: string, options: Options = {}): ParseResult {
    this.#check()
    const ctx = context(input, options.maxSteps ?? DEFAULT_MAX_STEPS)
    const hit = match(this.node, ctx, 0)
    if (hit && hit.end === input.length)
      return {
        ok: true,
        captures: hit.caps ?? {},
        texts: hit.texts ?? {},
        value: hit.value,
        steps: ctx.steps,
      }
    if (hit && hit.end >= ctx.farthest) {
      ctx.farthest = hit.end
      ctx.expected = new Set(['the end of the input'])
    }
    const at = Math.max(ctx.farthest, 0)
    const before = input.slice(0, at)
    const line = before.split('\n').length
    const column = at - before.lastIndexOf('\n')
    const expected = [...ctx.expected]
    const shown =
      expected.length > 1
        ? `one of ${expected.slice(0, -1).join(', ')} or ${expected.at(-1)}`
        : (expected[0] ?? 'something else')
    return {
      ok: false,
      captures: {},
      texts: {},
      value: undefined,
      error: {
        at,
        line,
        column,
        expected,
        message: `expected ${shown} at line ${line}, column ${column}`,
      },
      steps: ctx.steps,
    }
  }

  /** The first match at or after `from`, or null. */
  find(input: string, options: Options & { from?: number } = {}): Match | null {
    this.#check()
    const ctx = context(input, options.maxSteps ?? DEFAULT_MAX_STEPS)
    for (let at = options.from ?? 0; at <= input.length; at = nextStart(input, at)) {
      const hit = match(this.node, ctx, at)
      if (hit)
        return {
          text: input.slice(at, hit.end),
          start: at,
          end: hit.end,
          captures: hit.caps ?? {},
          texts: hit.texts ?? {},
          value: hit.value,
        }
    }
    return null
  }

  /** Every non-overlapping match, left to right. */
  findAll(input: string, options: Options = {}): Match[] {
    this.#check()
    const out: Match[] = []
    const ctx = context(input, options.maxSteps ?? DEFAULT_MAX_STEPS)
    for (let at = 0; at <= input.length; ) {
      const hit = match(this.node, ctx, at)
      if (!hit) {
        at = nextStart(input, at)
        continue
      }
      out.push({
        text: input.slice(at, hit.end),
        start: at,
        end: hit.end,
        captures: hit.caps ?? {},
        texts: hit.texts ?? {},
        value: hit.value,
      })
      at = hit.end > at ? hit.end : nextStart(input, at)
    }
    return out
  }

  /** Does the string contain a match anywhere? */
  occursIn(input: string, options?: Options): boolean {
    return this.find(input, options) !== null
  }

  /**
   * Replace every match. `replacement` is a template, where `{name}` is that capture's matched
   * TEXT (`$3.50` stays `3.50`, not the number 3.5) and `{{` / `}}` are literal braces; or a
   * function of the match, which has both `m.captures` (values) and `m.texts`.
   */
  replaceAll(
    input: string,
    replacement: string | ((m: Match) => string),
    options?: Options
  ): string {
    return this.#replace(input, this.findAll(input, options), replacement)
  }

  /** Replace the first match only. */
  replaceFirst(
    input: string,
    replacement: string | ((m: Match) => string),
    options?: Options
  ): string {
    const m = this.find(input, options)
    return this.#replace(input, m ? [m] : [], replacement)
  }

  /** The pieces of the string between matches. */
  split(input: string, options?: Options): string[] {
    const out: string[] = []
    let last = 0
    for (const m of this.findAll(input, options)) {
      if (m.end === m.start) continue
      out.push(input.slice(last, m.start))
      last = m.end
    }
    out.push(input.slice(last))
    return out
  }

  /** The pattern read aloud: `one or more digits, then ".", then …`. */
  describe(): string {
    return describe(this.node)
  }

  /** The pattern as plain JSON. `fromJSON` reads it back (and validates it). */
  toJSON(): Node {
    return this.node
  }

  toString(): string {
    return `Pattern(${this.describe()})`
  }

  #replace(
    input: string,
    matches: Match[],
    replacement: string | ((m: Match) => string)
  ): string {
    let out = ''
    let last = 0
    for (const m of matches) {
      out += input.slice(last, m.start)
      out +=
        typeof replacement === 'function'
          ? replacement(m)
          : fillTemplate(replacement, m)
      last = m.end
    }
    return out + input.slice(last)
  }

  /** Checks a whole pattern once, on first use (see `checkCaptures`). */
  #check(): void {
    if (this.#checked) return
    checkCaptures(this.node, false, null)
    this.#checked = true
  }
}

/** The next place a search may start: one whole code point on, never inside a surrogate pair. */
const nextStart = (input: string, at: number) => at + ((input.codePointAt(at) ?? 0) > 0xffff ? 2 : 1)

/** Freeze a node and everything in it, so a pattern is a value nobody can change underneath you. */
function freezeNode<T>(x: T): T {
  if (x && typeof x === 'object' && !Object.isFrozen(x)) {
    Object.freeze(x)
    for (const v of Object.values(x as object)) freezeNode(v)
  }
  return x
}

function fillTemplate(template: string, m: Match): string {
  let out = ''
  for (let i = 0; i < template.length; i++) {
    const c = template[i]!
    if ((c === '{' || c === '}') && template[i + 1] === c) {
      out += c
      i++
    } else if (c === '{') {
      const close = template.indexOf('}', i)
      if (close < 0) throw new PatternError(`replacement: unclosed { in ${JSON.stringify(template)}`)
      const name = template.slice(i + 1, close)
      if (!(name in m.texts))
        throw new PatternError(
          `replacement names {${name}}, but the pattern captures ${
            Object.keys(m.captures).map((k) => `{${k}}`).join(', ') || 'nothing'
          }`
        )
      out += m.texts[name]
      i = close
    } else out += c
  }
  return out
}

/**
 * A capture inside a repetition or a list, with nothing capturing the repetition, would be
 * LOST (each item's captures go into that item's entry of the list). Silently dropping what the
 * author asked for is the worst outcome, so it is an error that says what to write instead.
 * A capture inside a zero-width check (`followedBy`, `notFollowedBy`, `until`'s stopping
 * point) is an error for the same reason: those keep nothing of what they matched.
 *
 * So is a name recorded twice in one scope, where the second would overwrite the first:
 * `sequence(capture('a', …), capture('a', …))`, or a capture around one with its own name.
 * Options of a `oneOf` may share a name (only one of them is recorded), and each item of a
 * captured repetition is a scope of its own.
 *
 * Returns the names this node records in the current scope.
 */
function checkCaptures(node: Node, inList: boolean, check: string | null): Set<string> {
  const none = new Set<string>()
  switch (node.kind) {
    case 'capture': {
      if (check)
        throw new PatternError(
          `capture('${node.name}') is inside ${check}, which keeps nothing of what it matched: there is nothing to capture`
        )
      if (inList)
        throw new PatternError(
          `capture('${node.name}') is inside a repetition or list, so each item gets one: capture the repetition to collect them, e.g. capture('${node.name}s', oneOrMore(…))`
        )
      const item = node.item
      let names: Set<string>
      // A repetition or list directly under a capture COLLECTS its items' captures (one entry
      // per item), so captures inside it are wanted, not lost, and each item is its own scope.
      if (item.kind === 'repeat' && item.max !== 1) {
        checkCaptures(item.item, false, null)
        names = none
      } else if (item.kind === 'separatedBy') {
        checkCaptures(item.item, false, null)
        checkCaptures(item.separator, true, null)
        names = none
      } else names = checkCaptures(item, false, null)
      return addName(names, node.name)
    }
    case 'repeat':
      // At most one (`optional`, `times(1, …)`) is not a list: its captures are there or not.
      if (node.max === 1) return checkCaptures(node.item, inList, check)
      checkCaptures(node.item, true, check)
      return none
    case 'separatedBy':
      checkCaptures(node.item, true, check)
      checkCaptures(node.separator, true, check)
      return none
    case 'followedBy':
      checkCaptures(node.item, inList, 'followedBy()')
      return none
    case 'notFollowedBy':
      checkCaptures(node.item, inList, 'notFollowedBy()')
      return none
    case 'until':
      checkCaptures(node.item, inList, "until()'s stopping point")
      return none
    case 'sequence': {
      let names = none
      for (const item of node.items)
        for (const name of checkCaptures(item, inList, check)) names = addName(names, name)
      return names
    }
    case 'oneOf': {
      const names = new Set<string>()
      for (const option of node.options)
        for (const name of checkCaptures(option, inList, check)) names.add(name)
      return names
    }
    case 'describedAs':
      return checkCaptures(node.item, inList, check)
    default:
      return none
  }
}

function addName(names: Set<string>, name: string): Set<string> {
  if (names.has(name))
    throw new PatternError(
      `capture('${name}') appears twice where both would be recorded, so the second would overwrite the first: give them different names (or, if only one can match, put them in oneOf(…))`
    )
  return new Set(names).add(name)
}

const p = (node: Node) => new Pattern(node)

// ── Building ────────────────────────────────────────────────────────────────────────────────

/** Each piece in order: `sequence('$', oneOrMore(digit))`. */
export function sequence(...pieces: Piece[]): Pattern {
  if (pieces.length === 0) throw new PatternError('sequence(): give it at least one piece')
  const items = pieces.map((x, i) => toNode(x, `sequence() piece ${i + 1}`))
  return items.length === 1 ? p(items[0]!) : p({ kind: 'sequence', items })
}

/** The FIRST option that matches: `oneOf('yes', 'no')`. Order matters: put longer options first. */
export function oneOf(...options: Piece[]): Pattern {
  if (options.length < 2) throw new PatternError('oneOf(): give it at least two options')
  return p({ kind: 'oneOf', options: options.map((x, i) => toNode(x, `oneOf() option ${i + 1}`)) })
}

const repeat = (item: Piece, min: number, max: number | null, where: string) =>
  p({ kind: 'repeat', item: toNode(item, where), min, max })

/** `x?` */
export const optional = (item: Piece) => repeat(item, 0, 1, 'optional()')
/** `x*` */
export const zeroOrMore = (item: Piece) => repeat(item, 0, null, 'zeroOrMore()')
/** `x+` */
export const oneOrMore = (item: Piece) => repeat(item, 1, null, 'oneOrMore()')
/** `x{n}` */
export const times = (n: number, item: Piece) =>
  repeat(item, count(n, 'times()'), n, 'times()')
/** `x{n,}` */
export const atLeast = (n: number, item: Piece) =>
  repeat(item, count(n, 'atLeast()'), null, 'atLeast()')
/** `x{0,n}` */
export const atMost = (n: number, item: Piece) =>
  repeat(item, 0, count(n, 'atMost()'), 'atMost()')
/** `x{min,max}` */
export function between(min: number, max: number, item: Piece): Pattern {
  count(min, 'between()')
  count(max, 'between()')
  if (max < min) throw new PatternError(`between(${min}, ${max}): the maximum is below the minimum`)
  return repeat(item, min, max, 'between()')
}

/** Records what `item` matched under `name`: `capture('year', times(4, digit))`. */
export function capture(name: string, item: Piece): Pattern {
  if (typeof name !== 'string' || !isIdentifier(name))
    throw new PatternError(`capture(): a name is an identifier, got ${JSON.stringify(name)}`)
  return p({ kind: 'capture', name, item: toNode(item, `capture('${name}')`) })
}

/** Names a pattern for people: messages say `expected an identifier`, not its insides. */
export function describedAs(label: string, item: Piece): Pattern {
  return p({ kind: 'describedAs', label, item: toNode(item, 'describedAs()') })
}

/** Succeeds without consuming anything if `item` comes next: `(?=x)`. */
export const followedBy = (item: Piece) =>
  p({ kind: 'followedBy', item: toNode(item, 'followedBy()') })
/** Succeeds without consuming anything if `item` does not come next: `(?!x)`. */
export const notFollowedBy = (item: Piece) =>
  p({ kind: 'notFollowedBy', item: toNode(item, 'notFollowedBy()') })

/** Everything up to (not including) the first `item`: `until('-->')`. */
export const until = (item: Piece) => p({ kind: 'until', item: toNode(item, 'until()') })

/** The exact text, letters compared without regard to case. */
export function caseless(text: string): Pattern {
  if (!text) throw new PatternError('caseless(): give it some text')
  return p({ kind: 'literal', text, caseless: true })
}

/** The exact text. Plain strings already mean this; `literal` is for clarity. */
export const literal = (text: string) => p(toNode(text, 'literal()'))

/** One character in the range string: `charIn('a-f0-9')`. */
export function charIn(spec: string): Pattern {
  if (!spec) throw new PatternError('charIn(): give it at least one character')
  return p({ kind: 'chars', ranges: parseRangeString(spec), label: `one of ${spec}` })
}

/** One character NOT in the range string: `charNotIn(',\n')`. */
export function charNotIn(spec: string): Pattern {
  if (!spec) throw new PatternError('charNotIn(): give it at least one character')
  return p({
    kind: 'chars',
    ranges: parseRangeString(spec),
    negated: true,
    label: `anything but ${spec}`,
  })
}

/** A span opened and closed by `quote`: `quoted('"', { escape: '\\' })`. Its value is the inside. */
export function quoted(
  quote: string,
  options: { escape?: string | 'double' } = {}
): Pattern {
  if (!quote) throw new PatternError('quoted(): give it the quote character')
  return p({ kind: 'quoted', quote, escape: options.escape ?? null })
}

/**
 * A NESTED span that closes at its own `close`: `balanced('(', ')')` matches all of
 * `(a (b) c)`. Text inside any of `quotes` is skipped, so `f(")")` closes in the right place.
 * Its value is the inside. No regex can do this: balanced delimiters are not a regular language.
 */
export function balanced(
  open: string,
  close: string,
  options: { quotes?: string; escape?: string } = {}
): Pattern {
  if (!open || !close) throw new PatternError('balanced(): give it both delimiters')
  if (open === close)
    throw new PatternError('balanced(): open and close are the same; use quoted() for that')
  return p({
    kind: 'balanced',
    open,
    close,
    quotes: options.quotes ?? '',
    escape: options.escape ?? (options.quotes ? '\\' : null),
  })
}

/** Zero or more `item`s with `separator` between them: `separatedBy(field, ',')`. Its value is a list. */
export function separatedBy(
  item: Piece,
  separator: Piece,
  options: { atLeast?: number } = {}
): Pattern {
  return p({
    kind: 'separatedBy',
    item: toNode(item, 'separatedBy() item'),
    separator: toNode(separator, 'separatedBy() separator'),
    min: count(options.atLeast ?? 0, 'separatedBy() atLeast'),
  })
}

// ── Nouns ───────────────────────────────────────────────────────────────────────────────────

const noun = (ranges: Ranges, label: string, plural: string, negated = false) =>
  p({ kind: 'chars', ranges: normalize(ranges), label, plural, ...(negated ? { negated } : {}) })

/** 0-9 */
export const digit = noun([[48, 57]], 'a digit', 'digits')
/** 0-9, a-f, A-F */
export const hexDigit = noun(
  [
    [48, 57],
    [65, 70],
    [97, 102],
  ],
  'a hex digit',
  'hex digits'
)
/** a-z (ASCII). For other scripts' letters, see `letter`. */
export const lowercase = noun([[97, 122]], 'a lowercase letter', 'lowercase letters')
/** A-Z (ASCII). */
export const uppercase = noun([[65, 90]], 'an uppercase letter', 'uppercase letters')
/**
 * A-Z and a-z. ASCII only, deliberately, for now: Unicode letters need the Unicode tables as
 * data, which is an open decision (DECISIONS.md), not a RegExp `\p{L}` call.
 */
export const letter = noun(
  [
    [65, 90],
    [97, 122],
  ],
  'a letter',
  'letters'
)
/** A-Z, a-z, 0-9, _ (regex `\w`). */
export const wordChar = noun(
  [
    [48, 57],
    [65, 90],
    [95, 95],
    [97, 122],
  ],
  'a word character',
  'word characters'
)
/** Spaces, tabs, line breaks and the Unicode spaces (regex `\s`). */
export const whitespace = noun(WHITESPACE, 'whitespace', 'whitespace')
/** A space or a tab: whitespace that does not end a line. */
export const blank = noun(
  [
    [9, 9],
    [32, 32],
  ],
  'a space or tab',
  'spaces or tabs'
)
/** \n, \r\n or \r. */
export const lineBreak = describedAs('a line break', oneOf('\r\n', '\n', '\r'))
/** Any one character, line breaks included (unlike regex `.`). */
export const anyChar = p({ kind: 'anyChar' })
/** The start of the input (regex `^` without the m flag). */
export const start = p({ kind: 'start' })
/** The end of the input (regex `$` without the m flag). */
export const end = p({ kind: 'end' })
/** The start of a line. */
export const lineStart = p({ kind: 'lineStart' })
/** The end of a line (before \n or \r, or at the end). */
export const lineEnd = p({ kind: 'lineEnd' })
/** JSON's number grammar (`-1`, `1.5`, `1e5`; not `.5` or `+1`). Its value is a number. */
export const number = p({ kind: 'number' })
/** An optional minus and digits, no leading zeros. Its value is a number. */
export const integer = p({ kind: 'integer' })

export { expectation }
