import { describe as group, it, expect } from 'bun:test'
import {
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
  charIn,
  charNotIn,
  quoted,
  balanced,
  separatedBy,
  digit,
  hexDigit,
  lowercase,
  letter,
  wordChar,
  whitespace,
  anyChar,
  start,
  end,
  lineStart,
  lineEnd,
  number,
  integer,
  fromJSON,
  PatternError,
  PatternBudgetError,
  type Pattern,
} from './index'
import { WHITESPACE, inRanges } from './chars'
import { KINDS, type Kind, type Node } from './nodes'
import { describe as describeNode } from './describe'
import { match, context } from './engine'

group('nouns', () => {
  it('digit, letter, hexDigit, wordChar', () => {
    expect(digit.matches('7')).toBe(true)
    expect(digit.matches('x')).toBe(false)
    expect(oneOrMore(letter).matches('Hello')).toBe(true)
    expect(oneOrMore(hexDigit).matches('c0ffee')).toBe(true)
    expect(oneOrMore(wordChar).matches('snake_case_9')).toBe(true)
  })

  it('whitespace is exactly JavaScript\'s \\s (the oracle, in a test only)', () => {
    for (let cp = 0; cp <= 0xffff; cp++)
      expect([cp, inRanges(WHITESPACE, cp)]).toEqual([
        cp,
        /\s/.test(String.fromCharCode(cp)),
      ])
  })

  it('anyChar takes a whole code point, and line breaks', () => {
    expect(anyChar.matches('😀')).toBe(true)
    expect(anyChar.matches('\n')).toBe(true)
  })

  it('charIn / charNotIn read range strings', () => {
    expect(oneOrMore(charIn('a-f0-9')).matches('dead99')).toBe(true)
    expect(charIn('a\\-z').matches('-')).toBe(true) // escaped: a literal dash
    expect(charIn('a\\-z').matches('m')).toBe(false)
    expect(charIn('-az').matches('-')).toBe(true) // first: a literal dash
    expect(oneOrMore(charNotIn(',\n')).find('ab,cd')?.text).toBe('ab')
  })
})

group('semantics stated in DECISIONS.md', () => {
  it('repetition is possessive: it never gives back', () => {
    expect(sequence(oneOrMore(digit), '5').matches('1235')).toBe(false)
    expect(/^\d+5$/.test('1235')).toBe(true) // regex backtracks; we do not
  })

  it('oneOf is ordered: the first match wins', () => {
    expect(sequence(oneOf('a', 'ab'), end).matches('ab')).toBe(false)
    expect(sequence(oneOf('ab', 'a'), end).matches('ab')).toBe(true)
  })

  it('a zero-width item does not loop forever', () => {
    expect(sequence(zeroOrMore(optional('x')), end).matches('')).toBe(true)
  })
})

