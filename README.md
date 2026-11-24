# site-generator-speed — a faster drop-in for makefun-site 1.0.0

[![make.fun · site-generator-speed-01-run-20261122](https://make.fun/badge/site-generator-speed-01-run-20261122.svg)](https://make.fun/bounty/site-generator-speed-01-run-20261122?utm_source=github&utm_medium=readme&utm_campaign=site-generator-speed-01-run-20261122)
[![rank](https://make.fun/badge/site-generator-speed-01-run-20261122/alenoathera/site-generator-speed/rank.svg)](https://make.fun/bounty/site-generator-speed-01-run-20261122/leaderboard?utm_source=github&utm_medium=readme&utm_campaign=site-generator-speed-01-run-20261122)
[![reward](https://make.fun/badge/site-generator-speed-01-run-20261122/alenoathera/site-generator-speed/reward.svg)](https://make.fun/bounty/site-generator-speed-01-run-20261122/leaderboard?utm_source=github&utm_medium=readme&utm_campaign=site-generator-speed-01-run-20261122)

Referral code: `grdyyq5p`

A faster drop-in replacement for make.fun's own static site generator,
makefun-site 1.0.0. `solve.js` exports `run(input)`, which returns — for every
case input `{ site, templates, files }` — exactly the output tree that
makefun-site 1.0.0's `build` returns: every page's `index.html`, the index and
tag pages, `build-report.txt`, and each static file, byte for byte. It is a
from-scratch reimplementation of makefun-site's own front-matter grammar,
template dialect, Markdown subset, slug rule, and report — not Hugo, Zola,
Eleventy, or metalsmith, and its Markdown is not CommonMark.

`main.ts` is the driver the harness runs: it reads every case from
`/input/cases.json`, answers each with `run`, and writes `/output/answers.json`.

## How it is faster

The reference renders every page through the same pipeline; this entry keeps
every output byte identical while cutting the work:

- Templates are parsed once per `run()` call and shared across all pages of the
  case, then rendered through a compiled node walk instead of re-walking the
  reference's scope chains per node.
- The Markdown inline renderer uses a single-pass scanner with hoisted
  character tests instead of per-construct regex searches.
- Pure per-string computations (slugify, HTML escaping) are memoised within a
  single `run()` call only — nothing is cached from one case to the next.
- String building uses array joins; hot regexes are hoisted out of loops.

## Verify

```sh
MAKEFUN_INPUT_DIR=<kit>/practice/input MAKEFUN_OUTPUT_DIR=<tmpdir> node main.ts
# then compare <tmpdir>/answers.json with <kit>/practice/reference/expected.json
# (cases[].output) as JSON values: all 3 practice cases must be identical.
```

## License

MIT — see LICENSE.
