<!--{"order": 40}-->

# A formal specification in Lean 4

**Status (2026-11-03): PROPOSED.** The owner's direction: the Lean 4 approach proposed for
tjs-lang's AsyncJS VM (`../tjs-lang/docs/ajs-lean-spec.md`) applies to Pattern too. Pattern should
go FIRST: it is small, pure, and every claim it makes is precise, so it is the cheaper place to
learn the method, and its proofs become a component of the VM's (Pattern is meant to be the VM's
matching builtin).

## The shape

The same as tjs-lang's proposal. **Lean holds the specification and the proofs; the TypeScript
engine ships; the two are kept in agreement by differential testing.** Patterns are already JSON
(`toJSON` / `fromJSON`), so a Lean reference interpreter and the shipping engine can run the very
same patterns on the very same inputs with nothing in between.

## The claims, as theorems

Each of these is something this library already SAYS. Today a test samples it; the proposal is to
prove it about the model.

| Claim (where it is said) | Theorem | Difficulty |
| --- | --- | --- |
| Matching always terminates (DECISIONS.md) | the interpreter is total: the node set has no recursion, and every repetition makes progress or stops | Low |
| One pattern, one answer | determinism: a match result is a function of pattern, input and position | Low |
| No backtracking; cost is visible from the shape | a step bound: steps ≤ c · \|pattern\| · \|input\| per match, and linear with memoisation (packrat) | Medium; Blaudeau and Shankar's packrat proof (PVS) is the template |
| Possessive repetition and ordered choice (DECISIONS.md) | the semantics as stated, for every node kind, including that a zero-width item cannot loop | Low (it is the definition) |
| A capture is never silently lost | if `checkCaptures` accepts a pattern, every capture that matches appears in the result | Medium |
| Patterns are data | `fromJSON (toJSON p) = p`, and `fromJSON` accepts exactly the well-formed trees | Low |
| **The translator is sound** (`fromRegex`, #3748) | whenever it translates a regex, the regex and the pattern accept the same strings and give the same match positions and captures | High: needs regex SEMANTICS |
| **The emitted regex is sound and safe** (#3760) | the emitted possessive `RegExp` behaves as the pattern, and its backtracking is bounded | High: needs regex semantics and an engine-cost model |

`describe()` is not on the list: English is not a theorem. Its claim (the description says what
the pattern matches) is for the grokkability probes (#3758).

## The two hard ones need JavaScript regex semantics, and they exist

**Warblre** (De Santo, Barrière and Pit-Claudel, ICFP 2024) is a faithful, EXECUTABLE
mechanization of ECMAScript 2023 regexes, section 22.2 of the spec, with backtracking,
lookaround, backreferences and flags. The same group's work on linear matching of JavaScript
regexes (PLDI 2024) is directly about when backtracking can be avoided, which is the translator's
central question.

Warblre is written in Rocq (formerly Coq), not Lean, which gives three options:

1. **Use it as an oracle, not a dependency.** Warblre is executable, so it can stand in for "what
   the regex means" in the DIFFERENTIAL tests of the translator and the emitter, independent of
   any engine's bugs. The proofs stay in Lean, about the regular core only. Cheapest; recommended
   as the first step whatever else is chosen.
2. **Port the fragment we need to Lean.** The translator only accepts a fragment (no
   backreferences, no lookbehind; see `from-regex.md`), so its semantics is much smaller than
   Warblre's. Prove the translator sound against that fragment, and test the fragment against
   Warblre.
3. **Do the regex proofs in Rocq.** Reuse Warblre directly, at the cost of two proof assistants
   in the ecosystem. Worth it only if option 2 turns out large.

The choice is the owner's; option 1 needs no decision to start.

## What stays trusted

The Lean kernel; the definitions (that the theorems say what we care about, which people review);
the agreement between the Lean model and the TypeScript engine, established by testing, not
proof; for the regex theorems, the fidelity of the regex semantics (Warblre's claim, checked
against the spec's test suite); and the host engines' actual behaviour, which is why the emitter
still gets an adversarial ReDoS probe on JavaScriptCore and V8 however good the proof is.

## The spike

Stoppable, and the same shape as tjs-lang's.

1. Model the node set and the interpreter in Lean, reading the same JSON.
2. Prove totality, determinism and the step bound for the interpreter as it is (no memoisation).
3. Run the test suite's patterns, and generated ones, on the Lean interpreter and the TypeScript
   engine, and compare results, captures and step counts.
4. Stand up Warblre as an oracle for the regex differential corpus in `pattern.test.ts`.

**Stop if** the step bound cannot be stated for the shapes we ship (that is information about the
engine, not only the proof). **Continue if** the theorems go through and the differential run
finds a real disagreement: that is the evidence the method finds what tests do not.

After that, the order is: the capture and JSON theorems; then the translator's soundness, which
gates trusting `fromRegex` anywhere it decides what runs (the AsyncJS VM); then the emitter.
