<!--{"order": 20}-->

# From regex

**Status: designed, not built.** This page is the plan for `fromRegex()`, the translator, and
the rule that makes it useful: **a regex that does not translate is refused, with the reason.**

People, and language models especially, write regex fluently. So the plan is to keep accepting
regex as INPUT while only ever running Pattern. A host (the tjs-lang AsyncJS VM is the first)
takes a regex literal, translates it at compile time, and runs the result. A regex that cannot be
translated faithfully never runs; the author gets a message that names the problem and the
Pattern piece to use instead.

## Why translation is not just syntax

Regex backtracks; Pattern does not. Syntax maps one-to-one, but the meaning only matches when the
backtracking could never have changed the outcome:

- `\d+5` on `"1235"`: the regex gives back the 5 and matches; `sequence(oneOrMore(digit), '5')`
  does not.
- `a|ab` followed by `c`, on `"abc"`: the regex tries `ab` after `a` fails later; `oneOf('a',
  'ab')` does not.

So the translator proves, per site, that possessive and ordered semantics give the same answer,
and refuses when it cannot. The proof is a local check:

1. **A repetition** is safe when nothing that can follow it can start with a character it could
   have consumed (the "first set" of what follows does not overlap the repeated item's). `\d+-`
   is safe (a digit is never a `-`); `\d+5` is not.
2. **An alternation** is safe when no option can match where an earlier one already matched a
   prefix of it (in practice, when their first characters differ, or the longer comes first,
   which the translator can reorder only when that is provably equivalent).
3. Where the check fails, the translator looks for the STRUCTURE the backtracking was standing
   in for, and names it:
   - `.*?X` and `.*X` before a literal become `until(X)`.
   - `"(?:[^"\\]|\\.)*"` becomes `quoted('"', { escape: '\\' })`.
   - `[^,]*(?:,[^,]*)*` becomes `separatedBy(…, ',')`.
4. Anything else is refused: "`\d+5`: the repetition can consume what follows it, so this regex
   only matches by retrying. Say where the digits stop: …".

## The rest of the mapping

| Regex | Pattern | Notes |
| --- | --- | --- |
| `(?=x)`, `(?!x)` | `followedBy`, `notFollowedBy` | direct |
| `(?<=x)`, `(?<!x)` | refused | 0.5% of regexes in our census; a lookbehind usually stands in for a capture |
| `\1`, `\k<n>` | refused | backreferences are memory, not matching; 3% |
| lazy `*?`, `+?` | `until(…)` when followed by a literal, else refused | 7% |
| `i` flag | `caseless` / both-case ranges | |
| `m` flag | `lineStart` / `lineEnd` | |
| `s` flag | `anyChar`; without it, `.` is `charNotIn` the line terminators | |
| `g` flag | the operation (`findAll`, `replaceAll`) | |
| `y` flag | `find` at a position | |
| `u` flag | always on: code points | |

## How much will translate? Measure, do not guess

A census of the 7,926 distinct regex literals in a large `node_modules` (2026-11-02; mostly
developer tooling, so lexer-heavy) found: quantifiers in 76%, character classes 60%,
alternation 45%, capture groups 40%, lookahead 15%, lazy quantifiers 7%, backreferences 3%,
lookbehind 0.5%. Only about 13% were simple enough for plain string methods.

That population is not the one that matters most. **The first job of the translator is to report,
over a corpus, what share translates and why the rest is refused,** run over:

1. that census (the script is `scripts/regex-census.ts` once it is moved here);
2. regexes language models write for typical agent tasks (extract fields from model output,
   validate a date or an email, split records, clean whitespace), collected with tjs-lang's
   grokkability harness;
3. the regexes in tjs-lang's own compiler (about 350 sites), which are also the first migration
   target.

Every translated regex is checked by a DIFFERENTIAL test: the regex and its translation run on
generated inputs, and must agree on every one. That test is the only place the host `RegExp` is
allowed.

## Pattern as a way to understand regexes

The translator gives something useful even where no one runs the result: **any regex, read
aloud.** Paste `^(?:[a-z0-9._]+)@[a-z0-9-]+(?:\.[a-zA-Z]+)+$` and get "the start of the input,
then one or more characters in .0-9_a-z, then "@", …", or, where it is refused, the precise
reason (where it would backtrack, and what it was standing in for). That is an explainer for the
regexes people inherit, review, and copy from answers they do not understand: the same audience
the "Regexes are Hard" survey found (70% of developers say regexes are less readable than other
code). It wants a page on the doc site where you paste a regex and see the pattern, its
description, and its railroad diagram.
