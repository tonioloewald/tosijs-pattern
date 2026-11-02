# Changelog

## [Unreleased]

### Added

- The core: a fluent, declarative pattern vocabulary (nouns, verbs, and the structure regex
  cannot express: `until`, `quoted`, `balanced`, `separatedBy`), a PEG engine with no
  backtracking and a step budget, `describe()` (a pattern read aloud), validated
  `toJSON`/`fromJSON`, and the operations `matches`, `parse`, `find`, `findAll`, `occursIn`,
  `replaceFirst`, `replaceAll`, `split`.
- Every capture keeps its matched text as well as its value (`texts` on a match and a parse
  result). Replacement templates insert the text: `$3.50` → `'{amount} USD'` gives `3.50 USD`.
- A doc site (tosijs-ui) whose examples run live in the page.
