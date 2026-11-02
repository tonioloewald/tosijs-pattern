# fromRegex: what translates (2026-11-03)

The owner's question (2026-11-02): *to what extent could we provide a regex to our translator and
simply refuse to run regexes that don't translate?* Answered with numbers, over two corpora.

Method: every distinct regex literal (source + flags) in the files under each directory is
translated by `fromRegex()`, or refused with a code. Every translation is run against its regex
(the host `RegExp`, as the oracle) on about 120 generated inputs per regex: strings built from
the regex's own syntax tree, then mutated, joined and padded (`scripts/regex-diff.ts`). Both
`find` (position, text and every group) and `findAll` (every match) must agree.

The check was itself checked: with the repetition rule switched off, 71 translations in corpus 1
disagree; with the alternation rule off, 287 across both. So "0 disagree" is evidence.

Reproduce: `bun scripts/from-regex-report.ts <dir>`. Corpora: tjs-lang at `4293add2`.

## Findings

1. **Two thirds of tjs-lang's own regexes translate exactly, and none disagree with their regex**
   (53% of a large `node_modules`, which is lexer-heavy). Every translation is provably
   equivalent by the local check, and agreed on every generated input.
2. **The largest refusal is not backtracking; it is looking BEHIND.** `\b`, `^` with the
   `m` flag, and lookbehind all ask about the character before the position, which Pattern
   cannot yet: 20.9% of tjs-lang's regexes, 26.3% of `node_modules`'. A zero-width
   `precededBy` (and `wordBoundary`, and a `lineStart` with JavaScript's line terminators)
   would lift the translated share to at most 88% and 80% (some of those regexes would then meet
   another refusal). That is the single most valuable
   addition, and it is the owner's call (a new node kind).
3. **Backtracking proper** (`repetition-backtracks`, `alternation-backtracks`, `lazy`) is
   11% and 16%. Many are refused correctly: `/^[^\s@]+@[^\s@]+\.[^\s@]+$/` (the common email
   check) matches only because the regex gives back dots. Some are refused only because the check
   is local and conservative; the mutation runs above show most refusals in these classes would
   indeed disagree, but not all (switching the repetition rule off in tjs-lang added 13 agreeing
   translations beside the 71 disagreeing ones).
   The next gains: recognise the structure (`"(?:[^"\\]|\\.)*"` is `quoted`) and reorder
   alternations where the longer option can go first provably.
4. **Backreferences are rare** (0.7% and 2.8%) and are refused for good: a pattern has no memory.
5. The translation found one ENGINE bug on the way: `find`/`findAll` retried inside a surrogate
   pair. Fixed, with a test.

## Corpus 1: tjs-lang's source (`../tjs-lang/src`, tests included)

# fromRegex over ../tjs-lang/src

439 files, 916 distinct regex literals

| Outcome | Regexes | Share |
| --- | ---: | ---: |
| translated, agrees on every generated input | 615 | 67.1% |
| translated, DISAGREES (a translator bug) | 0 | 0.0% |
| refused | 301 | 32.9% |

## Refusals, ranked

| Reason | Regexes | Share of all | Examples |
| --- | ---: | ---: | --- |
| `word-boundary` | 107 | 11.7% | `/\bRuntimeContext\b/` `/\bunsafe[ \t]+(?!(?:instanceof\|in\|of)\b)/g` `/\bfunction\b[\s\S]*\)\s*$/` |
| `repetition-backtracks` | 86 | 9.4% | `/Invalid run option quotaUsed.*(extensibl/` `/^[^\s@]+@[^\s@]+\.[^\s@]+$/` `/^\/# Title[^]*#\/$/` |
| `multiline-start` | 71 | 7.8% | `/^ˋˋˋjs\n([\s\S]*?)^ˋˋˋ$/gm` `/^import .*$/gm` `/^ˋˋˋjs\n([\s\S]*?)^ˋˋˋ$/m` |
| `lookbehind` | 13 | 1.4% | `/(?<![.])\b([a-zA-Z_][a-zA-Z0-9_]*)\b/g` `/(?<![\w$])name = /` `/(?<=^[ \t]*)\/\*#([\s\S]*?)\*\//gm` |
| `alternation-backtracks` | 12 | 1.3% | `/(?:^\|[;\n}])import\s*(?:[^"';]*?from)?\s/g` `/ˋˋˋ(typescript\|tjs\|js\|javascript)(?::[a-/g` `/(?:a === \|args\.includes\(\|args\[i - 1\]/g` |
| `backreference` | 6 | 0.7% | `/((?:import\|export)\s+(?:[\w\s{},*]+\s+fr/g` `/\(([^\|)]+)\\|\1\)[+*]/` `/^(['"ˋ]).*\1$/` |
| `lazy` | 4 | 0.4% | `/test\.__tjs\s*=\s*(\{[\s\S]*?\});?\s*$/` `/\/\*\s*@tjs\s+predicate(\([^)]*\)\s*\{[\/g` `/\/\*\s*@tjs\s+declaration\s*(\{[\s\S]*?\/g` |
| `unsupported-flag` | 1 | 0.1% | `/(true\|false\|null\|undefined)\b/y` |
| `capture-in-repetition` | 1 | 0.1% | `/^(a+)+$/` |

## Corpus 2: a large `node_modules` (`../tjs-lang/node_modules`)

# fromRegex over ../tjs-lang/node_modules

4483 files, 5372 distinct regex literals

| Outcome | Regexes | Share |
| --- | ---: | ---: |
| translated, agrees on every generated input | 2860 | 53.2% |
| translated, DISAGREES (a translator bug) | 0 | 0.0% |
| refused | 2512 | 46.8% |

## Refusals, ranked

| Reason | Regexes | Share of all | Examples |
| --- | ---: | ---: | --- |
| `word-boundary` | 1168 | 21.7% | `/:host\b/g` `/(\bselector\s*\(\s*(?![\s)]))(?:[^()\s]\|/` `/!important\b/i` |
| `alternation-backtracks` | 456 | 8.5% | `/^(animation-iteration-count\|column-count/` `/(?:^\|\s)lang(?:uage)?-([\w-]+)(?=\s\|$)/i` `/(?:"(?:\\(?:\r\n\|[\s\S])\|[^"\\\r\n])*"\|'/` |
| `repetition-backtracks` | 375 | 7.0% | `/^[a-zA-Z0-9\-_]+?\.[a-zA-Z0-9\-_]+?\.([a/` `/^([-\w]*?)((_)?(\d+)(\w?))?$/` `/^([^\]]+)(\[.+)/` |
| `multiline-start` | 244 | 4.5% | `/((?:^\|[,{])[ \t]*)(["'])(?:\\(?:\r\n\|[\s/m` `/((?:^\|[,{])[ \t]*)(?!\s)[_$a-zA-Z\xA0-\u/m` `/^.+/m` |
| `backreference` | 148 | 2.8% | `/(^=\s*(["']\|(?!["'])))\S[\s\S]*(?=\2$)/` `/(["'])(?:\\(?:\r\n\|[\s\S])\|(?!\1)[^\\\r\/` `/(~~?)(?:(?!~)<inner>)+\2/` |
| `lazy` | 34 | 0.6% | `/<!--(?:(?!<!--)[\s\S])*?-->/` `/(<__[^>]*>)(?:<!\[CDATA\[(?:[^\]]\|\](?!\/` `/@[\w-](?:\((?:[^(){}]\|\([^(){}]*\))*\)\|[/` |
| `caseless-non-ascii` | 31 | 0.6% | `/<!\[CDATA\[[\s\S]*?\]\]>/i` `/(^<!\[CDATA\[)[\s\S]+?(?=\]\]>$)/i` `/(^\|[^-\w\xA0-\uFFFF])(?!\s)[-_a-z\xA0-\u/i` |
| `capture-in-repetition` | 17 | 0.3% | `/\w+(-\w+)+/` `/^\.?([^.[\](),])+(\.[^.[\](),]+\|\[\d+\]\|/` `/^([^\x00-\x20\x22\x28\x29\x2c\x2e\x3a-\x/` |
| `unicode-property` | 13 | 0.2% | `/^[\p{Ll}\p{Lo}][\p{Ll}\p{Lo}\p{N}_-]{0,6/u` `/^[\p{Ll}\p{Lo}\p{N}_-]{0,63}$/u` `/^[\p{ID_Start}_$][\p{ID_Continue}$\u200c/u` |
| `capture-in-lookahead` | 12 | 0.2% | `/^(?!\#([a-z0-9]+))[\#\{\}]/gi` `/^(?:[^\x00]*?(?=(\{\{)))/` `/^(?:[^\x00]+?(?=(\{\{\{\{)))/` |
| `unsupported-flag` | 8 | 0.1% | `/(?:[^\S\n\r\u2028\u2029]\|\/\/.*\|\/\*.*?\/y` `/in(?:stanceof)?/y` `/(?:[^\\]\|(?<previousEscape>\\.))*?(?<dec/suy` |
| `lookbehind` | 3 | 0.1% | `/\r(?!\n)\|(?<!\r)\n/g` `/\s*\/\/.*$(?<!,)/u` `/(?<=^\\+).$/su` |
| `empty-repetition` | 3 | 0.1% | `/\. *\.\|[*\/!](?: *=)?\|%(?: *=\|(?: *#)?(?/` `/^(?:[ \t]*(?:\n\|$))+/` `/(^\|\\\/)?\\\*$/` |
