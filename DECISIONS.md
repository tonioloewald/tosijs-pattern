# Decisions

What is settled, and why. Re-open one only with new evidence, and say what the evidence is.

## A standalone library with zero dependencies (owner, 2026-10-03)

Its own repo and npm package, used first and hardest by us: in code edits (a skill shared across
repos), in tjs-lang's compiler, then as AsyncJS's matching builtin. tjs-lang board #2813.

## A declarative builder, not an imperative scanner (2026-10-03)

The first design (tjs-lang `docs/scanner.md`) was a cursor with `skip`/`take`/`takeUntil`. A
declarative tree is better here: it is data (serializable, inspectable, safe to accept), its
cost is a property of the engine rather than of user code, and it reads as a description.

## PEG semantics: possessive repetition, ordered choice

A regex finds some matches only by retrying (backtracking), and its worst case is exponential.
Here repetition takes what it can and never gives it back, and `oneOf` takes the first option
that matches. Consequences, stated rather than hidden:

- `sequence(oneOrMore(digit), '5')` does not match `"1235"`.
- `oneOf('a', 'ab')` followed by more input does not retry `'ab'`. Put longer options first.

The owner's framing (2026-10-03): regex's worst features are workarounds for not being a parser.
Backtracking stands in for state or structure; a pattern that needs it has not said what it
means. So the structure gets names (`until`, `quoted`, `balanced`, `separatedBy`).

## Reading aloud is the test of every name (owner, 2026-10-03 and 2026-11-02)

Nouns are characters (`digit`, `letter`, `charIn('a-z')`); verbs take nouns or patterns
(`oneOrMore`, `optional`, `oneOf`). No `plus`/`star`/`question`, no flags, no modifiers that
apply to "the next token". Drawing a railroad diagram from a pattern, or a pattern from a
diagram, is mechanical: one piece per box.

## Strings are literal text

A string anywhere in a pattern is that text. There is nothing to escape, so the escaping
mistakes of regex-in-a-string-in-a-heredoc cannot happen.

## Values

A capture records its piece's value: the matched text, unless the piece defines a better one.
`number`/`integer` give numbers; `quoted` and `balanced` give the inside; `separatedBy` gives a
list. A repetition gives its text, unless its items captured: then a list of their captures,
one per item. `optional` (at most one) is not a list: its captures are simply there or absent.

## Templates insert a capture's matched text (owner, 2026-11-03)

`replaceAll('$3.50', '{amount} USD')` gives `3.50 USD`, not `3.5 USD`: a template is about text,
and converting a number back to text loses how it was written. Each capture keeps both its
value (`captures`) and its text (`texts`); a replacement function sees both.

## A capture that would be lost is an error

A capture inside a repetition that nothing captures would have nowhere to go (each item has its
own). Rather than keep the last one, as regex does, or drop them silently, using such a pattern
throws, naming the capture and showing what to write. Likewise a capture inside
`followedBy`/`notFollowedBy`, which match nothing, or inside `until`'s stopping point, which
`until` does not consume.

Likewise a name recorded twice in one scope (`sequence(capture('a', …), capture('a', …))`, or a
capture around one of its own name), where the second would overwrite the first. `oneOf`
options may share a name, since only one is recorded: that is how to say "either way, call it
`a`". Each item of a captured repetition is its own scope.

## No RegExp in the library

Character sets are sorted code-point ranges with binary-search membership. `whitespace` is
JavaScript's `\s` written out as data and checked against `\s` over the whole BMP in a test.

## `letter` is ASCII for now

Unicode letters need the Unicode tables. Those must come in as generated data with a freshness
test, not as a `\p{L}` RegExp call. Until then `letter` says what it does.

## Patterns are values

Every builder returns a new frozen pattern; nodes are frozen all the way down.

## A step budget on every call (default 10 million)

Every node visit and every character a loop consumes is one step. Exceeding the budget throws
`PatternBudgetError`. The caller chooses the worst case; in tjs-lang's VM the steps will be fuel.

## Reviews live in `reviews/`, not `docs/`

`docs/` is the doc site's build output, regenerated and served publicly.
