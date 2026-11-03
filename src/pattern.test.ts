import { describe as group, it, expect } from 'bun:test'
import { readFileSync } from 'node:fs'
import { pattern, fromJSON, PatternError, PatternBudgetError, type Pattern } from './index'
import { WHITESPACE, inRanges } from './chars'
import { KINDS, type Kind, type Node } from './nodes'
import { describe as describeNode } from './describe'
import { match, context } from './engine'

/** Runs a pattern's `toCode()` and gives back the pattern it builds. */
const run = (code: string): Pattern => new Function('pattern', `return ${code}`)(pattern)

group('nouns', () => {
  it('digit, letters, hexDigits, wordChars', () => {
    expect(pattern.digit().matches('7')).toBe(true)
    expect(pattern.digit().matches('x')).toBe(false)
    expect(pattern.letters().matches('Hello')).toBe(true)
    expect(pattern.hexDigits().matches('c0ffee')).toBe(true)
    expect(pattern.wordChars().matches('snake_case_9')).toBe(true)
  })

  it('a singular noun is one, a plural one or more, or a count', () => {
    expect(pattern.digit().matches('12')).toBe(false)
    expect(pattern.digits().matches('12')).toBe(true)
    expect(pattern.digits().matches('')).toBe(false)
    expect(pattern.digits(3).matches('123')).toBe(true)
    expect(pattern.digits(3).matches('1234')).toBe(false)
    expect(['1', '12', '123', '1234'].map((s) => pattern.digits(2, 3).matches(s))).toEqual([false, true, true, false])
    expect(pattern.digits(2, Infinity).matches('12345678')).toBe(true)
    expect(pattern.digits(2, 4).describe()).toBe('2 to 4 digits')
    expect(pattern.digits(2, Infinity).describe()).toBe('at least 2 digits')
  })

  it("whitespace is exactly JavaScript's \\s (the oracle, in a test only)", () => {
    for (let cp = 0; cp <= 0xffff; cp++)
      expect([cp, inRanges(WHITESPACE, cp)]).toEqual([cp, /\s/.test(String.fromCharCode(cp))])
  })

  it('anyChar takes a whole code point, and line breaks', () => {
    expect(pattern.anyChar().matches('😀')).toBe(true)
    expect(pattern.anyChar().matches('\n')).toBe(true)
  })

  it('charIn / charNotIn read range strings', () => {
    expect(pattern.charsIn('a-f0-9').matches('dead99')).toBe(true)
    expect(pattern.charIn('a\\-z').matches('-')).toBe(true) // escaped: a literal dash
    expect(pattern.charIn('a\\-z').matches('m')).toBe(false)
    expect(pattern.charIn('-az').matches('-')).toBe(true) // first: a literal dash
    expect(pattern.charsNotIn(',\n').find('ab,cd')?.text).toBe('ab')
    expect(pattern.charsIn('a-f0-9', 6).matches('c0ffee')).toBe(true)
    // Read aloud in the author's spelling, not the sorted ranges.
    expect(pattern.charsIn('a-z0-9').describe()).toBe('one or more characters in a-z0-9')
  })
})

group('the chain', () => {
  it('reads in the order it matches, the same as its description', () => {
    const phone = pattern.start().digits(3).text('-').digits(4).end()
    expect(phone.describe()).toBe(
      'the start of the input, then exactly 3 digits, then "-", then exactly 4 digits, then the end of the input'
    )
    expect(phone.matches('555-1234')).toBe(true)
  })

  it('every step returns a new pattern; the one before is unchanged', () => {
    const a = pattern.text('a')
    const ab = a.text('b')
    expect([a.matches('a'), ab.matches('ab'), a.matches('ab')]).toEqual([true, true, false])
    expect(pattern.steps).toEqual([])
  })

  it('.as() captures the step just before it', () => {
    const v = pattern.text('v').digits().as('major').text('.').digits().as('minor')
    expect(v.parse('v2.13').captures).toEqual({ major: '2', minor: '13' })
  })

  it('.group() makes a chain one step, so .as() takes all of it', () => {
    const version = pattern.text('v').group(pattern.digits().text('.').digits()).as('n')
    expect(version.parse('v1.2').captures).toEqual({ n: '1.2' })
  })

  it('.describedAs() names the whole pattern', () => {
    const id = pattern.letter().optional(pattern.wordChars()).describedAs('an identifier')
    expect(id.describe()).toBe('an identifier')
    const r = id.parse('9x')
    if (!r.ok) expect(r.error.message).toBe('expected an identifier at line 1, column 1')
  })

  it('the empty pattern says so instead of matching nothing silently', () => {
    expect(() => pattern.matches('')).toThrow(/empty/)
    expect(() => pattern.optional(pattern)).toThrow(/optional\(\): the pattern is empty/)
    expect(() => pattern.as('x')).toThrow(/nothing before it/)
  })

  it('a pattern is not a promise: there is no then, so await gives the pattern back', async () => {
    const p = pattern.digits()
    expect('then' in p).toBe(false)
    expect(await p).toBe(p)
  })
})

