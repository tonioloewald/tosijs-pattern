/**
 * A pattern as the CHAIN that builds it: `toCode()`. Where `describe()` reads a pattern aloud,
 * this writes it down as code you can paste, so a translated regex comes back as something to
 * read and keep:
 *
 *   fromRegex(/^\d{3}-\d{4}$/).toCode()
 *   → "pattern.start().digits(3).text('-').digits(4).end()"
 *
 * Running the code gives the same pattern (a test holds every case to that).
 */
import type { Node, Ranges } from './nodes'
import { sameRanges, parseRangeString } from './chars'

type Named = 'digit' | 'hexDigit' | 'letter' | 'lowercaseLetter' | 'uppercaseLetter' | 'wordChar' | 'whitespace' | 'blank' | 'anyChar' | 'lineBreak'

/** Singular and plural method names; `whitespace` is a mass noun, so it has only the plural. */
const NAMES: Record<Named, [string | null, string]> = {
  digit: ['digit', 'digits'],
  hexDigit: ['hexDigit', 'hexDigits'],
  letter: ['letter', 'letters'],
  lowercaseLetter: ['lowercaseLetter', 'lowercaseLetters'],
  uppercaseLetter: ['uppercaseLetter', 'uppercaseLetters'],
  wordChar: ['wordChar', 'wordChars'],
  whitespace: [null, 'whitespace'],
  blank: ['blank', 'blanks'],
  anyChar: ['anyChar', 'anyChars'],
  lineBreak: ['lineBreak', 'lineBreaks'],
}

export function toCode(node: Node, nouns: Record<Named, Node>): string {
  const named = (n: Node): Named | null => {
    for (const k of Object.keys(NAMES) as Named[]) {
      const m = nouns[k]
      if (n.kind === 'chars' && m.kind === 'chars') {
        if (!n.negated && sameRanges(n.ranges, m.ranges)) return k
      } else if (n.kind === m.kind && JSON.stringify(n) === JSON.stringify(m)) return k
    }
    return null
  }

  const code = (n: Node): string => 'pattern' + (n.kind === 'sequence' ? n.items.map(step).join('') : step(n))
  const arg = (n: Node): string => (n.kind === 'literal' && !n.caseless ? quote(n.text) : code(n))

  /** How many, as the plural methods take it: none is one or more, `(n)` exactly, `(m, n)`. */
  const counts = (min: number, max: number | null) =>
    max === null ? (min === 1 ? '' : `${min}, Infinity`) : min === max ? `${min}` : `${min}, ${max}`

  /** The plural method for a repeated item, if it has one: `digits`, `charsIn('a-f')`. */
  const plural = (item: Node, min: number, max: number | null): string | null => {
    const k = named(item)
    const how = counts(min, max)
    if (k) return `.${NAMES[k][1]}(${how})`
    if (item.kind === 'chars') {
      const sep = how ? `, ${how}` : ''
      return `.${item.negated ? 'charsNotIn' : 'charsIn'}(${quote(specOf(item))}${sep})`
    }
    return null
  }

  function step(n: Node): string {
    switch (n.kind) {
      case 'literal':
        return n.caseless ? `.anyCase(${quote(n.text)})` : `.text(${quote(n.text)})`
      case 'chars':
      case 'anyChar': {
        const k = named(n)
        if (k) return NAMES[k][0] ? `.${NAMES[k][0]}()` : `.${NAMES[k][1]}(1)`
        if (n.kind === 'anyChar') return '.anyChar()'
        return `.${n.negated ? 'charNotIn' : 'charIn'}(${quote(specOf(n))})`
      }
      case 'sequence':
        return `.group(${code(n)})`
      case 'oneOf':
        return `.oneOf(${n.options.map(arg).join(', ')})`
      case 'repeat': {
        const { item, min, max } = n
        if (min >= 1 || (min === 0 && max !== null && max > 1)) {
          const p = plural(item, min, max)
          if (p) return p
        }
        if (min === 0 && max === 1) return `.optional(${arg(item)})`
        if (min === 0 && max === null) {
          // `\s*` reads best as "optionally whitespace": the same match, since nothing gives back.
          const p = plural(item, 1, null)
          return p ? `.optional(pattern${p})` : `.zeroOrMore(${arg(item)})`
        }
        if (min === 1 && max === null) return `.oneOrMore(${arg(item)})`
        return `.repeat(${arg(item)}, ${counts(min, max) || '1, Infinity'})`
      }
      case 'followedBy':
        return `.ifFollowedBy(${arg(n.item)})`
      case 'notFollowedBy':
        return `.ifNotFollowedBy(${arg(n.item)})`
      case 'capture':
        return (n.item.kind === 'sequence' ? `.group(${code(n.item)})` : step(n.item)) + `.as(${quote(n.name)})`
      case 'describedAs': {
        const k = named(n)
        if (k) return `.${NAMES[k][0]}()`
        return `.group(${code(n.item)}.describedAs(${quote(n.label)}))`
      }
      case 'start':
      case 'end':
      case 'lineStart':
      case 'lineEnd':
      case 'number':
      case 'integer':
        return `.${n.kind}()`
      case 'until':
        return `.until(${arg(n.item)})`
      case 'quoted':
        return `.quoted(${quote(n.quote)}${n.escape ? `, { escape: ${quote(n.escape)} }` : ''})`
      case 'balanced': {
        const opts = [
          n.quotes ? `quotes: ${quote(n.quotes)}` : '',
          // `quotes` implies a backslash escape; say it only when it differs.
          n.escape !== null && n.escape !== (n.quotes ? '\\' : null) ? `escape: ${quote(n.escape)}` : '',
        ].filter(Boolean)
        return `.balanced(${quote(n.open)}, ${quote(n.close)}${opts.length ? `, { ${opts.join(', ')} }` : ''})`
      }
      case 'separatedBy':
        return `.listOf(${arg(n.item)}, { separatedBy: ${arg(n.separator)}${n.min ? `, atLeast: ${n.min}` : ''} })`
    }
  }

  // At the top, a describedAs is a whole-pattern label: `….describedAs('an id')`, not a group.
  if (node.kind === 'describedAs' && !named(node)) return `${code(node.item)}.describedAs(${quote(node.label)})`
  return code(node)
}

