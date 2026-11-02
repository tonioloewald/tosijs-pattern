<!--{"order": 10}-->

# Vocabulary

Every name is chosen by one test: **read the pattern aloud, and it should say what it matches.**
`describe()` does exactly that, so any pattern can be checked against its intent.

```js
import { sequence, capture, oneOrMore, letter, wordChar, zeroOrMore, optional, charIn } from 'tosijs-pattern'
import { show } from 'tosijs-pattern/demo'

const identifier = sequence(letter, zeroOrMore(wordChar))
const flag = sequence('--', capture('name', identifier), optional(sequence('=', capture('value', oneOrMore(charIn('a-z0-9'))))))

show(preview, flag.describe(), flag.parse('--level=9').captures)
```

## Nouns: one character

| Name | Matches | Regex |
| --- | --- | --- |
| `digit` | 0-9 | `\d` |
| `hexDigit` | 0-9, a-f, A-F | `[0-9a-fA-F]` |
| `letter` | A-Z, a-z (ASCII for now) | `[A-Za-z]` |
| `lowercase`, `uppercase` | a-z, A-Z | `[a-z]`, `[A-Z]` |
| `wordChar` | A-Z, a-z, 0-9, _ | `\w` |
| `whitespace` | exactly JavaScript's `\s` | `\s` |
| `blank` | space or tab | `[ \t]` |
| `anyChar` | any character, line breaks included | `[^]`, or `.` with `s` |
| `charIn('a-z_')` | one of a range string | `[a-z_]` |
| `charNotIn(',\n')` | anything else | `[^,\n]` |

A range string is characters and `x-y` ranges. A `-` first or last is itself, and `\` makes the
next character literal. There are no class escapes inside it: name the noun instead.

## Positions: match no characters

| Name | Matches | Regex |
| --- | --- | --- |
| `start`, `end` | the start or end of the input | `^`, `$` |
| `lineStart`, `lineEnd` | the start or end of a line | `^`, `$` with `m` |
| `followedBy(p)` | if `p` comes next | `(?=p)` |
| `notFollowedBy(p)` | if `p` does not come next | `(?!p)` |

## Verbs: combine patterns

| Name | Matches | Regex |
| --- | --- | --- |
| `sequence(a, b, …)` | each in order | `ab…` |
| `oneOf(a, b, …)` | the FIRST that matches | `a\|b` |
| `optional(p)` | `p` or nothing | `p?` |
| `zeroOrMore(p)`, `oneOrMore(p)` | as many as match | `p*`, `p+` |
| `times(n, p)` | exactly n | `p{n}` |
| `between(m, n, p)`, `atLeast(n, p)`, `atMost(n, p)` | bounded repetition | `p{m,n}`, `p{n,}`, `p{0,n}` |
| `caseless('text')` | the text in any case | `(?i:text)` |
| `capture('name', p)` | `p`, recording it | `(?<name>p)` |
| `describedAs('an id', p)` | `p`, named for messages | (none) |

A plain string anywhere is that literal text.

## Structure: what regex cannot express

| Name | Matches |
| --- | --- |
| `until(p)` | everything up to the first `p` (`.*?` before `p`, without the retrying) |
| `quoted('"', { escape })` | a quoted span; `escape` is a character or `'double'` (CSV's `""`); its value is the inside |
| `balanced('(', ')', { quotes })` | a nested span that closes at its own delimiter, skipping quoted text; its value is the inside |
| `separatedBy(item, sep)` | a list; its value is an array |
| `number`, `integer` | JSON's number grammar; the value is a number |

## Values and captures

A capture records its pattern's VALUE: the text it matched, unless the piece has a better one
(`number` gives a number, `quoted` the unescaped inside, `separatedBy` an array). A capture
inside a repetition is collected by capturing the repetition, one entry per item:

```js
import { capture, oneOrMore, sequence, letter, integer, optional } from 'tosijs-pattern'
import { show } from 'tosijs-pattern/demo'

const pair = sequence(capture('key', oneOrMore(letter)), '=', capture('value', integer), optional(';'))
const settings = capture('settings', oneOrMore(pair))

show(preview, settings.parse('width=3;height=4').captures)
```

A capture that would be silently lost (inside a repetition nobody captures) is an error that
says what to write instead.
