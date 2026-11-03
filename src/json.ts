/**
 * Reading a pattern back from JSON, which may come from someone you do not trust.
 *
 * Every field is checked against the closed set of node kinds (`nodes.ts`); anything else is
 * refused with the path to it. Depth is capped, so hostile JSON cannot exhaust the stack here
 * or in the engine. What comes back is a `Pattern` built only from validated data.
 */
import type { Node, Ranges } from './nodes'
import { KINDS } from './nodes'
import { normalize, isIdentifier } from './chars'
import { Pattern, PatternError } from './pattern'

export const MAX_DEPTH = 200

export function fromJSON(json: unknown): Pattern {
  return new Pattern(node(json, '$', 0))
}

function node(x: unknown, at: string, depth: number): Node {
  if (depth > MAX_DEPTH) throw new PatternError(`${at}: nested deeper than ${MAX_DEPTH}`)
  if (!x || typeof x !== 'object' || Array.isArray(x))
    throw new PatternError(`${at}: expected a pattern node (an object)`)
  const o = x as Record<string, unknown>
  const kind = o.kind
  if (typeof kind !== 'string' || !(KINDS as readonly string[]).includes(kind))
    throw new PatternError(`${at}.kind: unknown kind ${JSON.stringify(kind)}`)
  const str = (k: string, opt = false): string | undefined => {
    const v = o[k]
    if (v === undefined && opt) return undefined
    if (typeof v !== 'string') throw new PatternError(`${at}.${k}: expected a string`)
    return v
  }
  const int = (k: string, nullable = false): number | null => {
    const v = o[k]
    if (v === null && nullable) return null
    if (typeof v !== 'number' || !Number.isInteger(v) || v < 0)
      throw new PatternError(`${at}.${k}: expected a whole number ≥ 0`)
    return v
  }
  const child = (k: string) => node(o[k], `${at}.${k}`, depth + 1)
  const list = (k: string, min: number) => {
    const v = o[k]
    if (!Array.isArray(v) || v.length < min)
      throw new PatternError(`${at}.${k}: expected a list of at least ${min} nodes`)
    return v.map((c, i) => node(c, `${at}.${k}[${i}]`, depth + 1))
  }
  switch (kind) {
    case 'literal': {
      const text = str('text')!
      if (!text) throw new PatternError(`${at}.text: empty`)
      return o.caseless === true ? { kind, text, caseless: true } : { kind, text }
    }
    case 'chars': {
      const r = o.ranges
      if (!Array.isArray(r) || r.length === 0)
        throw new PatternError(`${at}.ranges: expected a non-empty list of [from, to] pairs`)
      const ranges: Ranges = r.map((pair, i) => {
        if (
          !Array.isArray(pair) ||
          pair.length !== 2 ||
          !pair.every((n) => Number.isInteger(n) && n >= 0 && n <= 0x10ffff)
        )
          throw new PatternError(`${at}.ranges[${i}]: expected [from, to] code points`)
        return [pair[0], pair[1]] as [number, number]
      })
      const label = str('label', true)
      const plural = str('plural', true)
      return {
        kind,
        ranges: normalize(ranges),
        ...(o.negated === true ? { negated: true } : {}),
        ...(label !== undefined ? { label } : {}),
        ...(plural !== undefined ? { plural } : {}),
      }
    }
    case 'sequence':
      return { kind, items: list('items', 1) }
    case 'oneOf':
      return { kind, options: list('options', 2) }
    case 'repeat': {
      const min = int('min')!
      const max = int('max', true)
      if (max !== null && max < min) throw new PatternError(`${at}: max is below min`)
      return { kind, item: child('item'), min, max }
    }
    case 'followedBy':
    case 'notFollowedBy':
    case 'until':
      return { kind, item: child('item') }
    case 'capture': {
      const name = str('name')!
      if (!isIdentifier(name))
        throw new PatternError(`${at}.name: not an identifier`)
      return { kind, name, item: child('item') }
    }
    case 'describedAs':
      return { kind, label: str('label')!, item: child('item') }
    case 'quoted': {
      const quote = str('quote')!
      if (!quote) throw new PatternError(`${at}.quote: empty`)
      const e = o.escape
      if (!(e === null || e === undefined || typeof e === 'string'))
        throw new PatternError(`${at}.escape: expected a string, 'double' or null`)
      return { kind, quote, escape: (e as string | null | undefined) ?? null }
    }
    case 'balanced': {
      const open = str('open')!
      const close = str('close')!
      if (!open || !close || open === close)
        throw new PatternError(`${at}: open and close must be different, non-empty strings`)
      const e = o.escape
      if (!(e === null || e === undefined || typeof e === 'string'))
        throw new PatternError(`${at}.escape: expected a string or null`)
      return {
        kind,
        open,
        close,
        quotes: str('quotes', true) ?? '',
        escape: (e as string | null | undefined) ?? null,
      }
    }
    case 'separatedBy':
      return {
        kind,
        item: child('item'),
        separator: child('separator'),
        min: o.min === undefined ? 0 : int('min')!,
      }
    default:
      // anyChar, start, end, lineStart, lineEnd, indentedBlock, number, integer: no fields.
      return { kind } as Node
  }
}
