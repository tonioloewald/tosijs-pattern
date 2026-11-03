/**
 * The engine: a PEG interpreter over the node tree.
 *
 * Semantics, stated plainly (see DECISIONS.md):
 *   - `oneOf` is ORDERED: the first option that matches wins, and the others are never tried
 *     after it, even if the rest of the pattern then fails.
 *   - Repetition is POSSESSIVE: it takes as many as it can and never gives any back. So
 *     `pattern.digits().text('5')` never matches `"1235"`: the digits took the 5.
 *   - Nothing backtracks except inside one `oneOf` (trying the next option) and the zero-width
 *     checks. That is what makes a pattern's cost readable from its shape.
 *
 * Every node visit and every character a loop consumes is one STEP, counted against a budget.
 * Exceeding it throws `PatternBudgetError`: a pattern's worst case is bounded by the caller,
 * not discovered by them.
 */
import type { Node } from './nodes'
import { inRanges } from './chars'

export type Captures = Record<string, unknown>

/** What a node matched: where it ended, what it captured, and its value. */
export interface Hit {
  end: number
  caps: Captures | null
  /** Each capture's matched TEXT, by name (`caps` holds its value). Absent where `caps` is null. */
  texts?: Texts | null
  value: unknown
}

export type Texts = Record<string, string>

export class PatternBudgetError extends Error {
  readonly steps: number
  constructor(steps: number) {
    super(
      `pattern exceeded its step budget (${steps} steps). Raise maxSteps, or narrow the pattern.`
    )
    this.name = 'PatternBudgetError'
    this.steps = steps
  }
}

export interface Context {
  input: string
  steps: number
  maxSteps: number
  /** The farthest position any primitive failed at, and what it expected there. */
  farthest: number
  expected: Set<string>
  /** > 0 inside a zero-width check, whose failures are not the user's errors. */
  quiet: number
}

export function context(input: string, maxSteps: number): Context {
  return {
    input,
    steps: 0,
    maxSteps,
    farthest: -1,
    expected: new Set(),
    quiet: 0,
  }
}

const step = (ctx: Context, n = 1) => {
  ctx.steps += n
  if (ctx.steps > ctx.maxSteps) throw new PatternBudgetError(ctx.steps)
}

function fail(ctx: Context, at: number, what: string): null {
  if (ctx.quiet) return null
  if (at > ctx.farthest) {
    ctx.farthest = at
    ctx.expected = new Set([what])
  } else if (at === ctx.farthest) ctx.expected.add(what)
  return null
}

const merge = (a: Captures | null, b: Captures | null): Captures | null =>
  !a ? b : !b ? a : { ...a, ...b }

/** The code point at `pos` and how many UTF-16 units it takes. */
function charAt(input: string, pos: number): [number, number] | null {
  if (pos >= input.length) return null
  const cp = input.codePointAt(pos)!
  return [cp, cp > 0xffff ? 2 : 1]
}

/** A label for a node in "expected …" messages. */
export function expectation(node: Node): string {
  switch (node.kind) {
    case 'literal':
      return JSON.stringify(node.text)
    case 'chars':
      return node.label ?? 'a matching character'
    case 'anyChar':
      return 'any character'
    case 'describedAs':
      return node.label
    case 'number':
      return 'a number'
    case 'integer':
      return 'an integer'
    case 'indentedBlock':
      return 'an indented block'
    case 'end':
      return 'the end of the input'
    case 'lineEnd':
      return 'the end of a line'
    case 'start':
      return 'the start of the input'
    case 'lineStart':
      return 'the start of a line'
    case 'quoted':
      return `a ${node.quote}-quoted string`
    case 'balanced':
      return `a balanced ${node.open}…${node.close}`
    default:
      return node.kind
  }
}

/** Is `text` at `pos`? */
function hasText(ctx: Context, text: string, pos: number): boolean {
  step(ctx, text.length)
  return ctx.input.startsWith(text, pos)
}

const isDigit = (c: number) => c >= 48 && c <= 57

