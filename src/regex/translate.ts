/**
 * `fromRegex()`: a regex in, an EQUIVALENT pattern out, or a refusal that says why.
 *
 * A regex backtracks; a pattern does not. The two agree exactly when backtracking could never
 * change the outcome, and the translator PROVES that, site by site, before it translates:
 *
 *   - A repetition is possessive here. That agrees with a greedy regex when what can follow the
 *     repetition never starts with a character the repeated item could start with: then giving
 *     an item back could never let the rest match. (`\d+-` agrees; `\d+5` does not.)
 *   - `oneOf` takes the first option that matches. That agrees with `|` when no two options can
 *     start with the same character (and an option that can match nothing comes last).
 *   - Either check passes trivially when NOTHING that follows can fail: a search (`find`) ends
 *     as soon as the regex does, so at the end of the regex the first success is the final one.
 *   - A lazy `C*?` followed by the rest R becomes `until(oneOf(R, not C))` then R: the first
 *     place R matches, as the regex finds it by trying the shortest first.
 *
 * What fails a check is refused with a `RegexRefusal`: its `code` (counted by the report), where
 * in the source, and what to write instead. A silent wrong answer is the worst outcome here, so
 * the translator says no rather than guess; the differential tests are the evidence it is right.
 *
 * The result has the regex's SEARCH semantics: use it with `find`, `findAll`, `replaceAll`,
 * `split`, `occursIn` (a `^…$` regex also works with `matches`). Unnamed groups capture as
 * `$1`, `$2`, …; named groups by their name. Pattern reads code points: a regex without the `u`
 * flag reads UTF-16 units, so the two can differ on characters beyond the BMP (emoji), and
 * nowhere else.
 */
import type { Node, Ranges } from '../nodes'
import { complement, intersect, union, sameRanges, rangeString } from '../chars'
import { Pattern, NOUNS } from '../pattern'
import { parseRegex, RegexRefusal, type RNode } from './parse'

export { RegexRefusal, type RefusalCode } from './parse'

/** A regex value or its source; `flags` applies to a source string. */
export function fromRegex(regex: { source: string; flags: string } | string, flags = ''): Pattern {
  const source = typeof regex === 'string' ? regex : regex.source
  const flagString = typeof regex === 'string' ? flags : regex.flags
  const { ast } = parseRegex(source, flagString)
  const node = new Translator(source).translate(ast, ACCEPT, false)
  return new Pattern(node)
}

/**
 * What can come next: the characters the rest of the match can start with, whether it can
 * succeed at the end of the input, and whether it ALWAYS succeeds (nothing left that can fail).
 * Sets may be too big (that only refuses more), never too small.
 */
interface Next {
  chars: Ranges
  end: boolean
  always: boolean
}

const ALL: Ranges = [[0, 0x10ffff]]
/** The end of the regex, in a search: anything may follow, and the match is already made. */
const ACCEPT: Next = { chars: ALL, end: true, always: true }
/** Nothing: used to ask what an item starts with when it consumes a character. */
const NOTHING: Next = { chars: [], end: false, always: false }

/** Matches the empty string: `(?:)`, `x{0}`. Pattern has no empty sequence, so: none of anything. */
const EMPTY: Node = { kind: 'repeat', item: { kind: 'anyChar' }, min: 0, max: 0 }
const isEmpty = (n: Node) => n.kind === 'repeat' && n.max === 0

const NAMED: [Ranges, Node][] = (['digit', 'hexDigit', 'letter', 'lowercaseLetter', 'uppercaseLetter', 'wordChar', 'whitespace'] as const).map(
  (k) => [(NOUNS[k] as { ranges: Ranges }).ranges, NOUNS[k]]
)

/** Can the node match without consuming a character (in some situation)? */
function nullable(n: RNode): boolean {
  switch (n.t) {
    case 'set':
      return false
    case 'seq':
      return n.items.every(nullable)
    case 'alt':
      return n.options.some(nullable)
    case 'repeat':
      return n.min === 0 || nullable(n.item)
    case 'capture':
      return nullable(n.item)
    default:
      return true // empty, assertions, lookahead
  }
}

