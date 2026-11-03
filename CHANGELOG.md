# Changelog

## [Unreleased]

### Added

- The core: a fluent CHAIN from one import, `pattern.start().digits(3).text('-').end()` (nouns,
  verbs, `.as()` captures, and the structure regex cannot express: `until`, `quoted`,
  `balanced`, `listOf`), a PEG engine with no
  backtracking and a step budget, `describe()` (a pattern read aloud), validated
  `toJSON`/`fromJSON`, and the operations `matches`, `parse`, `find`, `findAll`, `occursIn`,
  `replaceFirst`, `replaceAll`, `split`.
- `fromRegex()`: a regex in, an equivalent pattern out, or a `RegexRefusal` with a coded reason,
  the place in the source, and what to write instead. It translates only where it can prove that
  possessive repetition and ordered choice give the regex's answer, and turns a lazy `C*?` before
  the end of the regex into `until`. Over tjs-lang's source 67% of regexes translate and every one
  agrees with its regex on generated inputs.
- Every capture keeps its matched text as well as its value (`texts` on a match and a parse
  result). Replacement templates insert the text: `$3.50` → `'{amount} USD'` gives `3.50 USD`.
- Two more captures that were silently lost are now errors that say what to write: a name
  recorded twice in one scope (the second overwrote the first), and a capture inside
  `until()`'s stopping point.
- `find`, `findAll` (and so `replaceAll`, `split`, `occursIn`) step one whole code point at a
  time: they no longer try a match in the middle of a surrogate pair. Found by `fromRegex`'s
  differential check on `/[\uD800-\uDFFF]/u`.
- `toCode()`: any pattern written as the chain that builds it, so `fromRegex(re).toCode()` gives
  a regex back as readable code.
- `lineStart()` and `lineEnd()` agree with `lineBreak()`: a line break is `\r\n`, `\n` or `\r`,
  never the middle of a `\r\n`. Before, `lineStart()` ignored `\r`, so a file with `\r` line
  endings had one line, and `lineEnd()` matched between the `\r` and `\n` of a `\r\n`.
- `restOfLine()`, and `indentedBlock()`: the lines after this one indented deeper than it (a
  Python body, a Markdown list item's continuation), dedented as its value so it parses again.
- `columns()`: a row of named columns, fixed width (`[{ name, width }, …]`, values trimmed) or
  delimited (`[names], { separatedBy }`), with the row as its value. `lines(row)`: one row per
  line, its value the list. `listOf(…, { trailing: true })` allows a final separator.
- `startAt(p)` / `startAfter(p)`: a pattern's first step, skipping to (or past) the first `p`;
  the match, its text and its value begin there. `pattern.startAfter(pattern.lineBreak()).lines(rows)`
  is a table's rows after its header line. For a search it is the usual use of a lookbehind:
  `pattern.startAfter('$').number()` finds numbers without their `$`; it stays linear.
- A doc site (tosijs-ui) whose examples run live in the page.
