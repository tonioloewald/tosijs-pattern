/**
 * The vocabulary, as a CHAIN. The test for every name is READ-ALOUD: a chain reads the way a
 * fluent engineer reads a clean regex aloud, in the order it matches, and it reads the same as
 * its `describe()`:
 *
 *   /^\d{3}-\d{4}$/     pattern.start().digits(3).text('-').digits(4).end()
 *   /[a-z]+/            pattern.lowercaseLetters()
 *   /(,\s*)?/           pattern.optional(pattern.text(',').optional(pattern.whitespace()))
 *
 * One import (`pattern`), and autocomplete lists the whole vocabulary. A singular noun is one
 * character (`digit()`), a plural one or more (`digits()`), or a count (`digits(3)`,
 * `digits(2, 4)`). Strings are literal text: there is nothing to escape, ever. `.as(name)`
 * captures the step before it. (There is no `then`: an object with a `then` method is taken
 * for a promise by `await`.)
 *
 * Patterns are immutable values. Every method returns a new one; none has a side effect.
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
import { toCode } from './code'

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
  if (isPattern(piece)) {
    if (!piece.steps.length) throw new PatternError(`${where}: the pattern is empty; give it a piece, e.g. pattern.digits()`)
    return piece.node
  }
  throw new PatternError(
    `${where}: expected a pattern or a string, got ${piece === null ? 'null' : typeof piece}${
      typeof piece === 'function' ? ' (write a chain, pattern.digits(), not a function)' : ''
    }`
  )
}

function count(n: unknown, where: string): number {
  if (typeof n !== 'number' || !Number.isInteger(n) || n < 0)
    throw new PatternError(`${where}: expected a whole number ≥ 0, got ${String(n)}`)
  return n
}

/**
 * A pattern, and the builder for the next one. Every vocabulary method returns a NEW pattern
 * with that piece added after this one's (patterns are immutable values), so a chain reads in
 * the order it matches:
 *
 *   pattern.start().digits(3).text('-').digits(4).end()
 *
 * Start a chain from `pattern`, the empty pattern; start a nested one (an argument) the same
 * way: `pattern.optional(pattern.text('.').digits())`.
 */
export class Pattern {
  /** The pieces in order: this pattern is their sequence. */
  readonly steps: readonly Node[]
  readonly #node: Node | null
  #checked = false

  constructor(steps: Node | readonly Node[]) {
    const list = Array.isArray(steps) ? [...steps] : [steps as Node]
    this.steps = freezeNode(list)
    this.#node =
      list.length === 0 ? null : list.length === 1 ? list[0]! : freezeNode({ kind: 'sequence', items: list })
    Object.freeze(this)
  }

  /** The pattern as one node (a sequence when it has several steps). */
  get node(): Node {
    if (!this.#node)
      throw new PatternError(
        'this pattern is empty: add a piece first, e.g. pattern.digits() or pattern.text("x")'
      )
    return this.#node
  }

  // ── Building: each method adds one piece after the ones so far ────────────────────────────

  #add(node: Node): Pattern {
    return new Pattern([...this.steps, node])
  }