/** What `n` followed by `k` can start with. */
function first(n: RNode, k: Next): Next {
  switch (n.t) {
    case 'empty':
      return k
    case 'set':
      return { chars: n.ranges, end: false, always: false }
    case 'seq': {
      let next = k
      for (let i = n.items.length - 1; i >= 0; i--) next = first(n.items[i]!, next)
      return next
    }
    case 'alt':
      return n.options.map((o) => first(o, k)).reduce(join)
    case 'repeat': {
      if (n.max === 0) return k
      const f = first(n.item, k)
      return n.min === 0 ? join(f, k) : f
    }
    case 'capture':
      return first(n.item, k)
    case 'look': {
      // The rest must match here too, so it starts with no more than k does; a positive
      // lookahead also requires the next character to start its own item.
      if (n.negative) return { ...k, always: false }
      const f = first(n.item, ACCEPT)
      return { chars: intersect(k.chars, f.chars), end: k.end && f.end, always: false }
    }
    case 'start':
      return { ...k, always: false }
    case 'end':
      return { chars: [], end: k.end, always: false }
  }
}

const join = (a: Next, b: Next): Next => ({
  chars: union(a.chars, b.chars),
  end: a.end || b.end,
  always: a.always || b.always,
})

/** What the node starts with when it consumes a character. */
const consumes = (n: RNode): Ranges => first(n, NOTHING).chars

const quote = (cps: Ranges) => {
  const s = rangeString(cps)
  return s.length > 24 ? s.slice(0, 24) + '…' : s
}

class Translator {
  constructor(readonly source: string) {}

  /** `n`, then something that can start as `k` says. `inList`: inside a repetition. */
  translate(n: RNode, k: Next, inList: boolean, inLook = false): Node {
    switch (n.t) {
      case 'empty':
        return EMPTY
      case 'set':
        return this.set(n)
      case 'start':
        return { kind: 'start' }
      case 'end':
        return { kind: 'end' }
      case 'look': {
        // A JavaScript lookahead is atomic: its first success is final, as in Pattern.
        const item = this.translate(n.item, ACCEPT, inList, true)
        return n.negative ? { kind: 'notFollowedBy', item: stripCaptures(item) } : { kind: 'followedBy', item }
      }
      case 'capture': {
        if (inLook)
          throw new RegexRefusal('capture-in-lookahead', n.at, `group ${n.name} captures inside a lookahead, which consumes nothing`, 'Capture outside the lookahead: pattern.ifFollowedBy(x).group(x).as(name)')
        if (inList)
          throw new RegexRefusal('capture-in-repetition', n.at, `group ${n.name} is repeated, and a regex keeps only its LAST repetition`, `Capture the whole repetition, or each item: pattern.oneOrMore(pattern.….as('item')).as('items')`)
        return { kind: 'capture', name: n.name, item: this.translate(n.item, k, inList, inLook) }
      }
      case 'alt':
        return this.alternation(n, k, inList, inLook)
      case 'repeat':
        return this.repetition(n, k, inList, inLook)
      case 'seq':
        return this.sequence(n.items, k, inList, inLook)
    }
  }

  set(n: Extract<RNode, { t: 'set' }>): Node {
    const { ranges, negated } = n
    if (ranges.length === 1 && ranges[0]![0] === ranges[0]![1])
      return { kind: 'literal', text: String.fromCodePoint(ranges[0]![0]) }
    // An ASCII letter in either case (the i flag): a caseless literal, which reads as text. Not
    // k: \u212a (the Kelvin sign) lowercases to k, and only `iu` regexes match it.
    if (ranges.length === 2 && ranges[0]![0] === ranges[0]![1] && ranges[1]![0] === ranges[1]![1]) {
      const [a, b] = [ranges[0]![0], ranges[1]![0]]
      if (a >= 65 && a <= 90 && b === a + 32 && a !== 75)
        return { kind: 'literal', text: String.fromCharCode(b), caseless: true }
    }
    if (sameRanges(ranges, ALL)) return { kind: 'anyChar' }
    for (const [r, noun] of NAMED) if (sameRanges(r, ranges)) return noun
    if (negated) return { kind: 'chars', ranges: complement(ranges), negated: true }
    return { kind: 'chars', ranges }
  }

