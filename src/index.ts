/*#
# tosijs-pattern

Matching that reads like what it means. See the README for the guided tour.
*/
export {
  Pattern,
  PatternError,
  PatternBudgetError,
  DEFAULT_MAX_STEPS,
  // verbs
  sequence,
  oneOf,
  optional,
  zeroOrMore,
  oneOrMore,
  times,
  atLeast,
  atMost,
  between,
  capture,
  describedAs,
  followedBy,
  notFollowedBy,
  until,
  caseless,
  literal,
  charIn,
  charNotIn,
  quoted,
  balanced,
  separatedBy,
  // nouns
  digit,
  hexDigit,
  lowercase,
  uppercase,
  letter,
  wordChar,
  whitespace,
  blank,
  lineBreak,
  anyChar,
  start,
  end,
  lineStart,
  lineEnd,
  number,
  integer,
} from './pattern'
export type { Piece, Options, Match, ParseResult, ParseError } from './pattern'
export type { Node, Kind, Ranges } from './nodes'
export { fromJSON } from './json'
export { fromRegex, RegexRefusal, type RefusalCode } from './regex'
