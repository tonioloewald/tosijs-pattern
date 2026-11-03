<!--{"pin": "top", "description": "Matching that reads like what it means: a fluent, declarative alternative to regular expressions, with no backtracking and a step budget."}-->

# tosijs-pattern

<img src="https://pattern.tosijs.net/icon.png" alt="tosijs-pattern icon" width="96" height="96">

**Matching that reads like what it means.**

A good regex programmer reads `^\d{3}-\d{4}$` aloud as "three digits, a dash, four digits".
Almost nobody else can, and nobody can read it at a glance once it grows. tosijs-pattern
writes the reading down:

```js
import { pattern } from 'tosijs-pattern'
import { show } from 'tosijs-pattern/demo'

const phone = pattern.start().digits(3).text('-').digits(4).end()

show(preview, {
  'phone.describe()': phone.describe(),
  "phone.matches('555-1234')": phone.matches('555-1234'),
  "phone.matches('55-1234')": phone.matches('55-1234'),
})
```

One import. A chain reads in the order it matches, and typing `pattern.` lists the whole
vocabulary in your editor's autocomplete. Every pattern can also say what it is (`describe()`). Text
is always literal, so there is nothing to escape, ever. And when something does not match, it
says where and why:

```js
import { pattern } from 'tosijs-pattern'
import { show } from 'tosijs-pattern/demo'

const price = pattern.text('price:').optional(pattern.whitespace()).number().as('amount')

show(preview, {
  "price.parse('price: 42.50').captures": price.parse('price: 42.50').captures, // a number
  "price.parse('price: forty').error.message": price.parse('price: forty').error.message,
})
```

## Regex, read aloud

| Regex | Pattern |
| --- | --- |
| `\d` | `pattern.digit()` |
| `\d+` | `pattern.digits()` |
| `\d{4}` | `pattern.digits(4)` |
| `[a-f0-9]{6}` | `pattern.charsIn('a-f0-9', 6)` |
| `\s*` | `pattern.optional(pattern.whitespace())` |
| `(,\s*)?` | `pattern.optional(pattern.text(',').optional(pattern.whitespace()))` |
| `yes\|no` | `pattern.oneOf('yes', 'no')` |
| `(?<year>\d{4})` | `pattern.digits(4).as('year')` |
| `(?!_)` | `pattern.ifNotFollowedBy('_')` |
| `.*?-->` | `pattern.until('-->')` |
| `^…$` | `pattern.start()….end()` |

The rules, which are meant to be guessable without reading them:

- **A singular noun is one character, a plural is one or more**, and a count says how many:
  `digit()`, `digits()`, `digits(4)`, `digits(2, 4)`, `digits(2, Infinity)`. The nouns are
  `digit`, `hexDigit`, `letter`, `lowercaseLetter`, `uppercaseLetter`, `wordChar`,
  `whitespace`, `blank`, `anyChar`, `lineBreak`, and `charIn('a-z')` / `charNotIn(',\n')` for
  your own.
- **Text is `text('…')`**, and a string given to any method (`oneOf('yes', 'no')`) is text too.
- **Nest by starting another chain from `pattern`**: `pattern.optional(pattern.text('.').digits())`.
- **`.as(name)` captures the step just before it.** `.group(…)` makes a chain one step, so
  `.group(pattern.digits().text('.').digits()).as('version')` captures all of it.

The full list is in [the vocabulary](docs-src/vocabulary.md).

## Any regex, as code you can read

`fromRegex()` turns a regex into a pattern where it can prove the two match the same, and
`toCode()` writes any pattern as the chain that builds it. Together they explain an inherited
regex, and replace it:

```js
import { fromRegex } from 'tosijs-pattern'
import { show } from 'tosijs-pattern/demo'

const version = fromRegex(/^v(?<major>\d+)\.(?<minor>\d+)$/)

show(preview, { 'version.toCode()': version.toCode(), 'version.describe()': version.describe() })
```

Where a regex only works by backtracking, it is refused with the reason and what to write
instead. See [From regex](docs-src/from-regex.md).

## What regex cannot do

Some of the most common reasons people reach for a regex are things a regex cannot actually
do: a quoted string with escapes, a list separated by commas, a nested `(…)` that closes at its
own parenthesis. People write a regex anyway, and it is wrong on the edge cases. These are
named pieces here.

CSV, correctly (quoted fields, doubled quotes inside them, commas and line breaks inside quotes):

```js
import { pattern } from 'tosijs-pattern'
import { show } from 'tosijs-pattern/demo'

const field = pattern.oneOf(pattern.quoted('"', { escape: 'double' }), pattern.optional(pattern.charsNotIn(',\n')))
const row = pattern.listOf(field, { separatedBy: ',' }).as('fields')
const csv = pattern.listOf(row, { separatedBy: '\n' }).as('rows')

show(preview, { 'the rows': csv.parse('name,said\n"Ada","she said ""hi"", then left"').captures })
```

A function call's arguments, nested and quote-aware. No regex can match this, because balanced
delimiters are not a regular language:

```js
import { pattern } from 'tosijs-pattern'
import { show } from 'tosijs-pattern/demo'

const call = pattern.wordChars().as('fn').balanced('(', ')', { quotes: '"\'' }).as('args')

show(preview, { 'the call': call.find('x = f(a, g(b), ")") + 1').captures })
```

## Search and replace

```js
import { pattern } from 'tosijs-pattern'
import { show } from 'tosijs-pattern/demo'

const dollars = pattern.text('$').number().as('amount')

show(preview, {
  'the amounts (values)': dollars.findAll('was $5, now $3.50').map((m) => m.captures.amount),
  "replaceAll(…, '{amount} USD')": dollars.replaceAll('was $5, now $3.50', '{amount} USD'),
})
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
  `pattern.digits().text('5')` does not match `"1235"`, because the digits took the 5.
  A regex finds that match only by retrying; here, a pattern that would need retrying is one
  that has not said what it means.
- **A step budget.** Every call counts its work and stops at `maxSteps`
  (default 10 million) with a `PatternBudgetError`, so the worst case is the caller's choice.
- **Patterns are data.** `toJSON()` gives plain JSON and `fromJSON()` reads it back,
  validating every node, so a pattern can be stored, sent, and accepted from someone you do not
  trust: there is no code in it.
- **No RegExp inside.** Character sets are code-point ranges; matching is loops.

## Status

`0.1.0-dev`: the vocabulary, the engine, and `fromRegex()`, which translates a regex where it
can prove the pattern equivalent and refuses it, with the reason, where it cannot (two thirds of
tjs-lang's own regexes translate; see [From regex](docs-src/from-regex.md)). Not yet published.
Next: a look-behind piece (the largest refusal), a code-editing mode and CLI, and the AsyncJS
(tjs-lang) builtin. [CLAUDE.md](CLAUDE.md) has the plan.