group('captures and values', () => {
  it('a capture records the value; number captures a number', () => {
    const price = sequence('$', capture('amount', number))
    expect(price.parse('$42.5')).toMatchObject({ ok: true, captures: { amount: 42.5 } })
  })

  it('a repetition captured collects one entry per item', () => {
    const pairs = capture(
      'pairs',
      oneOrMore(sequence(capture('k', oneOrMore(letter)), '=', capture('v', integer), optional(';')))
    )
    expect(pairs.parse('a=1;b=2').captures).toEqual({
      pairs: [
        { k: 'a', v: 1 },
        { k: 'b', v: 2 },
      ],
    })
  })

  it('a capture inside optional() is there or absent, not a list', () => {
    const flag = sequence('--', capture('name', oneOrMore(letter)), optional(sequence('=', capture('value', integer))))
    expect(flag.parse('--level=9').captures).toEqual({ name: 'level', value: 9 })
    expect(flag.parse('--quiet').captures).toEqual({ name: 'quiet' })
  })

  it('a captured repetition without inner captures is its text', () => {
    expect(capture('n', oneOrMore(digit)).parse('123').captures).toEqual({ n: '123' })
  })

  it('a capture that would be LOST is an error that says what to write', () => {
    const lost = oneOrMore(capture('d', digit))
    expect(() => lost.parse('12')).toThrow(/capture the repetition/)
    expect(() => followedBy(capture('x', digit)).parse('1')).toThrow(/nothing to capture/)
  })

  it('a capture inside until() is lost too (until keeps nothing of its stopping point)', () => {
    expect(() => sequence(until(capture('stop', ';')), ';').parse('a;')).toThrow(/until/)
    expect(() => fromJSON({ kind: 'until', item: { kind: 'capture', name: 'x', item: { kind: 'literal', text: ';' } } }).find('a;')).toThrow(/until/)
  })

  it('the same name twice, where both would be recorded, is an error (the second would overwrite)', () => {
    expect(() => sequence(capture('a', digit), capture('a', letter)).parse('1x')).toThrow(/capture\('a'\) appears twice/)
    expect(() => sequence(optional(capture('a', digit)), capture('a', letter)).parse('x')).toThrow(/appears twice/)
    // A capture around one with the same name would hide it.
    expect(() => capture('a', sequence(capture('a', digit), letter)).parse('1x')).toThrow(/appears twice/)
    // oneOf: only one option is recorded, so sharing a name is how you say "either way, call it a".
    expect(sequence(oneOf(capture('a', digit), capture('a', letter)), end).parse('x').captures).toEqual({ a: 'x' })
    // Each item of a captured repetition is its own scope.
    const kv = capture('pairs', oneOrMore(sequence(capture('k', letter), capture('v', digit))))
    expect(sequence(kv, capture('k', letter)).parse('a1b2z').captures).toEqual({
      pairs: [{ k: 'a', v: '1' }, { k: 'b', v: '2' }],
      k: 'z',
    })
  })

  it('CSV, correctly: quoted fields, doubled quotes, commas and newlines inside', () => {
    const field = oneOf(quoted('"', { escape: 'double' }), optional(oneOrMore(charNotIn(',\n'))))
    const row = capture('fields', separatedBy(field, ','))
    const csv = capture('rows', separatedBy(row, '\n'))
    const r = csv.parse('name,quote\n"Ada","said ""hi"", then\nleft",x')
    expect(r.ok && r.captures.rows).toEqual([
      { fields: ['name', 'quote'] },
      { fields: ['Ada', 'said "hi", then\nleft', 'x'] },
    ])
  })
})

group('structure regex cannot express', () => {
  it('balanced closes at its own delimiter, skipping quoted text', () => {
    const call = sequence(capture('fn', oneOrMore(wordChar)), capture('args', balanced('(', ')', { quotes: '"\'' })))
    expect(call.parse('f(a, g(b), ")")').captures).toEqual({ fn: 'f', args: 'a, g(b), ")"' })
    expect(call.matches('f(a, g(b)')).toBe(false)
  })

  it('quoted keeps escapes except before the quote or the escape', () => {
    const s = capture('s', quoted('"', { escape: '\\' }))
    expect(s.parse('"a\\"b\\\\c\\n"').captures.s).toBe('a"b\\c\\n')
  })

  it('until stops before the first occurrence', () => {
    const comment = sequence('<!--', capture('body', until('-->')), '-->')
    expect(comment.find('x <!-- a - b --> y')?.captures.body).toBe(' a - b ')
  })
})