  sequence(items: RNode[], k: Next, inList: boolean, inLook: boolean): Node {
    // What follows each item: the items after it, then k.
    const follows: Next[] = new Array(items.length)
    let next = k
    for (let i = items.length - 1; i >= 0; i--) {
      follows[i] = next
      next = first(items[i]!, next)
    }
    const out: Node[] = []
    for (let i = 0; i < items.length; i++) {
      const item = items[i]!
      const lazy = lazyAt(item)
      if (lazy) {
        out.push(this.lazy(item, lazy, items.slice(i + 1), k, inList, inLook))
        break
      }
      out.push(this.translate(item, follows[i]!, inList, inLook))
    }
    return flatten(out)
  }

  /**
   * `C*? R` (or `C+? R`, or either inside a capture): the shortest run of C after which the rest
   * R matches. That is `until(oneOf(R, not C))`, then R. Exact when R is everything left of the
   * regex (nothing after R can fail and send the regex back for a longer run).
   */
  lazy(item: RNode, rep: Extract<RNode, { t: 'repeat' }>, rest: RNode[], k: Next, inList: boolean, inLook: boolean): Node {
    if (!k.always)
      throw new RegexRefusal('lazy', rep.at, 'this lazy quantifier is followed by more than the end of the regex, so its stopping point can depend on a later retry', 'Say where it stops: .until(x) then x, at the end')
    if (rep.item.t !== 'set' || (rep.max !== null) || rep.min > 1)
      throw new RegexRefusal('lazy', rep.at, 'a lazy quantifier is read only on one character class (x*? or x+?)', 'Say where it stops: .until(x)')
    const r = this.sequence(rest, k, inList, inLook)
    const c = this.set(rep.item)
    const stop = rep.item.negated || !sameRanges(rep.item.ranges, ALL)
      ? { kind: 'oneOf', options: [stripCaptures(r), this.set({ ...rep.item, ranges: complement(rep.item.ranges), negated: !rep.item.negated })] } as Node
      : stripCaptures(r)
    const run: Node = rep.min === 1
      ? { kind: 'sequence', items: [c, { kind: 'until', item: stop }] }
      : { kind: 'until', item: stop }
    const lazyPart = item.t === 'capture' ? { kind: 'capture', name: item.name, item: run } as Node : run
    if (rest.length === 0) {
      // Nothing after: the shortest run is the minimum.
      const min: Node = rep.min === 1 ? c : EMPTY
      return item.t === 'capture' ? { kind: 'capture', name: item.name, item: min } : min
    }
    if (item.t === 'capture' && inList)
      throw new RegexRefusal('capture-in-repetition', item.at, `group ${item.name} is repeated, and a regex keeps only its LAST repetition`)
    return flatten([lazyPart, r])
  }

  alternation(n: Extract<RNode, { t: 'alt' }>, k: Next, inList: boolean, inLook: boolean): Node {
    const options = n.options.map((o) => this.translate(o, k, inList, inLook))
    if (!k.always) {
      const starts = n.options.map(consumes)
      for (let i = 0; i < n.options.length; i++) {
        const oi = n.options[i]!
        if (nullable(oi) && i < n.options.length - 1)
          throw new RegexRefusal('alternation-backtracks', oi.at, `option ${i + 1} of this | can match nothing, so a regex tries the later options when the rest fails`, 'Put the option that can match nothing last')
        for (let j = i + 1; j < n.options.length; j++) {
          const both = intersect(starts[i]!, starts[j]!)
          if (both.length)
            throw new RegexRefusal('alternation-backtracks', n.options[j]!.at, `options ${i + 1} and ${j + 1} of this | can both start with ${quote(both)}, so the regex retries the later one when the rest fails`, 'Make the options start differently, or put the longer one first and say where it ends')
        }
        const last = n.options[n.options.length - 1]!
        if (i < n.options.length - 1 && nullable(last)) {
          const both = intersect(starts[i]!, k.chars)
          if (both.length)
            throw new RegexRefusal('alternation-backtracks', last.at, `the last option of this | can match nothing, and what follows can start with ${quote(both)}, as option ${i + 1} can`)
        }
      }
    }
    return { kind: 'oneOf', options }
  }

