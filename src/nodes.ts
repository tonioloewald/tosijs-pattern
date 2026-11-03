/**
 * A pattern is DATA: a tree of these nodes, plain JSON, built by the vocabulary in
 * `pattern.ts` and run by `engine.ts`. Being data is what makes a pattern serializable,
 * inspectable (`describe()`), and safe to accept from someone else (`fromJSON` validates it):
 * there is no code in it to run.
 *
 * The set is CLOSED. Adding a kind means adding it here, to the engine, to `describe`, and to
 * `fromJSON`'s validator; the "every node kind is handled" tests in `pattern.test.ts` fail if any of the four misses one.
 */

/** Inclusive code-point ranges, sorted and merged: `[[48, 57]]` is `0-9`. */
export type Ranges = Array<[number, number]>

export type Node =
  /** The exact text. `caseless` compares letters without regard to case. */
  | { kind: 'literal'; text: string; caseless?: boolean }
  /** ONE character in (or, negated, not in) the ranges. `label`/`plural` name it for people. */
  | {
      kind: 'chars'
      ranges: Ranges
      negated?: boolean
      label?: string
      plural?: string
    }
  /** Any one character (a whole code point), newlines included. */
  | { kind: 'anyChar' }
  /** Each item in order. */
  | { kind: 'sequence'; items: Node[] }
  /** The FIRST option that matches (ordered choice). Later options are not tried after one succeeds. */
  | { kind: 'oneOf'; options: Node[] }
  /** `item` repeated, as many times as it matches, up to `max` (possessive: never gives back). */
  | { kind: 'repeat'; item: Node; min: number; max: number | null }
  /** Succeeds, consuming nothing, if `item` matches here. */
  | { kind: 'followedBy'; item: Node }
  /** Succeeds, consuming nothing, if `item` does NOT match here. */
  | { kind: 'notFollowedBy'; item: Node }
  /** Matches `item` and records its value under `name`. */
  | { kind: 'capture'; name: string; item: Node }
  /** Matches `item`; `label` is what messages and descriptions call it. */
  | { kind: 'describedAs'; label: string; item: Node }
  | { kind: 'start' }
  | { kind: 'end' }
  | { kind: 'lineStart' }
  | { kind: 'lineEnd' }
  /** Everything up to (not including) the first place `item` matches. Fails if it never does. */
  | { kind: 'until'; item: Node }
  /** A span opened and closed by `quote`. `escape`: a character, `'double'` (`""` inside `"…"`), or none. */
  | { kind: 'quoted'; quote: string; escape: string | 'double' | null }
  /** A NESTED span: `open … close`, closing at its own `close`; text inside `quotes` is skipped. */
  | {
      kind: 'balanced'
      open: string
      close: string
      quotes: string
      escape: string | null
    }
  /** Zero or more `item`s with `separator` between them (at least `min`). Its value is a list. */
  | { kind: 'separatedBy'; item: Node; separator: Node; min: number; trailing?: boolean }
  /**
   * One row of named columns, never crossing a line break. FIXED width (`widths`): each column
   * takes its width or what is left of the line, and its value is trimmed of padding. DELIMITED
   * (`separator`): each column is the text up to the separator or the line end, as written.
   * The value is a record, `{ name: value, … }`. An empty line is not a row.
   */
  | { kind: 'columns'; names: string[]; widths: number[] | null; separator: Node | null }
  /**
   * At the end of a line: the lines after it that are indented DEEPER than it (a Python body, a
   * Markdown list item's continuation), blank lines between them included. It stops before the
   * first non-blank line indented the same or less. Its value is the lines, dedented.
   */
  | { kind: 'indentedBlock' }
  /** JSON's number grammar; its value is a number. */
  | { kind: 'number' }
  /** An optional minus and digits, no leading zeros; its value is a number. */
  | { kind: 'integer' }

export type Kind = Node['kind']

export const KINDS: readonly Kind[] = [
  'literal',
  'chars',
  'anyChar',
  'sequence',
  'oneOf',
  'repeat',
  'followedBy',
  'notFollowedBy',
  'capture',
  'describedAs',
  'start',
  'end',
  'lineStart',
  'lineEnd',
  'until',
  'quoted',
  'balanced',
  'separatedBy',
  'columns',
  'indentedBlock',
  'number',
  'integer',
]