group('operations', () => {
  const word = oneOrMore(letter)
  it('find / findAll / occursIn', () => {
    expect(word.find('12 abc 3')).toMatchObject({ text: 'abc', start: 3, end: 6 })
    expect(word.findAll('a bb ccc').map((m) => m.text)).toEqual(['a', 'bb', 'ccc'])
    expect(digit.occursIn('abc')).toBe(false)
  })

  it('replaceAll with a template, replaceFirst, split', () => {
    const price = sequence('$', capture('n', number))
    expect(price.replaceAll('$5 and $7.5', '{n} USD')).toBe('5 USD and 7.5 USD')
    expect(price.replaceFirst('$5 and $7.5', '{{{n}}}')).toBe('{5} and $7.5')
    expect(() => price.replaceAll('$5', '{x}')).toThrow(/captures \{n\}/)
    expect(sequence(',', zeroOrMore(whitespace)).split('a, b,c')).toEqual(['a', 'b', 'c'])
  })

  it('a template inserts the matched TEXT of a capture, not its value (owner, 2026-11-03)', () => {
    const price = sequence('$', capture('amount', number))
    expect(price.replaceAll('$3.50', '{amount} USD')).toBe('3.50 USD')
    expect(price.replaceAll('$1e3 and $0.10', '{amount}')).toBe('1e3 and 0.10')
    // The function form has both: the value and the text.
    const m = price.find('$3.50')!
    expect([m.captures.amount, m.texts.amount]).toEqual([3.5, '3.50'])
    expect(price.replaceAll('$3.50', (m) => `${(m.captures.amount as number) * 2} (${m.texts.amount}×2)`)).toBe('7 (3.50×2)')
    // A quoted capture's text includes the quotes; its value is the inside.
    const q = capture('s', quoted('"'))
    expect(q.replaceAll('say "hi"', '<{s}>')).toBe('say <"hi">')
    expect(q.parse('"hi"')).toMatchObject({ captures: { s: 'hi' }, texts: { s: '"hi"' } })
  })

  it('parse says where and what it expected', () => {
    const date = sequence(times(4, digit), '-', times(2, digit))
    const r = date.parse('2026-1x')
    expect(r.ok).toBe(false)
    if (!r.ok) expect(r.error).toMatchObject({ at: 6, line: 1, column: 7, expected: ['a digit'] })
    const named = describedAs('an identifier', sequence(letter, zeroOrMore(wordChar)))
    const r2 = named.parse('9x')
    if (!r2.ok) expect(r2.error.message).toBe('expected an identifier at line 1, column 1')
  })

  it('lineStart / lineEnd', () => {
    const line = sequence(lineStart, capture('l', oneOrMore(letter)), lineEnd)
    expect(line.findAll('ab\ncd\n9').map((m) => m.captures.l)).toEqual(['ab', 'cd'])
  })
})

group('the step budget bounds the work', () => {
  it('a budget that is too small throws, naming the budget', () => {
    expect(() => oneOrMore(anyChar).parse('x'.repeat(10_000), { maxSteps: 1_000 })).toThrow(PatternBudgetError)
  })

  it('work is linear in input for a plain pattern', () => {
    const p = sequence(oneOrMore(charIn('a-z')), end)
    const steps = (n: number) => p.parse('a'.repeat(n)).steps / n
    expect(steps(64_000)).toBeLessThan(steps(1_000) * 1.2 + 1)
  })
})

group('JSON', () => {
  it('round-trips', () => {
    const p = sequence(start, capture('n', between(1, 3, digit)), optional(caseless('px')), end)
    const back = fromJSON(JSON.parse(JSON.stringify(p)))
    expect(back.toJSON()).toEqual(p.toJSON())
    expect(back.parse('12PX').captures).toEqual({ n: '12' })
  })

  it('refuses what is not a pattern, saying where', () => {
    expect(() => fromJSON({ kind: 'eval', code: '1' })).toThrow(/\$\.kind: unknown kind/)
    expect(() => fromJSON({ kind: 'repeat', item: { kind: 'anyChar' }, min: 2, max: 1 })).toThrow(/max is below min/)
    expect(() => fromJSON({ kind: 'chars', ranges: [[0, 0x110000]] })).toThrow(/code points/)
    let deep: any = { kind: 'anyChar' }
    for (let i = 0; i < 500; i++) deep = { kind: 'followedBy', item: deep }
    expect(() => fromJSON(deep)).toThrow(/nested deeper/)
  })
})

group('patterns are values', () => {
  it('frozen all the way down', () => {
    const p = sequence('a', digit)
    expect(Object.isFrozen(p.node)).toBe(true)
    expect(() => {
      ;(p.node as any).items.push({ kind: 'anyChar' })
    }).toThrow()
  })

  it('building refuses mistakes at the call that made them', () => {
    expect(() => sequence()).toThrow(PatternError)
    expect(() => oneOf('a')).toThrow(/at least two/)
    expect(() => times(-1, digit)).toThrow(/whole number/)
    expect(() => between(3, 1, digit)).toThrow(/below the minimum/)
    expect(() => capture('1x', digit)).toThrow(/identifier/)
    expect(() => sequence('a', null as any)).toThrow(/piece 2/)
  })
})

/**
 * The differential corpus: each pattern against the regex a fluent engineer would write, on
 * the same inputs, whole-string. Regex is the ORACLE here and only here (this library uses no
 * RegExp). Every row is a case where possessive/ordered semantics agree with backtracking;
 * rows where they DIFFER belong in the "semantics" group above, stated.
 */