  #nouns(name: NounName, where: string, min?: number, max?: number): Pattern {
    return this.#add(repeatNode(NOUNS[name], ...amount(where, min, max)))
  }

  /** The exact text, `.text('-')`. Nothing in it is special: there is nothing to escape. */
  text(text: string): Pattern {
    return this.#add(toNode(text, 'text()'))
  }
  /** The exact text, letters compared without regard to case: `.anyCase('yes')`. */
  anyCase(text: string): Pattern {
    if (typeof text !== 'string' || !text) throw new PatternError('anyCase(): give it some text')
    return this.#add({ kind: 'literal', text, caseless: true })
  }

  /** One digit, 0-9 (regex `\d`). */
  digit(): Pattern {
    return this.#add(NOUNS.digit)
  }
  /** Digits: one or more; `(3)` exactly 3; `(2, 4)` 2 to 4; `(2, Infinity)` at least 2. */
  digits(min?: number, max?: number): Pattern {
    return this.#nouns('digit', 'digits()', min, max)
  }
  /** One hex digit: 0-9, a-f, A-F. */
  hexDigit(): Pattern {
    return this.#add(NOUNS.hexDigit)
  }
  /** Hex digits: one or more, or a count (as `digits`). */
  hexDigits(min?: number, max?: number): Pattern {
    return this.#nouns('hexDigit', 'hexDigits()', min, max)
  }
  /** One letter, A-Z or a-z (ASCII for now: Unicode letters need the Unicode tables as data). */
  letter(): Pattern {
    return this.#add(NOUNS.letter)
  }
  /** Letters: one or more, or a count (as `digits`). */
  letters(min?: number, max?: number): Pattern {
    return this.#nouns('letter', 'letters()', min, max)
  }
  /** One lowercase letter, a-z. */
  lowercaseLetter(): Pattern {
    return this.#add(NOUNS.lowercaseLetter)
  }
  /** Lowercase letters: one or more, or a count (as `digits`). */
  lowercaseLetters(min?: number, max?: number): Pattern {
    return this.#nouns('lowercaseLetter', 'lowercaseLetters()', min, max)
  }
  /** One uppercase letter, A-Z. */
  uppercaseLetter(): Pattern {
    return this.#add(NOUNS.uppercaseLetter)
  }
  /** Uppercase letters: one or more, or a count (as `digits`). */
  uppercaseLetters(min?: number, max?: number): Pattern {
    return this.#nouns('uppercaseLetter', 'uppercaseLetters()', min, max)
  }
  /** One word character: A-Z, a-z, 0-9, _ (regex `\w`). */
  wordChar(): Pattern {
    return this.#add(NOUNS.wordChar)
  }
  /** Word characters: one or more, or a count (as `digits`). */
  wordChars(min?: number, max?: number): Pattern {
    return this.#nouns('wordChar', 'wordChars()', min, max)
  }
  /** Whitespace (regex `\s`): one or more characters of it, or a count (as `digits`). */
  whitespace(min?: number, max?: number): Pattern {
    return this.#nouns('whitespace', 'whitespace()', min, max)
  }
  /** One space or tab: whitespace that does not end a line. */
  blank(): Pattern {
    return this.#add(NOUNS.blank)
  }
  /** Spaces and tabs: one or more, or a count (as `digits`). */
  blanks(min?: number, max?: number): Pattern {
    return this.#nouns('blank', 'blanks()', min, max)
  }
  /** Any one character, line breaks included (unlike regex `.`). */
  anyChar(): Pattern {
    return this.#add(NOUNS.anyChar)
  }
  /** Any characters: one or more, or a count (as `digits`). To stop somewhere, use `until`. */
  anyChars(min?: number, max?: number): Pattern {
    return this.#nouns('anyChar', 'anyChars()', min, max)
  }
  /** One line break: \r\n, \n or \r. */
  lineBreak(): Pattern {
    return this.#add(NOUNS.lineBreak)
  }
  /** Line breaks: one or more, or a count (as `digits`). */
  lineBreaks(min?: number, max?: number): Pattern {
    return this.#nouns('lineBreak', 'lineBreaks()', min, max)
  }
  /** One character in the range string: `.charIn('a-f0-9')`. */
  charIn(spec: string): Pattern {
    return this.#add(charsNode(spec, false, 'charIn()'))
  }
  /** Characters in the range string: one or more, or a count: `.charsIn('a-f0-9', 6)`. */
  charsIn(spec: string, min?: number, max?: number): Pattern {
    return this.#add(repeatNode(charsNode(spec, false, 'charsIn()'), ...amount('charsIn()', min, max)))
  }
  /** One character NOT in the range string: `.charNotIn(',\n')`. */
  charNotIn(spec: string): Pattern {
    return this.#add(charsNode(spec, true, 'charNotIn()'))
  }
  /** Characters not in the range string: one or more, or a count: `.charsNotIn(',\n')`. */
  charsNotIn(spec: string, min?: number, max?: number): Pattern {
    return this.#add(repeatNode(charsNode(spec, true, 'charsNotIn()'), ...amount('charsNotIn()', min, max)))
  }

  /** The start of the input (regex `^` without the m flag). */
  start(): Pattern {
    return this.#add({ kind: 'start' })
  }
  /** The end of the input (regex `$` without the m flag). */
  end(): Pattern {
    return this.#add({ kind: 'end' })
  }
  /** The start of a line. */
  lineStart(): Pattern {
    return this.#add({ kind: 'lineStart' })
  }
  /** The end of a line (before \n or \r, or at the end). */
  lineEnd(): Pattern {
    return this.#add({ kind: 'lineEnd' })
  }
  /** Matches nothing, and succeeds only if `next` comes next: regex `(?=x)`. */
  ifFollowedBy(next: Piece): Pattern {
    return this.#add({ kind: 'followedBy', item: toNode(next, 'ifFollowedBy()') })
  }
  /** Matches nothing, and succeeds only if `next` does NOT come next: regex `(?!x)`. */
  ifNotFollowedBy(next: Piece): Pattern {
    return this.#add({ kind: 'notFollowedBy', item: toNode(next, 'ifNotFollowedBy()') })
  }

  /** The FIRST option that matches: `.oneOf('yes', 'no')`. Order matters: put longer options first. */
  oneOf(...options: Piece[]): Pattern {
    if (options.length < 2) throw new PatternError('oneOf(): give it at least two options')
    return this.#add({ kind: 'oneOf', options: options.map((x, i) => toNode(x, `oneOf() option ${i + 1}`)) })
  }
  /** The piece, or nothing (regex `x?`). */
  optional(piece: Piece): Pattern {
    return this.#add(repeatNode(toNode(piece, 'optional()'), 0, 1))
  }
  /** The piece, as many times as it matches, at least once (regex `x+`). */
  oneOrMore(piece: Piece): Pattern {
    return this.#add(repeatNode(toNode(piece, 'oneOrMore()'), 1, null))
  }
  /** The piece, as many times as it matches, possibly none (regex `x*`). */
  zeroOrMore(piece: Piece): Pattern {
    return this.#add(repeatNode(toNode(piece, 'zeroOrMore()'), 0, null))
  }
  /** The piece exactly `min` times, or `min` to `max` times (`Infinity`: no limit). */
  repeat(piece: Piece, min: number, max?: number): Pattern {
    if (min === undefined) throw new PatternError('repeat(): say how many times, e.g. repeat(x, 3)')
    return this.#add(repeatNode(toNode(piece, 'repeat()'), ...amount('repeat()', min, max ?? min)))
  }
  /** A pattern as ONE step, so `.as()` or `.describedAs()` after it applies to all of it. */
  group(piece: Piece): Pattern {
    return this.#add(toNode(piece, 'group()'))
  }

  /**
   * Begins a pattern by skipping to the first `target`; the match starts THERE (the skipped
   * text is consumed, not matched): `pattern.startAt('# ').restOfLine()`.
   */
  startAt(target: Piece): Pattern {
    return this.#skip(target, false, 'startAt()')
  }
  /**
   * Begins a pattern by skipping past the first `target`; the match starts after it:
   * `pattern.startAfter(pattern.lineBreak()).lines(rows)` is the rows after a header line, and
   * its value is the rows. With `findAll`, `pattern.startAfter('$').number()` finds the numbers
   * after each `$`, without the `$`.
   */
  startAfter(target: Piece): Pattern {
    return this.#skip(target, true, 'startAfter()')
  }
  #skip(target: Piece, after: boolean, where: string): Pattern {
    if (this.steps.length)
      throw new PatternError(`${where} begins a pattern: write pattern.${where.slice(0, -2)}(…) first, then the rest`)
    return this.#add({ kind: 'startAt', item: toNode(target, where), ...(after ? { after } : {}) })
  }

  /** Everything up to (not including) the first `stop`: `.until('-->')`. */
  until(stop: Piece): Pattern {
    return this.#add({ kind: 'until', item: toNode(stop, 'until()') })
  }
  /** A span opened and closed by `quote`: `.quoted('"', { escape: '\\' })`. Its value is the inside. */
  quoted(quote: string, options: { escape?: string | 'double' } = {}): Pattern {
    if (!quote) throw new PatternError('quoted(): give it the quote character')
    return this.#add({ kind: 'quoted', quote, escape: options.escape ?? null })
  }
  /**
   * A NESTED span that closes at its own `close`: `.balanced('(', ')')` matches all of
   * `(a (b) c)`. Text inside any of `quotes` is skipped, so `f(")")` closes in the right place.
   * Its value is the inside. No regex can do this: balanced delimiters are not a regular language.
   */
  balanced(open: string, close: string, options: { quotes?: string; escape?: string } = {}): Pattern {
    if (!open || !close) throw new PatternError('balanced(): give it both delimiters')
    if (open === close) throw new PatternError('balanced(): open and close are the same; use quoted() for that')
    return this.#add({
      kind: 'balanced',
      open,
      close,
      quotes: options.quotes ?? '',
      escape: options.escape ?? (options.quotes ? '\\' : null),
    })
  }
  /** Zero or more items with a separator between them: `.listOf(field, { separatedBy: ',' })`. Its value is a list. */
  listOf(item: Piece, options: { separatedBy: Piece; atLeast?: number; trailing?: boolean }): Pattern {
    if (!options || options.separatedBy === undefined)
      throw new PatternError("listOf(): say what separates the items, e.g. listOf(x, { separatedBy: ',' })")
    return this.#add({
      kind: 'separatedBy',
      item: toNode(item, 'listOf() item'),
      separator: toNode(options.separatedBy, 'listOf() separatedBy'),
      min: count(options.atLeast ?? 0, 'listOf() atLeast'),
      ...(options.trailing ? { trailing: true } : {}),
    })
  }
  /**
   * One `row` per line, and a final line break allowed: `.lines(pattern.columns({ name: 10 }))`.
   * With no row, each line's text. Its value is the list of rows.
   */
  lines(row: Piece = pattern.restOfLine()): Pattern {
    return this.#add({
      kind: 'separatedBy',
      item: toNode(row, 'lines()'),
      separator: NOUNS.lineBreak,
      min: 0,
      trailing: true,
    })
  }
  /**
   * One row of named columns, in order, never crossing a line break. Its value is the row,
   * `{ name: … }`.
   *
   *   .columns([{ name: 'name', width: 10 }, { name: 'qty', width: 6 }])   fixed width; trimmed
   *   .columns(['name', 'qty'], { separatedBy: '\t' })                     delimited; as written
   *
   * A fixed-width line may end early (editors strip trailing spaces): the columns left are short
   * or empty. An empty line is not a row.
   */
  columns(columns: { name: string; width: number }[]): Pattern
  columns(names: string[], options: { separatedBy: Piece }): Pattern
  columns(spec: { name: string; width: number }[] | string[], options?: { separatedBy: Piece }): Pattern {
    const where = 'columns()'
    const checkNames = (names: string[]) => {
      if (!names.length) throw new PatternError(`${where}: name at least one column`)
      for (const n of names)
        if (typeof n !== 'string' || !isIdentifier(n))
          throw new PatternError(`${where}: a column name is an identifier (not __proto__), got ${JSON.stringify(n)}`)
      if (new Set(names).size !== names.length) throw new PatternError(`${where}: a column name appears twice`)
      return [...names]
    }
    const usage = "give [{ name: 'a', width: 10 }, …] (fixed width) or (['a', …], { separatedBy: ',' }) (delimited)"
    if (!Array.isArray(spec) || !spec.length) throw new PatternError(`${where}: ${usage}`)
    if (spec.every((c) => typeof c === 'string')) {
      if (!options || options.separatedBy === undefined)
        throw new PatternError(`${where}: say what separates the columns, e.g. columns(['a', 'b'], { separatedBy: ',' })`)
      return this.#add({
        kind: 'columns',
        names: checkNames(spec as string[]),
        widths: null,
        separator: toNode(options.separatedBy, `${where} separatedBy`),
      })
    }
    if (options !== undefined)
      throw new PatternError(`${where}: fixed-width columns have no separator; ${usage}`)
    const cols = spec.map((c, i) => {
      if (!c || typeof c !== 'object') throw new PatternError(`${where} column ${i + 1}: ${usage}`)
      const { name, width } = c as { name: unknown; width: unknown }
      if (typeof width !== 'number' || !Number.isInteger(width) || width < 1)
        throw new PatternError(`${where} column ${i + 1}: width is a whole number > 0, got ${String(width)}`)
      return { name: name as string, width }
    })
    return this.#add({ kind: 'columns', names: checkNames(cols.map((c) => c.name)), widths: cols.map((c) => c.width), separator: null })
  }
  /** Everything from here to the end of the line, possibly nothing (regex `.*` without the s flag). */
  restOfLine(): Pattern {
    return this.#add(REST_OF_LINE)
  }
  /**
   * At the end of a line, the lines after it indented DEEPER than it: a Python body, a Markdown
   * list item's continuation. Blank lines between them belong to it; it stops before the first
   * line indented the same or less. Its value is the lines with their common indentation
   * removed, so a captured block can be parsed again:
   * `pattern.text('def ').restOfLine().indentedBlock().as('body')`.
   */
  indentedBlock(): Pattern {
    return this.#add({ kind: 'indentedBlock' })
  }
  /** JSON's number grammar (`-1`, `1.5`, `1e5`; not `.5` or `+1`). Its value is a number. */
  number(): Pattern {
    return this.#add({ kind: 'number' })
  }
  /** An optional minus and digits, no leading zeros. Its value is a number. */
  integer(): Pattern {
    return this.#add({ kind: 'integer' })
  }

  /** Records what the step just before matched, under `name`: `.digits(4).as('year')`. */
  as(name: string): Pattern {
    if (typeof name !== 'string' || !isIdentifier(name))
      throw new PatternError(`as(): a name is an identifier (not __proto__), got ${JSON.stringify(name)}`)
    const last = this.steps.at(-1)
    if (!last) throw new PatternError(`as('${name}'): there is nothing before it to name`)
    return new Pattern([...this.steps.slice(0, -1), { kind: 'capture', name, item: last }])
  }
  /** Names this WHOLE pattern for people: messages say `expected an identifier`, not its insides. */
  describedAs(label: string): Pattern {
    if (typeof label !== 'string' || !label) throw new PatternError('describedAs(): give it a label')
    return new Pattern({ kind: 'describedAs', label, item: this.node })
  }

  // ── Using ─────────────────────────────────────────────────────────────────────────────────

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
          text: input.slice(hit.start ?? at, hit.end),
          start: hit.start ?? at,
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
        text: input.slice(hit.start ?? at, hit.end),
        start: hit.start ?? at,
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

  /** The pattern as the chain that builds it: `pattern.digits(3).text('-')`. Pasting it gives this pattern. */
  toCode(): string {
    return this.steps.length ? toCode(this.node, NOUNS, { restOfLine: REST_OF_LINE }) : 'pattern'
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
    checkSkips(this.node)
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
      if (!Object.hasOwn(m.texts, name))
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
 * `pattern.digit().as('a').letter().as('a')`, or a capture around one with its own name.
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
          `.as('${node.name}') is inside ${check}, which keeps nothing of what it matched: there is nothing to capture`
        )
      if (inList)
        throw new PatternError(
          `.as('${node.name}') is inside a repetition or list, so each item gets one: capture the repetition to collect them, e.g. pattern.oneOrMore(…).as('${node.name}s')`
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
      // At most one (`optional`, `repeat(x, 1)`) is not a list: its captures are there or not.
      if (node.max === 1) return checkCaptures(node.item, inList, check)
      checkCaptures(node.item, true, check)
      return none
    case 'separatedBy':
      checkCaptures(node.item, true, check)
      checkCaptures(node.separator, true, check)
      return none
    case 'followedBy':
      checkCaptures(node.item, inList, 'ifFollowedBy()')
      return none
    case 'notFollowedBy':
      checkCaptures(node.item, inList, 'ifNotFollowedBy()')
      return none
    case 'until':
      checkCaptures(node.item, inList, "until()'s stopping point")
      return none
    case 'startAt':
      checkCaptures(node.item, inList, `${node.after ? 'startAfter' : 'startAt'}()'s target, which is skipped`)
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
    case 'columns':
      // A row's value is its columns; whatever the separator matched is not kept.
      if (node.separator) checkCaptures(node.separator, inList, "columns()'s separator")
      return none
    default:
      return none
  }
}

