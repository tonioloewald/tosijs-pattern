# CLAUDE.md

Guidance for agents (and people) working in this repo. Read `AGENTS.md` for the shared
ecosystem practices; this file wins where they differ.

## What this is, and the one goal

**tosijs-pattern** is matching that reads like what it means: a fluent, declarative alternative
to regular expressions.

The goal, in the owner's words (2026-11-02): **a query should read intuitively, the way a really
good regex coder can read a regex, but almost no one actually can.** Everything else serves that.
When a choice trades readability for something else, readability wins unless the other thing is
correctness or safety.

It started as a design in tjs-lang (`../tjs-lang/docs/pattern.md`, 2026-10-02 to 10-04), where
it is meant to replace regex in AsyncJS (the sandboxed agent language), in tjs-lang's own
compiler, and in agents' code edits. The decision to make it a standalone, zero-dependency
library with a code-editing skill is the owner's (2026-10-03, tjs-lang board #2813). Where that
doc and this repo differ, this repo is current.

The goals, as the owner stated them (2026-11-03), and the cards that serve each:

1. **A powerful, intuitive and safe tool for parsing text**: the classic cases where, using a
   regex, you now have two problems. Safety: no backtracking, the step budget, validated JSON;
   linearity is #3750. Power: `quoted`, `balanced`, `listOf`, values; the CSV showcase is
   #3761. NOT covered yet: recursive grammars (a rule that refers to itself, for JSON,
   expressions, nested structure beyond `balanced`). Open question for the owner.
2. **Grokkable**: an agent reading code that uses Pattern, WITHOUT documentation, infers what it
   does. Measured, cold (no docs in the prompt), by the READ probes: #3758, #3749.