const CORPUS: [RegExp, Pattern, string[]][] = [
  [/^\d{3}-\d{4}$/, sequence(start, times(3, digit), '-', times(4, digit), end), ['555-1234', '55-1234', '555-12345', 'abc-defg']],
  [/^[a-z]+$/, sequence(start, oneOrMore(lowercase), end), ['abc', 'aBc', '', 'z']],
  [/^#[0-9a-fA-F]{6}$/, sequence('#', times(6, hexDigit), end), ['#c0ffee', '#C0FFEE', '#c0ffe', '#g0ffee']],
  [/^\s*\w+\s*=\s*\d+\s*$/, sequence(zeroOrMore(whitespace), oneOrMore(wordChar), zeroOrMore(whitespace), '=', zeroOrMore(whitespace), oneOrMore(digit), zeroOrMore(whitespace), end), ['a=1', '  key = 42 ', 'k=', '=1']],
  [/^(?:yes|no)$/i, sequence(oneOf(caseless('yes'), caseless('no')), end), ['yes', 'YES', 'No', 'maybe']],
  [/^v\d+(?:\.\d+){0,2}$/, sequence('v', oneOrMore(digit), atMost(2, sequence('.', oneOrMore(digit))), end), ['v1', 'v1.2', 'v1.2.3', 'v1.2.3.4', 'v']],
  [/^(?!_)\w+$/, sequence(notFollowedBy('_'), oneOrMore(wordChar), end), ['ok', '_no', 'a_b']],
  [/^\d+(?=px$)/, sequence(oneOrMore(digit), followedBy(sequence('px', end))), ['12px', '12em', 'px']],
  [/^a{2,}$/, sequence(atLeast(2, 'a'), end), ['a', 'aa', 'aaaa']],
]

group('agrees with the regex a fluent engineer would write', () => {
  for (const [re, pattern, inputs] of CORPUS)
    it(`${re}  ≡  ${pattern.describe()}`, () => {
      for (const s of inputs) {
        // `find` from 0 with a start-anchored pattern is the regex's `test`.
        const got = pattern.find(s) !== null && (pattern.find(s)!.start === 0)
        expect([s, got]).toEqual([s, re.test(s)])
      }
    })
})

/**
 * The node set is CLOSED, and each kind lives in four places: `nodes.ts`, the engine,
 * `describe.ts` and `fromJSON`. `Record<Kind, …>` makes the compiler refuse a sample list that
 * misses a kind; the test refuses a kind any of the other three does not handle.
 */
const lit: Node = { kind: 'literal', text: 'a' }
const SAMPLES: Record<Kind, Node> = {
  literal: lit,
  chars: { kind: 'chars', ranges: [[97, 122]] },
  anyChar: { kind: 'anyChar' },
  sequence: { kind: 'sequence', items: [lit, lit] },
  oneOf: { kind: 'oneOf', options: [lit, { kind: 'literal', text: 'b' }] },
  repeat: { kind: 'repeat', item: lit, min: 1, max: null },
  followedBy: { kind: 'followedBy', item: lit },
  notFollowedBy: { kind: 'notFollowedBy', item: lit },
  capture: { kind: 'capture', name: 'x', item: lit },
  describedAs: { kind: 'describedAs', label: 'an a', item: lit },
  start: { kind: 'start' },
  end: { kind: 'end' },
  lineStart: { kind: 'lineStart' },
  lineEnd: { kind: 'lineEnd' },
  until: { kind: 'until', item: lit },
  quoted: { kind: 'quoted', quote: '"', escape: '\\' },
  balanced: { kind: 'balanced', open: '(', close: ')', quotes: '"', escape: null },
  separatedBy: { kind: 'separatedBy', item: lit, separator: { kind: 'literal', text: ',' }, min: 0 },
  number: { kind: 'number' },
  integer: { kind: 'integer' },
}

group('every node kind is handled in all four places', () => {
  it('the samples cover KINDS exactly', () => {
    expect(Object.keys(SAMPLES).sort()).toEqual([...KINDS].sort())
  })
  for (const kind of KINDS)
    it(kind, () => {
      const node = SAMPLES[kind]
      expect(typeof describeNode(node)).toBe('string')
      expect(describeNode(node).length).toBeGreaterThan(0)
      for (const input of ['', 'a', 'aa,a', '"a"', '(a)', '-1.5', 'x\n'])
        expect(() => match(node, context(input, 10_000), 0)).not.toThrow()
      expect(fromJSON(JSON.parse(JSON.stringify(node))).toJSON()).toEqual(node)
    })
})
