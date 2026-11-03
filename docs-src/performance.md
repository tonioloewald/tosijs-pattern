<!--{"parent": "Design", "order": 30, "description": "How fast tosijs-pattern is against native regex and a linear regex engine, why, and the plan to close the gap."}-->

# Performance

**Measured 2026-11-03** (`bun scripts/bench.ts`, Bun 1.4.2, Apple Silicon; best of 9 interleaved
runs after warm-up). Re-measure before quoting; numbers without a date are not numbers.

| Task | Pattern | Native `RegExp` | tjs-lang's linear engine |
| --- | --- | --- | --- |
| Validate 20k phone numbers | 6.9 ms | 0.08 ms (85× faster) | 5.0 ms (Pattern 1.4× slower) |
| Validate 20k emails | 25 ms | 0.33 ms (77×) | 25 ms (level) |
| Find all numbers in 110 KB | 5.6 ms | 0.11 ms (49×) | 12.3 ms (Pattern 2.2× faster) |
| Find all words in 110 KB | 6.3 ms | 0.15 ms (43×) | 8.2 ms (Pattern 1.3× faster) |
| Match 500 distinct 200-field CSV lines | 57 ms | 0.50 ms (115×) | 156 ms (Pattern 2.7× faster) |
| Replace `$amounts` in 110 KB | 8.4 ms | 0.04 ms (207×) | |

## What the numbers mean

- **Against native regex, 40 to 200 times slower.** Native regex is compiled to machine code;
  Pattern is an interpreter written in JavaScript. Nothing here is a surprise yet.
- **Against what a sandbox can actually use, level or faster.** A VM that must not hand guest
  patterns to the host's backtracking engine (tjs-lang's AsyncJS) runs its own linear engine in
  JavaScript. Pattern matches it on simple validation and beats it by 2 to 3 times on scanning
  and CSV. Replacing regex with Pattern there costs nothing.
- **Where it is not linear yet: searching.** `find` and `findAll` try each start position, so a
  pattern that scans ahead from any start does work proportional to the square of the text when
  it fails: measured, `pattern.until(';').findAll('a'.repeat(4000))` and
  `pattern.letters().text('=').findAll('a'.repeat(5000))` both exceed the default 10-million-step
  budget. It ends in a `PatternBudgetError`, never a hang, and a definite first step (a literal,
  or `startAt`/`startAfter`, which caches its scan) keeps a search linear. Memoising per position
  (#3750) is the fix.

## Low-hanging fruit (not done yet)

Read from the engine, in rough order of payoff. Together, 5 to 10 times is a reasonable
expectation, which would put Pattern at roughly 5 to 20 times native.

1. **Values are computed eagerly.** Every sequence, repetition and character match slices the
   text it matched, on every call, whether or not anything captures it. Compute values only on
   the path to a capture (or compute them lazily from start and end).
2. **A result object per node visit.** `match` returns `{ end, caps, value }` for every node.
   Return the end position as a number, and keep captures on a stack in the context that a
   failed branch unwinds.
3. **`find` tries every start position.** Compute each pattern's FIRST SET (the characters a
   match can start with, or "anything" when it can be empty) once, and skip positions that
   cannot start a match. Scanning is the most common operation; this is its main cost.
4. **The tree is interpreted on every call.** Compile each pattern once into nested closures
   (each node a function of the position), so the per-node `switch` disappears. No code
   generation from strings, so it stays CSP-safe.
5. **Literal runs and character runs.** `charsIn(…)` can scan with a tight loop over
   a precomputed lookup table for ASCII, and literal sequences can be merged into one
   `startsWith`.

Measure each with the benchmark AND with the step counts in the tests: a change that makes the
benchmark faster must not make any test's step count grow faster than the input.

## Further: Pattern writes regexes (an implementation side)

Most patterns are regular: no `balanced`, no `quoted` with doubled quotes, no `separatedBy`
values. For those, the fastest engine available is the host's own, and a pattern can be compiled
INTO a native `RegExp`, used as a fast path in trusted host code (never inside a sandbox, which
must not touch the host engine). It is also how people could take a readable pattern and get a
regex for a tool that only accepts regex.

The subtlety is that a native regex BACKTRACKS and a pattern does not, so a naive translation
(`digits()` → `\d+`) would both change the meaning and reintroduce ReDoS. The emitted
regex must be possessive and ordered too. JavaScript regex has no possessive quantifiers or
atomic groups, but a lookahead is atomic, and a backreference re-reads what it captured, so
`(?=(X))\1` matches X atomically:

| Pattern | Emitted regex |
| --- | --- |
| `digits()` | `(?=(\d+))\1` (takes all the digits, never gives one back) |
| `oneOf('a', 'ab')` | `(?=(a\|ab))\1` (the first that matches, never retried) |

Every repetition and every choice is wrapped this way, so the emitted regex cannot backtrack into
any of them: its work is bounded the way the interpreter's is. Pieces that are not regular fall
back to the interpreter, per node, so a pattern can be partly native.

Required before this is trusted: a differential test (interpreter against emitted regex on
generated inputs, every node kind), and an adversarial ReDoS probe of the emitted regexes on
each host engine (JavaScriptCore, V8), because "cannot backtrack" is a claim about the engines,
and engines have surprised people before.
