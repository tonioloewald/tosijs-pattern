<!--{"parent": "Guide", "order": 10, "description": "Every noun and verb in tosijs-pattern, what each matches, and the values and captures a pattern gives back."}-->

# Vocabulary

Every name is chosen by one test: **read the chain aloud, and it should say what it matches.**
`describe()` does exactly that, so any pattern can be checked against its intent, and
`toCode()` writes any pattern back as its chain.

```js
import { pattern } from 'tosijs-pattern'
import { show } from 'tosijs-pattern/demo'

const identifier = pattern.letter().optional(pattern.wordChars())
const flag = pattern.text('--').group(identifier).as('name').optional(pattern.text('=').charsIn('a-z0-9').as('value'))

show(preview, {
  'flag.describe()': flag.describe(),
  "flag.parse('--level=9').captures": flag.parse('--level=9').captures,
})
```

Everything starts from `pattern`, the empty pattern. Each method returns a NEW pattern with
one more step, so a chain reads in the order it matches, and a pattern is a value you can name
and reuse (`identifier` above). A method's argument is a string (literal text) or another chain
started from `pattern`. In the tables below, `p` stands for such an argument (and, in the
Regex column, for the regex it would be).

## Nouns: characters

A singular noun is one character. A plural is one or more, and takes a count: `(n)` exactly n,
`(min, max)` a range, `(min, Infinity)` at least min. Zero or more is
`optional(pattern.digits())`.

| One | Several | Matches | Regex |
| --- | --- | --- | --- |
| `digit()` | `digits()` | 0-9 | `\d` |
| `hexDigit()` | `hexDigits()` | 0-9, a-f, A-F | `[0-9a-fA-F]` |
| `letter()` | `letters()` | A-Z, a-z (ASCII for now) | `[A-Za-z]` |
| `lowercaseLetter()` | `lowercaseLetters()` | a-z | `[a-z]` |
| `uppercaseLetter()` | `uppercaseLetters()` | A-Z | `[A-Z]` |
| `wordChar()` | `wordChars()` | A-Z, a-z, 0-9, _ | `\w` |
| | `whitespace()` | exactly JavaScript's `\s` (`whitespace(1)` for one) | `\s` |
| `blank()` | `blanks()` | space or tab | `[ \t]` |
| `anyChar()` | `anyChars()` | any character, line breaks included | `[^]`, or `.` with `s` |
| `lineBreak()` | `lineBreaks()` | `\r\n`, `\n` or `\r` | `\r\n\|\n\|\r` |
| `charIn('a-z_')` | `charsIn('a-z_')` | one of a range string | `[a-z_]` |
| `charNotIn(',\n')` | `charsNotIn(',\n')` | anything else | `[^,\n]` |

A range string is characters and `x-y` ranges. A `-` first or last is itself, and `\` makes the
next character literal. There are no class escapes inside it: name the noun instead.

## Text

| Method | Matches | Regex |
| --- | --- | --- |
| `text('a.b')` | exactly that text; nothing in it is special | `a\.b` |
| `anyCase('yes')` | the text, letters in any case | `(?i:yes)` |

## Positions: match no characters

| Method | Matches | Regex |
| --- | --- | --- |
| `start()`, `end()` | the start or end of the input | `^`, `$` |
| `lineStart()`, `lineEnd()` | the start or end of a line, where a line break is `\r\n`, `\n` or `\r` (the same as `lineBreak()`), so a file's lines are the same whichever convention wrote it | `^`, `$` with `m`, nearly: a regex also breaks lines inside `\r\n` and at `\u2028`/`\u2029` |
| `ifFollowedBy(p)` | if `p` comes next | `(?=p)` |
| `ifNotFollowedBy(p)` | if `p` does not come next | `(?!p)` |

## Combining

| Method | Matches | Regex |
| --- | --- | --- |
| `oneOf('yes', 'no', …)` | the FIRST option that matches; an option is text or a chain, `oneOf('-', pattern.digits())` | `yes\|no\|…` |
| `optional(p)` | `p` or nothing | `p?` |
| `oneOrMore(p)`, `zeroOrMore(p)` | as many as match | `p+`, `p*` |
| `repeat(p, n)`, `repeat(p, min, max)` | exactly n, or min to max (`Infinity`: no limit) | `p{n}`, `p{m,n}` |
| `group(p)` | `p`, as one step (so `.as()` after it takes all of it) | `(?:p)` |

## Naming

| Method | Does | Regex |
| --- | --- | --- |
| `.as('name')` | captures the step just before it | `(?<name>…)` |
| `.describedAs('an id')` | names the whole pattern, for messages and `describe()` | (none) |

There is no `then`: an object with a `then` method is taken for a promise by `await`, so a
pattern does not have one. `text()` and `group()` add a step.

## Structure: what regex cannot express

| Method | Matches |
| --- | --- |
| `until(p)` | everything up to the first `p` (`.*?` before `p`, without the retrying) |
| `quoted('"', { escape })` | a quoted span; `escape` is a character or `'double'` (CSV's `""`); its value is the inside |
| `balanced('(', ')', { quotes })` | a nested span that closes at its own delimiter, skipping quoted text; its value is the inside |
| `listOf(item, { separatedBy, atLeast })` | a list; its value is an array |
| `restOfLine()` | everything up to the line break, possibly nothing (regex `.*` without `s`) |
| `indentedBlock()` | at the end of a line, the lines after it indented DEEPER than it (a Python body, a Markdown list item's continuation), blank lines between them included; it stops before the first line indented the same or less. Its value is the lines with their common indentation removed, so it can be parsed again |
| `number()`, `integer()` | JSON's number grammar; the value is a number |

A Python function and its body, which parses again as Python:

```js
import { pattern } from 'tosijs-pattern'
import { show } from 'tosijs-pattern/demo'

const source = 'def area(w, h):\n    if w < 0:\n        return 0\n\n    return w * h\n\nprint(area(2, 3))'
const def = pattern.lineStart().text('def ').wordChars().as('name').restOfLine().indentedBlock().as('body')
const found = def.find(source)

show(preview, { 'def.describe()': def.describe(), 'found.captures': found.captures })
```

## Values and captures

A capture records its step's VALUE: the text it matched, unless the piece has a better one
(`number()` gives a number, `quoted` the unescaped inside, `listOf` an array). A capture
inside a repetition is collected by capturing the repetition, one entry per item:

```js
import { pattern } from 'tosijs-pattern'
import { show } from 'tosijs-pattern/demo'

const pair = pattern.letters().as('key').text('=').integer().as('value').optional(';')
const settings = pattern.oneOrMore(pair).as('settings')

show(preview, { "settings.parse('width=3;height=4').captures": settings.parse('width=3;height=4').captures })
```

Beside its value, every capture keeps the TEXT it matched, as written: `texts` on a parse
result or a match. `{name}` in a replacement template inserts the text (so `$3.50` stays
`3.50`, and a `quoted` capture keeps its quotes); a replacement function sees both.

A capture that would be silently lost is an error that says what to write instead: inside a
repetition nobody captures, inside `ifFollowedBy`/`ifNotFollowedBy`/`until`'s stopping point,
or a name used twice where the second would overwrite the first (`oneOf` options may share one).