/**
 * A skip (`startAt`/`startAfter`) moves where the WHOLE match begins, so it is only meaningful as
 * a pattern's first step. Anywhere else (inside `oneOf`, a repetition, a nested chain used
 * later) it would silently mean something else, so it is an error.
 */
function checkSkips(node: Node): void {
  const visit = (n: Node, first: boolean) => {
    if (n.kind === 'startAt' && !first)
      throw new PatternError(
        `${n.after ? 'startAfter' : 'startAt'}() is only a pattern's first step: it says where the whole match begins`
      )
    if (n.kind === 'sequence') n.items.forEach((x, i) => visit(x, first && i === 0))
    // A label or a capture around the whole pattern does not move where it begins.
    else if (n.kind === 'describedAs' || n.kind === 'capture') visit(n.item, first)
    else if (n.kind === 'columns') n.separator && visit(n.separator, false)
    else
      for (const v of Object.values(n))
        if (v && typeof v === 'object' && 'kind' in (v as object)) visit(v as Node, false)
        else if (Array.isArray(v)) v.forEach((x) => x && typeof x === 'object' && 'kind' in x && visit(x as Node, false))
  }
  visit(node, true)
}

function addName(names: Set<string>, name: string): Set<string> {
  if (names.has(name))
    throw new PatternError(
      `.as('${name}') appears twice where both would be recorded, so the second would overwrite the first: give them different names (or, if only one can match, put them in .oneOf(…))`
    )
  return new Set(names).add(name)
}


