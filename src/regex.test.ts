import { describe as group, it, expect } from 'bun:test'
import { fromRegex, RegexRefusal, sequence, oneOrMore, digit, type RefusalCode } from './index'
import { differential, inputsFor } from '../scripts/regex-diff'

/**
 * Every row: a regex, and what its translation reads as. Each is also checked DIFFERENTIALLY
 * against the regex (the oracle) on generated inputs, below.
 */
const TRANSLATES: [RegExp, string][] = [
  [/^\d{3}-\d{4}$/, 'the start of the input, then exactly 3 digits, then "-", then exactly 4 digits, then the end of the input'],
  [/(\w+)@(\w+)\.com/, 'one or more word characters as $1, then "@", then one or more word characters as $2, then ".com"'],
  [/^v(?<major>\d+)\.(?<minor>\d+)$/, 'the start of the input, then "v", then one or more digits as major, then ".", then one or more digits as minor, then the end of the input'],
  [/yes|no/i, 'either "yes" in any case or "no" in any case'],
  [/\s*,\s*/, 'any number of whitespace, then ",", then any number of whitespace'],
  [/<b>(.*?)<\/b>/s, '"<b>", then everything up to "</b>" as $1, then "</b>"'],
  [/\d+(?:\.\d+)?/, 'one or more digits, then optionally (".", then one or more digits)'],
  // At the END of a regex nothing can fail afterwards, so even overlapping options agree.
  [/a|ab/, 'either "a" or "ab"'],
]

const MORE: RegExp[] = [
  /"(?:[^"\\]|\\.)*"/, /^\s+|\s+$/g, /[a-z_$][\w$]*/i, /^(.*?),(.*)$/, /k+/i, /k+/iu, /\w+/iu,
  /[^a-z]+/i, /x+?/, /(?:ab|cd)+e/, /a(?=b)/, /a(?!b)\w/, /a{2,3}/, /ab?$/m, /[\d-x]/,
  /\x41B\cJ/, /(?:)/, /a{0}b/, /[^]/, /[\uD800-\uDFFF]/u, /\u{1F600}+/u, /.+/,
]

group('fromRegex translates where backtracking cannot matter', () => {
  for (const [re, reads] of TRANSLATES)
    it(`${re}`, () => {
      expect(fromRegex(re).describe()).toBe(reads)
    })

  for (const re of [...TRANSLATES.map(([r]) => r), ...MORE])
    it(`${re} agrees with the regex on generated inputs`, () => {
      expect(differential(re, fromRegex(re), inputsFor(re.source, re.flags, 300, 7))).toEqual([])
    })

  it('accepts a source string and flags', () => {
    expect(fromRegex('^a+$', 'i').matches('AaA')).toBe(true)
  })
})

/** Each refusal: the regex, its code, and a phrase from the reason. */
const REFUSES: [RegExp, RefusalCode, RegExp][] = [
  [/\d+5/, 'repetition-backtracks', /giving some back/],
  [/(?:ab|a)c/, 'alternation-backtracks', /both start with a/],
  [/(?:|a)b/, 'alternation-backtracks', /can match nothing/],
  [/\bfoo\b/, 'word-boundary', /BEFORE/],
  [/^a/m, 'multiline-start', /BEFORE/],
  [/(?<=a)b/, 'lookbehind', /BEFORE/],
  [/(a)\1/, 'backreference', /memory/],
  [/(\d)+/, 'capture-in-repetition', /LAST repetition/],
  [/(?=(a))a/, 'capture-in-lookahead', /lookahead/],
  [/(?:a*?b)+c/, 'lazy', /later retry/],
  [/(?:ab)*?c/, 'lazy', /one character class/],
  [/(?:a?)*/, 'empty-repetition', /can match nothing/],
  [/é/i, 'caseless-non-ascii', /Unicode case tables/],
  [/\p{L}/u, 'unicode-property', /property tables/],
  [/a/y, 'unsupported-flag', /sticky/],
]

group('fromRegex refuses what would need backtracking (or what Pattern lacks), saying why', () => {
  for (const [re, code, why] of REFUSES)
    it(`${re}: ${code}`, () => {
      let error: unknown
      try {
        fromRegex(re)
      } catch (e) {
        error = e
      }
      expect(error).toBeInstanceOf(RegexRefusal)
      expect((error as RegexRefusal).code).toBe(code)
      expect((error as RegexRefusal).message).toMatch(why)
    })

  it('a refusal says where in the source', () => {
    try {
      fromRegex(/abc\d+5/)
    } catch (e) {
      expect((e as RegexRefusal).at).toBe(3)
    }
  })
})

group('the differential check catches a wrong translation', () => {
  it('possessive digits are NOT /\\d+5/, and the check says so', () => {
    const wrong = sequence(oneOrMore(digit), '5')
    expect(differential(/\d+5/, wrong, inputsFor('\\d+5', '', 100, 1)).length).toBeGreaterThan(0)
  })
})
