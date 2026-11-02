# tosijs-pattern

**Matching that reads like what it means.**

A good regex programmer reads `^\d{3}-\d{4}$` aloud as "three digits, a dash, four digits".
Almost nobody else can, and nobody can read it at a glance once it grows. tosijs-pattern
writes the reading down:

```js
import { sequence, start, times, digit, end } from 'tosijs-pattern'
import { show } from 'tosijs-pattern/demo'

const phone = sequence(start, times(3, digit), '-', times(4, digit), end)

show(preview, phone.describe(), phone.matches('555-1234'), phone.matches('55-1234'))
```

Every pattern can say what it is (`describe()`). Plain strings are literal text, so there is
nothing to escape, ever. And when something does not match, it says where and why:

```js
import { sequence, capture, number, optional, oneOrMore, whitespace } from 'tosijs-pattern'
import { show } from 'tosijs-pattern/demo'

const price = sequence('price:', optional(oneOrMore(whitespace)), capture('amount', number))

show(
  preview,
  price.parse('price: 42.50').captures,   // { amount: 42.5 }, a number
  price.parse('price: forty').error.message
)
```

## Regex, read aloud

| Regex | Pattern |
| --- | --- |
| `\d+` | `oneOrMore(digit)` |
| `[a-f0-9]{6}` | `times(6, charIn('a-f0-9'))` |
| `(,\s*)?` | `optional(sequence(',', zeroOrMore(whitespace)))` |
| `yes\|no` | `oneOf('yes', 'no')` |
| `(?<year>\d{4})` | `capture('year', times(4, digit))` |
| `(?!_)` | `notFollowedBy('_')` |
| `.*?-->` | `until('-->')` |
| `^…$` | `sequence(start, …, end)` |

**Nouns** are characters: `digit`, `letter`, `lowercase`, `hexDigit`, `wordChar`, `whitespace`,
`anyChar`, `charIn('a-z')`, `charNotIn(',\n')`. **Verbs** take nouns or other patterns:
`oneOrMore`, `zeroOrMore`, `optional`, `times`, `between`, `atLeast`, `atMost`, `oneOf`,
`sequence`, `capture`. The full list is in [the vocabulary](docs-src/vocabulary.md).

## What regex cannot do

Some of the most common reasons people reach for a regex are things a regex cannot actually
do: a quoted string with escapes, a list separated by commas, a nested `(…)` that closes at its
own parenthesis. People write a regex anyway, and it is wrong on the edge cases. These are
named pieces here.

CSV, correctly (quoted fields, doubled quotes inside them, commas and line breaks inside quotes):

```js
import { oneOf, quoted, optional, oneOrMore, charNotIn, capture, separatedBy } from 'tosijs-pattern'
import { show } from 'tosijs-pattern/demo'

const field = oneOf(quoted('"', { escape: 'double' }), optional(oneOrMore(charNotIn(',\n'))))
const row = capture('fields', separatedBy(field, ','))
const csv = capture('rows', separatedBy(row, '\n'))

show(preview, csv.parse('name,said\n"Ada","she said ""hi"", then left"').captures)
```

A function call's arguments, nested and quote-aware. No regex can match this, because balanced
delimiters are not a regular language:

```js
import { sequence, capture, oneOrMore, wordChar, balanced } from 'tosijs-pattern'
import { show } from 'tosijs-pattern/demo'

const call = sequence(
  capture('fn', oneOrMore(wordChar)),
  capture('args', balanced('(', ')', { quotes: '"\'' }))
)

show(preview, call.find('x = f(a, g(b), ")") + 1').captures)
```

## Search and replace

```js
import { sequence, capture, number } from 'tosijs-pattern'
import { show } from 'tosijs-pattern/demo'

const dollars = sequence('$', capture('amount', number))

show(
  preview,
  dollars.findAll('was $5, now $3.50').map((m) => m.captures.amount),
  dollars.replaceAll('was $5, now $3.50', '{amount} USD')
)
```

The values are numbers (`5`, `3.5`), but a template inserts each capture's matched TEXT, so
`$3.50` becomes `3.50 USD`. A function replacement gets both: `m.captures` (values) and
`m.texts` (the text as written).

`find`, `findAll`, `occursIn`, `replaceFirst`, `replaceAll` (a `{name}` template or a function),
`split`, `matches` (the whole string) and `parse` (the whole string, with an error that says
where).

## How it matches, and why it is safe

- **No backtracking.** Repetition takes as much as it can and never gives it back, and
  `oneOf` takes the first option that matches. So a pattern's cost is visible from its shape,
  and there is no catastrophic case: the exponential blow-ups behind regex denial of service
  (ReDoS) cannot happen. The difference shows in exactly one place, and it is a feature:
  `sequence(oneOrMore(digit), '5')` does not match `"1235"`, because the digits took the 5.
  A regex finds that match only by retrying; here, a pattern that would need retrying is one
  that has not said what it means.
- **A step budget.** Every call counts its work and stops at `maxSteps`
  (default 10 million) with a `PatternBudgetError`, so the worst case is the caller's choice.
- **Patterns are data.** `toJSON()` gives plain JSON and `fromJSON()` reads it back,
  validating every node, so a pattern can be stored, sent, and accepted from someone you do not
  trust: there is no code in it.
- **No RegExp inside.** Character sets are code-point ranges; matching is loops.

## Status

`0.1.0-dev`: the core vocabulary, engine and tests. Not yet published. See
[CLAUDE.md](CLAUDE.md) for where it is going: a regex-to-Pattern translator, a code-editing
mode and CLI, and the AsyncJS (tjs-lang) builtin.