/** A JavaScript single-quoted string. */
function quote(s: string): string {
  let out = "'"
  for (const c of s) {
    const cp = c.codePointAt(0)!
    if (c === "'" || c === '\\') out += '\\' + c
    else if (c === '\n') out += '\\n'
    else if (c === '\r') out += '\\r'
    else if (c === '\t') out += '\\t'
    else if (cp < 0x20 || cp === 0x7f || (cp >= 0xd800 && cp <= 0xdfff) || cp === 0x2028 || cp === 0x2029)
      out += '\\u' + cp.toString(16).padStart(4, '0')
    else out += c
  }
  return out + "'"
}

/** The author's own range string, when the label kept it (`one of a-f0-9`), else one built from the ranges. */
function specOf(n: Extract<Node, { kind: 'chars' }>): string {
  const prefix = n.negated ? 'anything but ' : 'one of '
  if (n.label?.startsWith(prefix)) {
    const own = n.label.slice(prefix.length)
    if (own && sameRanges(parseRangeString(own), n.ranges)) return own
  }
  return spec(n.ranges)
}

/** A range string that reads back to exactly these ranges: `-` and `\` escaped, `x-y` for runs. */
function spec(ranges: Ranges): string {
  const one = (cp: number) => (cp === 0x2d || cp === 0x5c ? '\\' : '') + String.fromCodePoint(cp)
  // A lone dash goes LAST, where it is itself without an escape: `0-9a-z-`, as people write it.
  const dash = ranges.some(([a, b]) => a === 0x2d && b === 0x2d)
  const body = ranges
    .filter(([a, b]) => !(dash && a === 0x2d && b === 0x2d))
    .map(([a, b]) => (a === b ? one(a) : b === a + 1 ? one(a) + one(b) : `${one(a)}-${one(b)}`))
    .join('')
  return dash ? body + '-' : body
}
