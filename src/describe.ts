/**
 * A pattern read aloud. This is the library's readability promise made executable: if the
 * description reads badly, the vocabulary is wrong, and the descriptions in `pattern.test.ts` (and on the doc site) are where that shows.
 *
 *   sequence(start, times(3, digit), '-', times(4, digit), end).describe()
 *   → 'the start of the input, then exactly 3 digits, then "-", then exactly 4 digits, then the end of the input'
 */
import type { Node } from './nodes'
import { rangeString } from './chars'

const plural = (node: Node): string | null =>
  node.kind === 'chars' && node.plural
    ? node.plural
    : node.kind === 'chars'
      ? `characters ${node.negated ? 'not ' : ''}in ${rangeString(node.ranges)}`
      : node.kind === 'anyChar'
        ? 'characters'
        : null

const group = (node: Node): string => {
  const d = describe(node)
  return node.kind === 'sequence' || node.kind === 'oneOf' ? `(${d})` : d
}

export function describe(node: Node): string {
  switch (node.kind) {
    case 'literal':
      return node.caseless
        ? `${JSON.stringify(node.text)} in any case`
        : JSON.stringify(node.text)
    case 'chars':
      return (
        node.label ??
        `a character ${node.negated ? 'not ' : ''}in ${rangeString(node.ranges)}`
      )
    case 'anyChar':
      return 'any character'
    case 'sequence':
      return node.items.map(describe).join(', then ')
    case 'oneOf':
      return node.options.length === 2
        ? `either ${group(node.options[0]!)} or ${group(node.options[1]!)}`
        : `one of ${node.options.map(group).join(', ')}`
    case 'repeat': {
      const { min, max } = node
      const many = plural(node.item)
      const one = group(node.item)
      if (min === 0 && max === 1) return `optionally ${one}`
      const what = many ?? `of ${one}`
      if (min === 0 && max === null) return `any number of ${many ?? one}`
      if (min === 1 && max === null) return `one or more ${what}`
      if (max === null) return `at least ${min} ${what}`
      if (min === max) return `exactly ${min} ${what}`
      if (min === 0) return `at most ${max} ${what}`
      return `${min} to ${max} ${what}`
    }
    case 'followedBy':
      return `(if followed by ${group(node.item)})`
    case 'notFollowedBy':
      return `(if not followed by ${group(node.item)})`
    case 'capture':
      return `${group(node.item)} as ${node.name}`
    case 'describedAs':
      return node.label
    case 'start':
      return 'the start of the input'
    case 'end':
      return 'the end of the input'
    case 'lineStart':
      return 'the start of a line'
    case 'lineEnd':
      return 'the end of a line'
    case 'until':
      return `everything up to ${group(node.item)}`
    case 'quoted':
      return `a ${node.quote}-quoted string${
        node.escape === 'double'
          ? ` (${node.quote}${node.quote} inside is a ${node.quote})`
          : node.escape
            ? ` (with ${node.escape} escapes)`
            : ''
      }`
    case 'balanced':
      return `a balanced ${node.open}…${node.close} group${
        node.quotes ? ` (skipping text in ${node.quotes.split('').join(' or ')} quotes)` : ''
      }`
    case 'separatedBy':
      return `${node.min ? `at least ${node.min} of ` : ''}${group(node.item)} separated by ${group(node.separator)}`
    case 'number':
      return 'a number'
    case 'integer':
      return 'an integer'
  }
}