// ── The pieces the chain is made of ─────────────────────────────────────────────────────────

/** `(min?, max?)` as the plural nouns read it: none is one or more, `(n)` exactly n, `(m, n)` m to n. */
function amount(where: string, min?: number, max?: number): [number, number | null] {
  if (min === undefined) {
    if (max !== undefined) throw new PatternError(`${where}: give the minimum before the maximum`)
    return [1, null]
  }
  count(min, where)
  if (max === undefined) return [min, min]
  if (max === Infinity) return [min, null]
  count(max, where)
  if (max < min) throw new PatternError(`${where}: the maximum (${max}) is below the minimum (${min})`)
  return [min, max]
}

const repeatNode = (item: Node, min: number, max: number | null): Node => ({ kind: 'repeat', item, min, max })

function charsNode(spec: string, negated: boolean, where: string): Node {
  if (typeof spec !== 'string' || !spec) throw new PatternError(`${where}: give it at least one character`)
  return {
    kind: 'chars',
    ranges: parseRangeString(spec),
    ...(negated ? { negated } : {}),
    label: negated ? `anything but ${spec}` : `one of ${spec}`,
    // The author's spelling, for `charsIn('a-z0-9')` read aloud (not the sorted `0-9a-z`).
    plural: negated ? `characters not in ${spec}` : `characters in ${spec}`,
  }
}