3. **Author (safe) regexes**: emit possessive native regexes for the regular subset, #3760.
4. **Ingest regexes**: a translator (#3748) turns them into safer patterns AND explains them
   (`describe()`, a railroad diagram, or the precise reason one is refused), #3759.

## Read before changing anything

1. `README.md`: the user-facing tour (and the doc site's home page).
2. `DECISIONS.md`: what is settled and why. Do not re-open a settled question without new
   evidence; if you have some, say so and propose, do not just change it.
3. `docs-src/vocabulary.md`, `docs-src/from-regex.md`: the reference and the translator plan.

## Principles that are load-bearing

1. **The read-aloud test.** A pattern read aloud says what it matches. `describe()` makes that
   executable: if a description reads badly, the vocabulary is wrong. Any new name, or any
   change to one, comes with the `describe()` output it produces and a sentence on why it reads
   better. Naming questions are settled by MEASURING (see "Open decisions"), not by taste.
2. **No RegExp in `src/`.** Character sets are code-point ranges; matching is loops. The host
   `RegExp` appears only in tests, as the ORACLE that patterns are compared against. (Why: this
   library exists to run where a regex engine is a liability: untrusted patterns, metered VMs,
   no ReDoS.)
3. **Patterns are data.** A pattern is a tree of plain JSON nodes (`src/nodes.ts`), a CLOSED
   set. Adding a kind means adding it in five places: `nodes.ts`, the engine, `describe.ts`,
   `json.ts`'s validator, and `code.ts` (`toCode`), plus a chain method in `pattern.ts`. `fromJSON` must refuse anything else, with the path to it.
4. **No backtracking; cost is visible and bounded.** Repetition is possessive, `oneOf` is
   ordered, and every call has a step budget. Performance claims are tested by COUNTING WORK
   (steps), never by timing, which is flaky under load and cannot tell linear from quadratic.
5. **Never silently lose what the author asked for.** A capture that would be lost is an error
   that says what to write instead. A builder given a bad argument throws at the call that made
   it, naming the argument. The translator refuses a regex it cannot translate faithfully,
   saying why and what to use. A silent wrong answer is the worst outcome in this library.
6. **Zero runtime dependencies.** `devDependencies` only (the doc site's tooling).

## Commands

```sh
bun test                                   # the suite (164 tests)
bunx tsc --noEmit                          # typecheck
bun scripts/run-examples.ts README.md docs-src/*.md   # run every live example (stub preview)
bun bin/site.ts --build                    # build the doc site (docs/) and the library (dist/)
bun bin/site.ts                            # build, then the dev server (needs `bunx tosijs-dev-certs` once: mkcert)
bun scripts/regex-census.ts [dir]          # what regexes in a JS tree use (read-only)
bun scripts/bench.ts                       # Pattern vs native RegExp vs tjs-lang's linear engine
bun scripts/from-regex-report.ts <dir>     # what share of a tree's regexes fromRegex translates, refusals ranked
```

To check the live examples in a real browser without the dev server: serve `docs/` statically
(`python3 -m http.server 8792 -d docs`), then from tjs-lang:
`bun scripts/check-site-examples.ts --base http://localhost:8792 --dir ../tosijs-pattern/docs`
(and `--only .` for the home page). Stop the server by PID afterwards and check it is gone.

## Layout

| Path | What |
| --- | --- |
| `src/nodes.ts` | The node types: the closed set a pattern is made of |
| `src/chars.ts` | Range strings, code-point sets, `whitespace` as data, `isIdentifier` |
| `src/engine.ts` | The PEG interpreter, the step budget, best-failure tracking |
| `src/pattern.ts` | The vocabulary (nouns and verbs) and the `Pattern` object's operations |
| `src/describe.ts` | `describe()`: a pattern read aloud |
| `src/code.ts` | `toCode()`: a pattern written as the chain that builds it |
| `src/json.ts` | `fromJSON`: validated reading of untrusted JSON |
| `src/regex/` | `fromRegex`: `parse.ts` reads regex syntax (loops, no RegExp), `translate.ts` proves equivalence or refuses |
| `src/pattern.test.ts` | Tests, including the regex differential corpus |
| `docs-src/` | Guide pages for the doc site. `docs/` is the BUILD OUTPUT (GitHub Pages) |
| `demo/site.ts` | The site's bundle: registers the doc system, exposes the library to examples |
| `bin/site.ts`, `tosijs-pattern-site.config.ts` | The site and library build (tosijs-ui/site) |
| `scripts/` | `bench.ts`, `regex-census.ts`, `run-examples.ts`, `regex-diff.ts` (the differential oracle), `from-regex-report.ts` |
| `reports/` | Measurements, dated: `from-regex-2026-11-03.md` |

**Reviews go in `reviews/` at the repo root, never `docs/reviews/`:** `docs/` is the generated
site, wiped on each build and served publicly.

## State (2026-11-03)

Built and verified:

- **The API is a fluent chain from one import** (owner; DECISIONS.md):
  `pattern.start().digits(3).text('-').digits(4).end()`. Never write free-function vocabulary
  (`sequence(…)`, `oneOrMore(digit)`) in code, docs or messages; it was removed. Nouns
  (`digit()`/`digits(n?, max?)`, `charIn`/`charsIn`, …), verbs (`oneOf`, `optional`,
  `oneOrMore`, `zeroOrMore`, `repeat`, `group`, `ifFollowedBy`, …), naming (`.as(name)` on the
  step before, `.describedAs` on the whole), structure (`until`, `quoted`, `balanced`, `listOf`,
  `number()`, `integer()`). No `then` (it would make patterns thenables).
- Operations: `matches`, `parse` (with line/column errors), `find`, `findAll`, `occursIn`,
  `replaceFirst`, `replaceAll`, `split`, `describe`, `toCode`, `toJSON` / `fromJSON`.
- `fromRegex()`: translates where it can prove equivalence, refuses the rest with a coded reason.
  67% of tjs-lang's regexes translate (53% of a large `node_modules`), every one agreeing with its
  regex on generated inputs; the check was mutation-checked (`reports/from-regex-2026-11-03.md`).
- 164 tests. A guard test fails if a node kind is missing from the engine, `describe`,
  `fromJSON` or `toCode`; every `toCode()` output is run and must rebuild the same pattern (and,
  for `fromRegex` output, agree with the regex). The semantics tests were mutation-checked: making repetition give back, or `oneOf`
  take the longest, turns 10 red. A differential corpus compares patterns with the regex a
  fluent engineer would write.
- The doc site builds clean; all 7 live examples ran in headless Chrome.

Not done: everything under "Work, in order".

## Work, in order

Each is (or should be) a card on the Virta board, project `tosijs-pattern`.

1. **The translator, `fromRegex()`: built (#3748).** Report: `reports/from-regex-2026-11-03.md`.
   Next, by measured value: (a) **look-behind** (`\b`, multiline `^`, lookbehind) is 21-26% of
   all regexes and the largest refusal; a `precededBy` node would recover most of it, and is the
   OWNER's decision (a new node kind); (b) recognise structure where backtracking stood in for it
   (`"(?:[^"\\]|\\.)*"` → `quoted`, `[^,]*(?:,[^,]*)*` → `listOf`), which also makes the
   output read better; (c) provably-safe reordering of overlapping alternations; (d) the third
   corpus, regexes models write (#3749).
2. **Hone the API by measuring it: obviousness, legibility, writability, readability, economy**
   (the owner's five, 2026-11-03). Grokkability probes, as tjs-lang runs them
   (`../tjs-lang/experiments/agent-legibility/`): show a model a pattern and ask what it
   matches (READ, against the same task as a regex, which is the control); give it a spec and
   ask for a pattern (WRITE: does it compile, does it behave, how long is it); and for every
   contested name, A/B the spelling. Small and large models, N samples, the WRONG column decides.
   Economy is measured too: tokens per pattern against the equivalent regex. Every vocabulary
   change cites a probe.
3. **A formal specification in Lean 4** (`docs-src/formal.md`; owner, 2026-11-03). Lean holds the
   semantics and the proofs (totality, determinism, the step bound, captures never lost, JSON
   round-trip; later the translator's and the emitter's soundness), the TypeScript engine is
   tested against it differentially over the same JSON patterns. Pattern goes before tjs-lang's
   AsyncJS VM spike: smaller, pure, and a component of it. For regex semantics, Warblre (an
   executable Rocq mechanization of ECMAScript regexes) serves as the ORACLE first.
4. **What agents need.** Use tjs-lang's grokkability harness (`../tjs-lang`,
   `experiments/agent-legibility/` and `bun run test:grok`) to collect the regexes small and
   large models write for typical agent string tasks, and to measure whether they can READ and
   WRITE Pattern (the read-aloud claim, tested). Those probes are the method for every naming
   question.
5. **Linearity and speed.** `find`/`findAll` try every start position, and `until` scans ahead
   from each, so some shapes are quadratic: add packrat memoisation (or a smarter scan) and
   work-counting tests that fail on super-linear growth. Then the low-hanging fruit in
   `docs-src/performance.md` (lazy values, no per-node allocation, a first-set prefilter for
   `find`, closures instead of the `switch`). Today Pattern is 40 to 200 times slower than native
   regex, and level with or faster than tjs-lang's own linear engine (`bun scripts/bench.ts`).
   Later, Pattern can EMIT possessive native regexes as a fast path in trusted host code (same
   page). That needs a differential test and a ReDoS probe per engine first.
6. **Code mode, the CLI and the editing skill.** Whitespace and comments skipped between tokens;
   `balanced`/`quoted` that understand a host language's strings, template literals and
   comments; a CLI (`tosijs-pattern replace <file> …`) with edit safety (require a unique match
   or a stated count; dry run showing each match in context); a SKILL.md agents use to edit code
   in every repo. Measure: edits that apply on the first try.
7. **Dogfood in tjs-lang**, first target: the six hand-rolled quote scanners in
   `../tjs-lang/src/lang/parser-params.ts` (tjs-lang board #2877), each replacement held
   byte-identical over tjs-lang's dogfood and compat corpora. Then tjs-lang's ~350 compiler
   regex sites, a pass at a time. File in tjs-lang (`virta create … --project tjs-lang`); do not
   edit tjs-lang from here.
8. **Unicode.** `letter` is ASCII. Unicode letters need the Unicode tables as DATA (generated,
   with a freshness test), never `\p{L}`.
9. **The AsyncJS builtin** (in tjs-lang, later): the engine runs with its steps charged as the
   VM's fuel; regex literals in AJS translate at compile time; untranslatable ones are compile
   errors. Gated in tjs-lang on the grokkability results.
10. **Publish**: the shared OIDC workflow (`../tosijs-coding-practices/templates/publish.yml`),
   release-doctor, attestation; GitHub Pages for the site. In place (2026-11-03):
   `.github/workflows/publish.yml` (the template, unchanged), `ci.yml`, and `pages.yml`, which
   builds the site from a tag or a chosen ref and deploys it as a Pages ARTIFACT (Pages is set
   to "GitHub Actions", so a `gh-pages` branch would not be served; `docs/` stays gitignored).
   `bun run build:lib` builds only what npm ships.

## Decided by the owner (2026-11-03)

- **GitHub: public.** The owner creates the repo and the DNS.
- **The site's domain is `pattern.tosijs.net`** (as in the site config).
- **Replacement templates insert the matched TEXT of a capture**, not its typed value:
  `replaceAll('$3.50', '{amount} USD')` gives `3.50 USD`, not `3.5 USD`. The
  function form sees both (`m.captures` are values, `m.texts` the text). Done (#3756).

## Open decisions (the owner's)

- **Names**, to be measured, not argued: `listOf`, `describedAs`, `occursIn`, `anyCase`,
  `ifFollowedBy`, `matches` vs `parse`, `until`, `oneOf` (ordered; should it be `firstOf`?), and
  the count spelling (`digits(2, Infinity)` for at least 2). Plural nouns are settled (the chain).
- **Should `oneOf` warn** when an earlier option is a prefix of a later one (`oneOf('a', 'ab')`)?
  That is the most likely PEG surprise.

## Known rough edges

- `anyCase` compares with `toLowerCase`, which changes length for a few characters (`İ`).
- `quoted` removes an escape only before the quote or the escape itself (`\n` stays `\n`):
  decoding escape sequences is a separate piece (`jsonString`?), not a flag.
- `balanced`'s quote characters are single characters, and it does not understand comments or
  template literals yet (that is the code mode).
- The site's dev server needs local TLS (`bunx tosijs-dev-certs`, mkcert) the first time.