group('semantics stated in DECISIONS.md', () => {
  it('repetition is possessive: it never gives back', () => {
    expect(pattern.digits().text('5').matches('1235')).toBe(false)
    expect(/^\d+5$/.test('1235')).toBe(true) // regex backtracks; we do not
  })

  it('oneOf is ordered: the first match wins', () => {
    expect(pattern.oneOf('a', 'ab').end().matches('ab')).toBe(false)
    expect(pattern.oneOf('ab', 'a').end().matches('ab')).toBe(true)
  })

  it('a zero-width item does not loop forever', () => {
    expect(pattern.zeroOrMore(pattern.optional('x')).end().matches('')).toBe(true)
  })
})

group('captures and values', () => {
  it('a capture records the value; number captures a number', () => {
    const price = pattern.text('$').number().as('amount')
    expect(price.parse('$42.5')).toMatchObject({ ok: true, captures: { amount: 42.5 } })
  })

  it('a repetition captured collects one entry per item', () => {
    const pair = pattern.letters().as('k').text('=').integer().as('v').optional(';')
    const pairs = pattern.oneOrMore(pair).as('pairs')
    expect(pairs.parse('a=1;b=2').captures).toEqual({
      pairs: [
        { k: 'a', v: 1 },
        { k: 'b', v: 2 },
      ],
    })
  })

  it('a capture inside optional() is there or absent, not a list', () => {
    const flag = pattern.text('--').letters().as('name').optional(pattern.text('=').integer().as('value'))
    expect(flag.parse('--level=9').captures).toEqual({ name: 'level', value: 9 })
    expect(flag.parse('--quiet').captures).toEqual({ name: 'quiet' })
  })

  it('a captured repetition without inner captures is its text', () => {
    expect(pattern.digits().as('n').parse('123').captures).toEqual({ n: '123' })
  })

  it('a capture that would be LOST is an error that says what to write', () => {
    const lost = pattern.oneOrMore(pattern.digit().as('d'))
    expect(() => lost.parse('12')).toThrow(/capture the repetition/)
    expect(() => pattern.ifFollowedBy(pattern.digit().as('x')).parse('1')).toThrow(/nothing to capture/)
  })

  it('a capture inside until() is lost too (until keeps nothing of its stopping point)', () => {
    expect(() => pattern.until(pattern.text(';').as('stop')).text(';').parse('a;')).toThrow(/until/)
    expect(() =>
      fromJSON({ kind: 'until', item: { kind: 'capture', name: 'x', item: { kind: 'literal', text: ';' } } }).find('a;')
    ).toThrow(/until/)
  })

  it('a capture inside a columns() separator is lost too (a row keeps only its columns)', () => {
    const sep = pattern.oneOf(',', ';').as('sep')
    expect(() => pattern.columns(['a', 'b'], { separatedBy: sep }).parse('1;2')).toThrow(/columns\(\)'s separator/)
  })

  it('__proto__ cannot name a capture or a column (assigning it would set a prototype, losing the value)', () => {
    expect(() => pattern.digit().as('__proto__')).toThrow(/__proto__/)
    expect(() => pattern.columns(['__proto__', 'b'], { separatedBy: ',' })).toThrow(/__proto__/)
    expect(() => fromJSON({ kind: 'capture', name: '__proto__', item: { kind: 'literal', text: 'a' } })).toThrow(/__proto__/)
  })

  it('a replacement names only captures, never what every object inherits', () => {
    const p = pattern.digits().as('n')
    for (const name of ['constructor', 'toString', '__proto__', 'hasOwnProperty'])
      expect(() => p.replaceAll('a1', `{${name}}`)).toThrow(/replacement names/)
    expect(() => pattern.digits().replaceAll('a1', '{constructor}')).toThrow(/replacement names/)
  })

  it('the same name twice, where both would be recorded, is an error (the second would overwrite)', () => {
    expect(() => pattern.digit().as('a').letter().as('a').parse('1x')).toThrow(/\.as\('a'\) appears twice/)
    expect(() => pattern.optional(pattern.digit().as('a')).letter().as('a').parse('x')).toThrow(/appears twice/)
    // A capture around one with the same name would hide it.
    expect(() => pattern.group(pattern.digit().as('a').letter()).as('a').parse('1x')).toThrow(/appears twice/)
    // oneOf: only one option is recorded, so sharing a name is how you say "either way, call it a".
    expect(pattern.oneOf(pattern.digit().as('a'), pattern.letter().as('a')).end().parse('x').captures).toEqual({ a: 'x' })
    // Each item of a captured repetition is its own scope.
    const kv = pattern.oneOrMore(pattern.letter().as('k').digit().as('v')).as('pairs')
    expect(kv.letter().as('k').parse('a1b2z').captures).toEqual({
      pairs: [
        { k: 'a', v: '1' },
        { k: 'b', v: '2' },
      ],
      k: 'z',
    })
  })

  it('CSV, correctly: quoted fields, doubled quotes, commas and newlines inside', () => {
    const field = pattern.oneOf(pattern.quoted('"', { escape: 'double' }), pattern.optional(pattern.charsNotIn(',\n')))
    const row = pattern.listOf(field, { separatedBy: ',' }).as('fields')
    const csv = pattern.listOf(row, { separatedBy: '\n' }).as('rows')
    const r = csv.parse('name,quote\n"Ada","said ""hi"", then\nleft",x')
    expect(r.ok && r.captures.rows).toEqual([
      { fields: ['name', 'quote'] },
      { fields: ['Ada', 'said "hi", then\nleft', 'x'] },
    ])
  })
})

group('structure regex cannot express', () => {
  it('balanced closes at its own delimiter, skipping quoted text', () => {
    const call = pattern.wordChars().as('fn').balanced('(', ')', { quotes: '"\'' }).as('args')
    expect(call.parse('f(a, g(b), ")")').captures).toEqual({ fn: 'f', args: 'a, g(b), ")"' })
    expect(call.matches('f(a, g(b)')).toBe(false)
  })

  it('quoted keeps escapes except before the quote or the escape', () => {
    const s = pattern.quoted('"', { escape: '\\' }).as('s')
    expect(s.parse('"a\\"b\\\\c\\n"').captures.s).toBe('a"b\\c\\n')
  })

  it('until stops before the first occurrence', () => {
    const comment = pattern.text('<!--').until('-->').as('body').text('-->')
    expect(comment.find('x <!-- a - b --> y')?.captures.body).toBe(' a - b ')
  })
})

group('operations', () => {
  const word = pattern.letters()
  it('find / findAll / occursIn', () => {
    expect(word.find('12 abc 3')).toMatchObject({ text: 'abc', start: 3, end: 6 })
    expect(word.findAll('a bb ccc').map((m) => m.text)).toEqual(['a', 'bb', 'ccc'])
    expect(pattern.digit().occursIn('abc')).toBe(false)
  })

  it('replaceAll with a template, replaceFirst, split', () => {
    const price = pattern.text('$').number().as('n')
    expect(price.replaceAll('$5 and $7.5', '{n} USD')).toBe('5 USD and 7.5 USD')
    expect(price.replaceFirst('$5 and $7.5', '{{{n}}}')).toBe('{5} and $7.5')
    expect(() => price.replaceAll('$5', '{x}')).toThrow(/captures \{n\}/)
    expect(pattern.text(',').optional(pattern.whitespace()).split('a, b,c')).toEqual(['a', 'b', 'c'])
  })

  it('a template inserts the matched TEXT of a capture, not its value (owner, 2026-11-03)', () => {
    const price = pattern.text('$').number().as('amount')
    expect(price.replaceAll('$3.50', '{amount} USD')).toBe('3.50 USD')
    expect(price.replaceAll('$1e3 and $0.10', '{amount}')).toBe('1e3 and 0.10')
    // The function form has both: the value and the text.
    const m = price.find('$3.50')!
    expect([m.captures.amount, m.texts.amount]).toEqual([3.5, '3.50'])
    expect(price.replaceAll('$3.50', (m) => `${(m.captures.amount as number) * 2} (${m.texts.amount}×2)`)).toBe('7 (3.50×2)')
    // A quoted capture's text includes the quotes; its value is the inside.
    const q = pattern.quoted('"').as('s')
    expect(q.replaceAll('say "hi"', '<{s}>')).toBe('say <"hi">')
    expect(q.parse('"hi"')).toMatchObject({ captures: { s: 'hi' }, texts: { s: '"hi"' } })
  })

  it('parse says where and what it expected', () => {
    const date = pattern.digits(4).text('-').digits(2)
    const r = date.parse('2026-1x')
    expect(r.ok).toBe(false)
    if (!r.ok) expect(r.error).toMatchObject({ at: 6, line: 1, column: 7, expected: ['a digit'] })
  })

  it('find and findAll step by whole code points, never into the middle of an emoji', () => {
    const lowHalf = pattern.charIn('\udc00-\udfff')
    expect(lowHalf.find('😀')).toBeNull()
    expect(lowHalf.findAll('a😀b')).toEqual([])
    expect(pattern.zeroOrMore('x').findAll('😀').map((m) => m.start)).toEqual([0, 2])
  })

  it('lineStart / lineEnd', () => {
    const line = pattern.lineStart().letters().as('l').lineEnd()
    expect(line.findAll('ab\ncd\n9').map((m) => m.captures.l)).toEqual(['ab', 'cd'])
  })

  it('a line is the same whether \n, \r\n or \r ended it; lineStart, lineEnd and lineBreak agree', () => {
    const line = pattern.lineStart().letters().as('l').lineEnd()
    for (const br of ['\n', '\r\n', '\r'])
      expect([br, line.findAll(['ab', 'cd', 'ef'].join(br)).map((m) => m.captures.l)]).toEqual([br, ['ab', 'cd', 'ef']])
    // Never inside a \r\n: no line ends between its \r and \n, and none starts there.
    const at = (p: Pattern, s: string) => p.findAll(s).map((m) => m.start)
    expect(at(pattern.lineEnd(), 'a\r\nb')).toEqual([1, 4])
    expect(at(pattern.lineStart(), 'a\r\nb')).toEqual([0, 3])
    // Each line end is followed by a line break or the end, and each line break by a line start.
    const text = 'a\r\n\nb\r\rc\n'
    for (const m of pattern.lineEnd().findAll(text))
      expect(pattern.oneOf(pattern.lineBreak(), pattern.end()).find(text, { from: m.start })?.start).toBe(m.start)
    expect(at(pattern.lineBreak().lineStart(), text)).toEqual(at(pattern.lineBreak(), text))
  })
})

group('lines, and blocks by indentation (Python, Markdown)', () => {
  it('restOfLine is everything up to the line break, possibly nothing', () => {
    const heading = pattern.lineStart().text('# ').restOfLine().as('title')
    expect(heading.findAll('# One\r\ntext\n# Two\n# \n').map((m) => m.captures.title)).toEqual(['One', 'Two', ''])
    expect(pattern.restOfLine().describe()).toBe('the rest of the line')
    expect(pattern.text('#').restOfLine().toCode()).toBe("pattern.text('#').restOfLine()")
  })

  const python = [
    'def f(x):',
    '    if x:',
    '        return 1',
    '',
    '    return 2',
    '',
    'def g():',
    '    pass',
  ].join('\n')
  const def = pattern.lineStart().text('def ').wordChars().as('name').restOfLine().indentedBlock().as('body')

  it('a Python body: deeper lines, blank lines inside, stopping at the same indentation or less', () => {
    expect(def.findAll(python).map((m) => m.captures)).toEqual([
      { name: 'f', body: 'if x:\n    return 1\n\nreturn 2' },
      { name: 'g', body: 'pass' },
    ])
    // The body is dedented, so it parses again: the `if` inside f has its own block.
    const ifs = pattern.lineStart().text('if ').restOfLine().indentedBlock().as('then')
    expect(ifs.find(def.find(python)!.captures.body as string)?.captures.then).toBe('return 1')
  })

  it('a blank line after the block is not in it; the next line starts right after it', () => {
    const m = def.find(python)!
    expect(python.slice(m.end)).toStartWith('\n\ndef g')
  })

  it('a Markdown list item and its continuation lines', () => {
    const md = '- one\n  more of one\n\n  still one\n- two\n'
    const item = pattern.lineStart().text('- ').restOfLine().as('first').optional(pattern.indentedBlock().as('rest'))
    expect(item.findAll(md).map((m) => m.captures)).toEqual([
      { first: 'one', rest: 'more of one\n\nstill one' },
      { first: 'two' },
    ])
  })

  it('needs at least one deeper line, works with \r\n, and mixed tabs/spaces end the block', () => {
    expect(pattern.text('a:').indentedBlock().find('a:\nb')).toBeNull()
    expect(pattern.text('a:').indentedBlock().find('a:')).toBeNull()
    expect(pattern.text('a:').indentedBlock().as('b').find('a:\r\n  x\r\n  y\r\nz')?.captures.b).toBe('x\ny')
    // The header is indented with a tab; a line indented with spaces is not "deeper" than it.
    expect(pattern.text('a:').indentedBlock().as('b').find('\ta:\n\t  x\n    y')?.captures.b).toBe('x')
  })
})

group('columns, and one row per line', () => {
  const fixed = pattern.lines(
    pattern.columns([
      { name: 'name', width: 10 },
      { name: 'qty', width: 6 },
      { name: 'price', width: 8 },
    ])
  )

  it('fixed width: values trimmed of padding; a line may end early (editors strip trailing spaces)', () => {
    const table = 'widget    12    3.50\ngadget    7     12.00\nbolt      100\n'
    expect(fixed.parse(table).value).toEqual([
      { name: 'widget', qty: '12', price: '3.50' },
      { name: 'gadget', qty: '7', price: '12.00' },
      { name: 'bolt', qty: '100', price: '' },
    ])
  })

  it('a line longer than the columns is an error at the column, not silently cut', () => {
    const r = fixed.parse('widget    12    3.50    extra')
    expect(r.ok).toBe(false)
    if (!r.ok) expect(r.error.column).toBe(25)
  })

  it('delimited: values as written, every column required', () => {
    const tsv = pattern.lines(pattern.columns(['name', 'qty'], { separatedBy: '\t' }))
    expect(tsv.parse('a\t1\r\nb c\t\r\n').value).toEqual([
      { name: 'a', qty: '1' },
      { name: 'b c', qty: '' },
    ])
    const r = tsv.parse('a\t1\nb')
    expect(r.ok).toBe(false)
    if (!r.ok) expect(r.error.message).toMatch(/before qty/)
    // Aligned by runs of spaces: the separator is a pattern.
    const ls = pattern.columns(['mode', 'size', 'file'], { separatedBy: pattern.blanks() })
    expect(ls.find('-rw-r--r--   1024  notes.md')?.value).toEqual({ mode: '-rw-r--r--', size: '1024', file: 'notes.md' })
  })

  it('a header line, then the rows; a row captured by name', () => {
    const table = pattern.restOfLine().lineBreak().lines(pattern.columns([{ name: 'n', width: 3 }])).as('rows')
    expect(table.parse('N\n1\n22\n').captures.rows).toEqual([{ n: '1' }, { n: '22' }])
  })

  it('lines() alone is the lines, whichever convention ended them', () => {
    expect(pattern.lines().parse('a\r\nb\rc\n').value).toEqual(['a', 'b', 'c'])
    expect(pattern.lines().toCode()).toBe('pattern.lines()')
  })

  it('a trailing separator, when allowed', () => {
    const args = pattern.listOf(pattern.wordChars(), { separatedBy: ',', trailing: true })
    expect(args.parse('a,b,').value).toEqual(['a', 'b'])
    expect(pattern.listOf(pattern.wordChars(), { separatedBy: ',' }).matches('a,b,')).toBe(false)
  })

  it('columns() refuses mistakes at the call', () => {
    expect(() => pattern.columns([{ name: 'a', width: 0 }])).toThrow(/whole number > 0/)
    expect(() => pattern.columns(['a', 'a'], { separatedBy: ',' })).toThrow(/appears twice/)
    expect(() => pattern.columns(['a', 'b'] as any)).toThrow(/separates/)
    expect(() => pattern.columns([{ name: '1x', width: 2 }])).toThrow(/identifier/)
    expect(() => pattern.columns({ a: 3 } as any)).toThrow(/name: 'a', width: 10/)
  })

  it('toCode writes them back', () => {
    const code = "pattern.lines(pattern.columns([{ name: 'name', width: 10 }, { name: 'qty', width: 6 }]))"
    expect(run(code).toCode()).toBe(code)
    const d = "pattern.columns(['a', 'b'], { separatedBy: '\\t' })"
    expect(run(d).toCode()).toBe(d)
  })
})

group('startAt / startAfter: where the match begins', () => {
  it('the rows after a header line: the value is the rows', () => {
    const rows = pattern.columns([{ name: 'n', width: 3 }])
    const table = pattern.startAfter(pattern.lineBreak()).lines(rows)
    expect(table.parse('N\n1\n22\n').value).toEqual([{ n: '1' }, { n: '22' }])
    expect(table.describe()).toBe('starting after a line break, then a row of columns n (3 wide), one per line')
  })

  it('the skipped text is consumed but not matched: text, start and replaceAll see only the rest', () => {
    const price = pattern.startAfter('$').number().as('n')
    expect(price.findAll('a $5, b $3.50').map((m) => [m.start, m.text, m.captures.n])).toEqual([
      [3, '5', 5],
      [9, '3.50', 3.5],
    ])
    expect(price.replaceAll('a $5, b $3.50', '{n}0')).toBe('a $50, b $3.500')
    const heading = pattern.startAt('# ').restOfLine()
    expect(heading.findAll('x\n# One\n# Two').map((m) => m.text)).toEqual(['# One', '# Two'])
  })

  it('only as the first step: elsewhere it is an error, at the call or at first use', () => {
    expect(() => pattern.digit().startAfter('x')).toThrow(/begins a pattern/)
    expect(() => pattern.oneOf(pattern.startAfter('x'), 'y').find('xy')).toThrow(/first step/)
    expect(() => pattern.text('a').group(pattern.startAt('b')).find('ab')).toThrow(/first step/)
    // A label or a capture around the whole pattern is fine.
    expect(pattern.startAfter(':').restOfLine().describedAs('a value').find('k: v')?.text).toBe(' v')
    expect(() => pattern.startAfter(pattern.digit().as('d'))).not.toThrow()
    expect(() => pattern.startAfter(pattern.digit().as('d')).find('1')).toThrow(/skipped/)
  })

  it('a search with a skip stays linear, whether or not the target is there', () => {
    const p = pattern.startAfter('$').digits()
    const perChar = (s: string) => {
      let lo = 1
      let hi = 1e9
      while (lo < hi) {
        const mid = Math.floor((lo + hi) / 2)
        try {
          p.findAll(s, { maxSteps: mid })
          hi = mid
        } catch {
          lo = mid + 1
        }
      }
      return lo / s.length
    }
    for (const make of [(n: number) => 'x'.repeat(n), (n: number) => '$x'.repeat(n / 2), (n: number) => '$1 '.repeat(n / 3)])
      expect(perChar(make(24_000))).toBeLessThan(perChar(make(1_200)) * 1.5 + 1)
  })

  it('toCode writes it back', () => {
    expect(pattern.startAfter(pattern.lineBreak()).lines().toCode()).toBe('pattern.startAfter(pattern.lineBreak()).lines()')
    expect(pattern.startAt('# ').restOfLine().toCode()).toBe("pattern.startAt('# ').restOfLine()")
  })
})

group('the step budget bounds the work', () => {
  it('a budget that is too small throws, naming the budget', () => {
    expect(() => pattern.anyChars().parse('x'.repeat(10_000), { maxSteps: 1_000 })).toThrow(PatternBudgetError)
  })

  it('every loop in the engine pays for its work, or says where it is paid', () => {
    // A loop that consumes input without charging step() is work the budget cannot see: on
    // untrusted patterns that is unbounded CPU (0.1.0 review B1, M1). New loops must say which.
    const src = readFileSync(new URL('./engine.ts', import.meta.url), 'utf8').split('\n')
    const unpaid = src.flatMap((line, i) => {
      if (!/\b(while|for) \(/.test(line) || line.includes('// charged:')) return []
      const body = src.slice(i, i + 3).join('\n')
      return /\bstep\(ctx/.test(body) ? [] : [`engine.ts:${i + 1}: ${line.trim()}`]
    })
    expect(unpaid).toEqual([])
  })

  it('a run of blank lines is charged, under indentedBlock', () => {
    const block = fromJSON({ kind: 'indentedBlock' })
    expect(() => block.findAll('\n'.repeat(20_000), { maxSteps: 200_000 })).toThrow(PatternBudgetError)
    // One step or more per line, so the budget sees the scan.
    const p = pattern.text('a').indentedBlock()
    const steps = (n: number) => p.parse('a\n' + '\n'.repeat(n) + '  x').steps
    expect(steps(10_000) - steps(1_000)).toBeGreaterThanOrEqual(9_000)
    // A very long run is a pattern answer, not a stack overflow.
    expect(p.find('a\n' + '\n'.repeat(2_000_000) + '  x')).not.toBeNull()
  })

  it('the last delimited column is charged', () => {
    const p = pattern.columns(['a'], { separatedBy: ',' }).text('!')
    expect(() => p.findAll('x'.repeat(40_000), { maxSteps: 1_000_000 })).toThrow(PatternBudgetError)
    const one = pattern.columns(['a'], { separatedBy: ',' })
    expect(one.parse('x'.repeat(4_000)).steps).toBeGreaterThanOrEqual(4_000)
  })

  it('work is linear in input for a plain pattern', () => {
    const p = pattern.lowercaseLetters().end()
    const steps = (n: number) => p.parse('a'.repeat(n)).steps / n
    expect(steps(64_000)).toBeLessThan(steps(1_000) * 1.2 + 1)
  })
})

group('JSON', () => {
  it('round-trips', () => {
    const p = pattern.start().digits(1, 3).as('n').optional(pattern.anyCase('px')).end()
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
    const p = pattern.text('a').digit()
    expect(Object.isFrozen(p.node)).toBe(true)
    expect(Object.isFrozen(p.steps)).toBe(true)
    expect(() => {
      ;(p.node as any).items.push({ kind: 'anyChar' })
    }).toThrow()
  })

  it('building refuses mistakes at the call that made them', () => {
    expect(() => pattern.oneOf('a')).toThrow(/at least two/)
    expect(() => pattern.digits(-1)).toThrow(/whole number/)
    expect(() => pattern.digits(3, 1)).toThrow(/below the minimum/)
    expect(() => pattern.digits(undefined, 3)).toThrow(/minimum before the maximum/)
    expect(() => pattern.digit().as('1x')).toThrow(/identifier/)
    expect(() => pattern.oneOf('a', null as any)).toThrow(/option 2/)
    expect(() => pattern.text('')).toThrow(/empty string/)
    expect(() => pattern.optional((() => pattern.digit()) as any)).toThrow(/not a function/)
    expect(() => pattern.listOf('a', {} as any)).toThrow(/separatedBy/)
  })
})

group('toCode() writes the chain that builds the pattern', () => {
  const CASES: [Pattern, string][] = [
    [pattern.start().digits(3).text('-').digits(4).end(), "pattern.start().digits(3).text('-').digits(4).end()"],
    [pattern.text('v').digits().as('major'), "pattern.text('v').digits().as('major')"],
    [pattern.optional(pattern.whitespace()).text(','), "pattern.optional(pattern.whitespace()).text(',')"],
    [pattern.oneOf('yes', pattern.anyCase('no')), "pattern.oneOf('yes', pattern.anyCase('no'))"],
    [pattern.group(pattern.digits().text('.').digits()).as('n'), "pattern.group(pattern.digits().text('.').digits()).as('n')"],
    [pattern.charsIn('a-f0-9', 6), "pattern.charsIn('a-f0-9', 6)"],
    [pattern.charNotIn("-'\\\n"), "pattern.charNotIn('-\\'\\\\\\n')"],
    [pattern.letter().optional(pattern.wordChars()).describedAs('an id'), "pattern.letter().optional(pattern.wordChars()).describedAs('an id')"],
    [pattern.listOf(pattern.integer(), { separatedBy: ',', atLeast: 1 }), "pattern.listOf(pattern.integer(), { separatedBy: ',', atLeast: 1 })"],
    [pattern.whitespace(1).lineBreaks(2, Infinity), 'pattern.whitespace(1).lineBreaks(2, Infinity)'],
    // A dash from a regex class is written last, unescaped, as people write it.
    [fromJSON({ kind: 'chars', ranges: [[45, 45], [48, 57], [97, 122]] }), "pattern.charIn('0-9a-z-')"],
    [fromJSON({ kind: 'chars', ranges: [[45, 45]] }), "pattern.charIn('-')"],
  ]
  for (const [p, code] of CASES)
    it(code, () => {
      expect(p.toCode()).toBe(code)
      // Labels are for people (a chars node read from JSON has none; the rebuilt one does), so
      // compare everything else.
      const unlabelled = (n: unknown) => JSON.stringify(n, (k, v) => (k === 'label' || k === 'plural' ? undefined : v))
      expect(unlabelled(run(code))).toBe(unlabelled(p))
    })
})

/**
 * The differential corpus: each pattern against the regex a fluent engineer would write, on
 * the same inputs, whole-string. Regex is the ORACLE here and only here (this library uses no
 * RegExp). Every row is a case where possessive/ordered semantics agree with backtracking;
 * rows where they DIFFER belong in the "semantics" group above, stated.
 */
const CORPUS: [RegExp, Pattern, string[]][] = [
  [/^\d{3}-\d{4}$/, pattern.start().digits(3).text('-').digits(4).end(), ['555-1234', '55-1234', '555-12345', 'abc-defg']],
  [/^[a-z]+$/, pattern.start().lowercaseLetters().end(), ['abc', 'aBc', '', 'z']],
  [/^#[0-9a-fA-F]{6}$/, pattern.text('#').hexDigits(6).end(), ['#c0ffee', '#C0FFEE', '#c0ffe', '#g0ffee']],
  [/^\s*\w+\s*=\s*\d+\s*$/, pattern.optional(pattern.whitespace()).wordChars().optional(pattern.whitespace()).text('=').optional(pattern.whitespace()).digits().optional(pattern.whitespace()).end(), ['a=1', '  key = 42 ', 'k=', '=1']],
  [/^(?:yes|no)$/i, pattern.oneOf(pattern.anyCase('yes'), pattern.anyCase('no')).end(), ['yes', 'YES', 'No', 'maybe']],
  [/^v\d+(?:\.\d+){0,2}$/, pattern.text('v').digits().repeat(pattern.text('.').digits(), 0, 2).end(), ['v1', 'v1.2', 'v1.2.3', 'v1.2.3.4', 'v']],
  [/^(?!_)\w+$/, pattern.ifNotFollowedBy('_').wordChars().end(), ['ok', '_no', 'a_b']],
  [/^\d+(?=px$)/, pattern.digits().ifFollowedBy(pattern.text('px').end()), ['12px', '12em', 'px']],
  [/^a{2,}$/, pattern.repeat('a', 2, Infinity).end(), ['a', 'aa', 'aaaa']],
]

group('agrees with the regex a fluent engineer would write', () => {
  for (const [re, p, inputs] of CORPUS)
    it(`${re}  ≡  ${p.describe()}`, () => {
      for (const s of inputs) {
        // `find` from 0 with a start-anchored pattern is the regex's `test`.
        const got = p.find(s) !== null && p.find(s)!.start === 0
        expect([s, got]).toEqual([s, re.test(s)])
      }
      expect(run(p.toCode()).toJSON()).toEqual(p.toJSON())
    })
})

/**
 * The node set is CLOSED, and each kind lives in five places: `nodes.ts`, the engine,
 * `describe.ts`, `fromJSON` and `toCode`. `Record<Kind, …>` makes the compiler refuse a sample list that
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
  indentedBlock: { kind: 'indentedBlock' },
  startAt: { kind: 'startAt', item: { kind: 'literal', text: ',' }, after: true },
  columns: { kind: 'columns', names: ['a', 'b'], widths: [1, 2], separator: null },
  number: { kind: 'number' },
  integer: { kind: 'integer' },
}

group('every node kind is handled in all five places', () => {
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
      const p = fromJSON(JSON.parse(JSON.stringify(node)))
      expect(p.toJSON()).toEqual(node)
      // toCode writes it as a chain; running that gives the same matching (labels may differ).
      const back = run(p.toCode())
      for (const input of ['', 'a', 'aa,a', '"a"', '(a)', '-1.5', 'x\n'])
        expect([input, back.find(input)?.text]).toEqual([input, p.find(input)?.text])
    })
})