const noun = (ranges: Ranges, label: string, plural: string): Node =>
  freezeNode({ kind: 'chars', ranges: normalize(ranges), label, plural })

/** The named characters, as nodes. The translator matches regex classes against these. */
export const NOUNS = {
  digit: noun([[48, 57]], 'a digit', 'digits'),
  hexDigit: noun([[48, 57], [65, 70], [97, 102]], 'a hex digit', 'hex digits'),
  letter: noun([[65, 90], [97, 122]], 'a letter', 'letters'),
  lowercaseLetter: noun([[97, 122]], 'a lowercase letter', 'lowercase letters'),
  uppercaseLetter: noun([[65, 90]], 'an uppercase letter', 'uppercase letters'),
  wordChar: noun([[48, 57], [65, 90], [95, 95], [97, 122]], 'a word character', 'word characters'),
  whitespace: noun(WHITESPACE, 'whitespace', 'whitespace'),
  blank: noun([[9, 9], [32, 32]], 'a space or tab', 'spaces or tabs'),
  anyChar: freezeNode({ kind: 'anyChar' } as Node),
  lineBreak: freezeNode({
    kind: 'describedAs',
    label: 'a line break',
    item: {
      kind: 'oneOf',
      options: [
        { kind: 'literal', text: '\r\n' },
        { kind: 'literal', text: '\n' },
        { kind: 'literal', text: '\r' },
      ],
    },
  } as Node),
} satisfies Record<string, Node>

type NounName = keyof typeof NOUNS

/** `restOfLine()`: any characters but a line break, read aloud as what it is. */
export const REST_OF_LINE: Node = freezeNode({
  kind: 'describedAs',
  label: 'the rest of the line',
  item: { kind: 'repeat', item: { kind: 'chars', ranges: [[10, 10], [13, 13]], negated: true }, min: 0, max: null },
} as Node)

/**
 * The empty pattern: where every chain starts. `pattern.digits(3)` is three digits; nest a
 * chain the same way, `pattern.optional(pattern.text('.').digits())`.
 */
export const pattern = new Pattern([])

export { expectation }