export function match(node: Node, ctx: Context, pos: number): Hit | null {
  step(ctx)
  const input = ctx.input
  switch (node.kind) {
    case 'literal': {
      const t = node.text
      step(ctx, t.length)
      const got = input.slice(pos, pos + t.length)
      const ok = node.caseless
        ? got.toLowerCase() === t.toLowerCase()
        : got === t
      return ok
        ? { end: pos + t.length, caps: null, value: got }
        : fail(ctx, pos, expectation(node))
    }
    case 'chars': {
      const c = charAt(input, pos)
      if (!c || inRanges(node.ranges, c[0]) === !!node.negated)
        return fail(ctx, pos, expectation(node))
      return {
        end: pos + c[1],
        caps: null,
        value: input.slice(pos, pos + c[1]),
      }
    }
    case 'anyChar': {
      const c = charAt(input, pos)
      if (!c) return fail(ctx, pos, 'any character')
      return {
        end: pos + c[1],
        caps: null,
        value: input.slice(pos, pos + c[1]),
      }
    }
    case 'sequence': {
      let at = pos
      let caps: Captures | null = null
      let texts: Texts | null = null
      for (const item of node.items) {
        const h = match(item, ctx, at)
        if (!h) return null
        at = h.end
        caps = merge(caps, h.caps)
        texts = merge(texts, h.texts ?? null) as Texts | null
      }
      return { end: at, caps, texts, value: input.slice(pos, at) }
    }
    case 'oneOf': {
      for (const option of node.options) {
        const h = match(option, ctx, pos)
        if (h) return h
      }
      return null
    }
    case 'repeat': {
      let at = pos
      let count = 0
      const items: unknown[] = []
      let hasCaps = false
      let lastCaps: Captures | null = null
      let lastTexts: Texts | null = null
      while (node.max === null || count < node.max) {
        const h = match(node.item, ctx, at)
        if (!h) break
        count++
        if (h.caps) hasCaps = true
        lastCaps = h.caps
        lastTexts = h.texts ?? null
        items.push(h.caps ?? h.value)
        if (h.end === at) {
          // A zero-width item would repeat forever; one empty match stands for the rest.
          if (count < node.min) count = node.min
          break
        }
        at = h.end
      }
      if (count < node.min) return null
      // At most one is not a list: an optional item's captures pass straight through.
      if (node.max === 1)
        return { end: at, caps: lastCaps, texts: lastTexts, value: input.slice(pos, at) }
      // Text, unless the items captured: then the list of their captures (see DECISIONS.md).
      return { end: at, caps: null, value: hasCaps ? items : input.slice(pos, at) }
    }
    case 'followedBy': {
      ctx.quiet++
      const h = match(node.item, ctx, pos)
      ctx.quiet--
      return h
        ? { end: pos, caps: null, value: '' }
        : fail(ctx, pos, expectation(node.item))
    }
    case 'notFollowedBy': {
      ctx.quiet++
      const h = match(node.item, ctx, pos)
      ctx.quiet--
      return h
        ? fail(ctx, pos, `not ${expectation(node.item)}`)
        : { end: pos, caps: null, value: '' }
    }
    case 'capture': {
      const h = match(node.item, ctx, pos)
      if (!h) return null
      return {
        end: h.end,
        caps: merge(h.caps, { [node.name]: h.value }),
        texts: merge(h.texts ?? null, { [node.name]: input.slice(pos, h.end) }) as Texts,
        value: h.value,
      }
    }
    case 'describedAs': {
      // Failures inside are reported as the label, at this position.
      const before = ctx.farthest
      ctx.quiet++
      const h = match(node.item, ctx, pos)
      ctx.quiet--
      if (h) return h
      if (ctx.farthest === before) fail(ctx, pos, node.label)
      return null
    }
    case 'start':
      return pos === 0
        ? { end: pos, caps: null, value: '' }
        : fail(ctx, pos, expectation(node))
    case 'end':
      return pos === input.length
        ? { end: pos, caps: null, value: '' }
        : fail(ctx, pos, expectation(node))
    // A line break is \r\n, \n or \r, the same three `lineBreak` matches, and never the middle of
    // a \r\n: so a file's lines are the same whichever convention wrote it.
    case 'lineStart':
      return pos === 0 || input[pos - 1] === '\n' || (input[pos - 1] === '\r' && input[pos] !== '\n')
        ? { end: pos, caps: null, value: '' }
        : fail(ctx, pos, expectation(node))
    case 'lineEnd':
      return pos === input.length || input[pos] === '\r' || (input[pos] === '\n' && input[pos - 1] !== '\r')
        ? { end: pos, caps: null, value: '' }
        : fail(ctx, pos, expectation(node))
    case 'until': {
      ctx.quiet++
      try {
        for (let at = pos; at <= input.length; at++) {
          step(ctx)
          if (match(node.item, ctx, at))
            return { end: at, caps: null, value: input.slice(pos, at) }
        }
      } finally {
        ctx.quiet--
      }
      return fail(ctx, input.length, expectation(node.item))
    }
    case 'quoted': {
      const q = node.quote
      if (!hasText(ctx, q, pos)) return fail(ctx, pos, expectation(node))
      let at = pos + q.length
      let inner = ''
      while (at < input.length) {
        step(ctx)
        const esc = node.escape
        if (esc && esc !== 'double' && input.startsWith(esc, at)) {
          // An escape keeps the character after it literally; only the escape before a quote
          // or another escape is removed (`\"` → `"`, `\\` → `\`; `\n` stays `\n`).
          const next = input.slice(at + esc.length, at + esc.length + 1)
          inner += next === q[0] || next === esc[0] ? next : esc + next
          at += esc.length + next.length
          continue
        }
        if (input.startsWith(q, at)) {
          if (esc === 'double' && input.startsWith(q, at + q.length)) {
            inner += q
            at += 2 * q.length
            continue
          }
          return { end: at + q.length, caps: null, value: inner }
        }
        inner += input[at]
        at++
      }
      return fail(ctx, at, `a closing ${q}`)
    }
    case 'balanced': {
      const { open, close, quotes, escape } = node
      if (!hasText(ctx, open, pos)) return fail(ctx, pos, expectation(node))
      let at = pos + open.length
      let depth = 1
      while (at < input.length) {
        step(ctx)
        const ch = input[at]!
        if (quotes.includes(ch)) {
          // Skip the quoted text whole, so a delimiter inside it does not count.
          at++
          while (at < input.length && input[at] !== ch) {
            step(ctx)
            at += escape && input.startsWith(escape, at) ? escape.length + 1 : 1
          }
          at++
          continue
        }
        if (input.startsWith(close, at)) {
          depth--
          at += close.length
          if (depth === 0)
            return {
              end: at,
              caps: null,
              value: input.slice(pos + open.length, at - close.length),
            }
          continue
        }
        if (input.startsWith(open, at)) {
          depth++
          at += open.length
          continue
        }
        at++
      }
      return fail(ctx, at, `a closing ${close}`)
    }
    case 'separatedBy': {
      const items: unknown[] = []
      let at = pos
      const first = match(node.item, ctx, at)
      if (first) {
        items.push(first.caps ?? first.value)
        at = first.end
        for (;;) {
          const sep = match(node.separator, ctx, at)
          if (!sep) break
          const next = match(node.item, ctx, sep.end)
          if (!next) break // the separator is not consumed without an item after it
          items.push(next.caps ?? next.value)
          if (next.end === at) break
          at = next.end
        }
      }
      if (items.length < node.min) return null
      return { end: at, caps: null, value: items }
    }
    case 'indentedBlock': {
      // Only at the end of a line: the block is the lines AFTER this one.
      const lineBreakAt = (at: number) =>
        input.startsWith('\r\n', at) ? 2 : input[at] === '\n' || input[at] === '\r' ? 1 : 0
      if (!lineBreakAt(pos) || (input[pos] === '\n' && input[pos - 1] === '\r'))
        return fail(ctx, pos, expectation(node))
      let lineStart = pos
      while (lineStart > 0 && input[lineStart - 1] !== '\n' && input[lineStart - 1] !== '\r') {
        step(ctx)
        lineStart--
      }
      const indentOf = (from: number, to: number) => {
        let at = from
        while (at < to && (input[at] === ' ' || input[at] === '\t')) at++
        return at
      }
      const head = input.slice(lineStart, indentOf(lineStart, pos))
      // Deeper means: this line's indentation starts with the header's and is longer. Tabs and
      // spaces mixed so that neither is a prefix of the other are not deeper: the block ends.
      const lines: [number, number][] = []
      let blanks: [number, number][] = []
      let end = -1
      for (let at = pos; at < input.length; ) {
        const br = lineBreakAt(at)
        if (!br) break
        const from = at + br
        let to = from
        while (to < input.length && input[to] !== '\n' && input[to] !== '\r') {
          step(ctx)
          to++
        }
        const text = indentOf(from, to)
        at = to
        if (text === to) {
          blanks.push([from, to]) // blank: in the block only if a deeper line follows
          continue
        }
        const indent = input.slice(from, text)
        if (!(indent.length > head.length && indent.startsWith(head))) break
        lines.push(...blanks, [from, to])
        blanks = []
        end = to
      }
      if (end < 0) return fail(ctx, pos, expectation(node))
      // The value is the lines with their common indentation removed, so it can be parsed again.
      const texts = lines.map(([a, b]) => input.slice(a, b))
      let common: string | null = null
      for (const t of texts) {
        if (!t.trim()) continue
        const indent = t.slice(0, t.length - t.trimStart().length)
        if (common === null) common = indent
        else {
          let k = 0
          while (k < common.length && k < indent.length && common[k] === indent[k]) k++
          common = common.slice(0, k)
        }
      }
      const cut = (common ?? '').length
      return { end, caps: null, value: texts.map((t) => (t.trim() ? t.slice(cut) : '')).join('\n') }
    }
    case 'number':
    case 'integer': {
      // JSON's grammar: -? (0 | [1-9][0-9]*) (. [0-9]+)? ([eE] [+-]? [0-9]+)?
      let at = pos
      if (input[at] === '-') at++
      const intStart = at
      if (input[at] === '0') at++
      else while (at < input.length && isDigit(input.charCodeAt(at))) at++
      if (at === intStart) return fail(ctx, pos, expectation(node))
      if (node.kind === 'number') {
        if (input[at] === '.' && isDigit(input.charCodeAt(at + 1))) {
          at++
          while (isDigit(input.charCodeAt(at))) at++
        }
        if (input[at] === 'e' || input[at] === 'E') {
          let e = at + 1
          if (input[e] === '+' || input[e] === '-') e++
          if (isDigit(input.charCodeAt(e))) {
            while (isDigit(input.charCodeAt(e))) e++
            at = e
          }
        }
      }
      step(ctx, at - pos)
      const text = input.slice(pos, at)
      return { end: at, caps: null, value: Number(text) }
    }
  }
}
