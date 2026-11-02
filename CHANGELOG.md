# Changelog

## [Unreleased]

### Added

- The core: a fluent, declarative pattern vocabulary (nouns, verbs, and the structure regex
  cannot express: `until`, `quoted`, `balanced`, `separatedBy`), a PEG engine with no
  backtracking and a step budget, `describe()` (a pattern read aloud), validated
  `toJSON`/`fromJSON`, and the operations `matches`, `parse`, `find`, `findAll`, `occursIn`,
  `replaceFirst`, `replaceAll`, `split`.
- A doc site (tosijs-ui) whose examples run live in the page.