  repetition(n: Extract<RNode, { t: 'repeat' }>, k: Next, inList: boolean, inLook: boolean): Node {
    const { min, max } = n
    if (max === 0) return EMPTY
    if (n.lazy) {
      if (k.always) {
        // At the end of the regex, the shortest is the minimum.
        if (min === 0) return EMPTY
        return this.repetition({ ...n, lazy: false, max: min }, k, inList, inLook)
      }
      throw new RegexRefusal('lazy', n.at, 'this lazy quantifier is followed by more than the end of the regex, so its stopping point can depend on a later retry', 'Say where it stops: .until(x) then x')
    }
    if (nullable(n.item))
      throw new RegexRefusal('empty-repetition', n.at, 'the repeated item can match nothing, so how often it repeats is not determined', 'Repeat something that always consumes a character')
    const starts = consumes(n.item)
    if (!k.always && min !== max) {
      const both = intersect(starts, k.chars)
      if (both.length)
        throw new RegexRefusal('repetition-backtracks', n.at, `this repetition can consume ${quote(both)}, which what follows it can also start with, so the regex only matches by giving some back`, 'Say where the repetition stops: repeat only what cannot start what follows, or use .until(…)')
    }
    // Inside the item, what follows is another item or k; the rest always succeeds only once the
    // minimum is met.
    const inner: Next = {
      chars: union(starts, k.chars),
      end: k.end,
      always: k.always && min <= 1,
    }
    const list = max !== 1
    const item = this.translate(n.item, inner, inList || list, inLook)
    return { kind: 'repeat', item, min, max }
  }
}

/** The lazy repetition at this sequence item (directly, or as a capture's whole content). */
function lazyAt(n: RNode): Extract<RNode, { t: 'repeat' }> | null {
  if (n.t === 'repeat' && n.lazy) return n
  if (n.t === 'capture' && n.item.t === 'repeat' && n.item.lazy) return n.item
  return null
}

/** Merge adjacent one-character literals into one; drop empty sequences. */
function flatten(items: Node[]): Node {
  const out: Node[] = []
  for (const it of items) {
    const parts = it.kind === 'sequence' ? it.items : [it]
    for (const p of parts) {
      if (isEmpty(p)) continue
      const last = out[out.length - 1]
      if (p.kind === 'literal' && last?.kind === 'literal' && canJoin(last, p))
        out[out.length - 1] = {
          kind: 'literal',
          text: last.text + p.text,
          ...(last.caseless || p.caseless ? { caseless: true } : {}),
        }
      else out.push(p)
    }
  }
  return out.length === 0 ? EMPTY : out.length === 1 ? out[0]! : { kind: 'sequence', items: out }
}

type Literal = Extract<Node, { kind: 'literal' }>
const uncased = (text: string) => text.toLowerCase() === text && text.toUpperCase() === text
/** Two literals read as one when both are case-sensitive, or the case-sensitive one has no letters. */
const canJoin = (a: Literal, b: Literal) =>
  !!a.caseless === !!b.caseless || (a.caseless ? uncased(b.text) : uncased(a.text))

/** The same node without captures: for zero-width checks, which record nothing. */
function stripCaptures(n: Node): Node {
  switch (n.kind) {
    case 'capture':
      return stripCaptures(n.item)
    case 'sequence':
      return { ...n, items: n.items.map(stripCaptures) }
    case 'oneOf':
      return { ...n, options: n.options.map(stripCaptures) }
    case 'repeat':
    case 'followedBy':
    case 'notFollowedBy':
    case 'until':
    case 'describedAs':
      return { ...n, item: stripCaptures(n.item) }
    case 'separatedBy':
      return { ...n, item: stripCaptures(n.item), separator: stripCaptures(n.separator) }
    default:
      return n
  }
}
