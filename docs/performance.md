# Diff performance

Mr. PR lazy-loads the diff renderer, parses, highlights and builds split/unified
line data in a Web Worker, caches processed files, and virtualizes both the
changed-file rail and the diff stream itself.

## Automated acceptance benchmark

Install Chromium once, then run the production browser benchmark:

```console
npx --prefix web playwright install chromium
npm run benchmark:browser --prefix web
```

It runs the `@benchmark` tests in `web/e2e-site/diff-performance.spec.ts`, on
the same Playwright config as the site end-to-end suite
(`web/playwright.site.config.ts`): the site is built and previewed, every
GitLab endpoint is stubbed, and the benchmark signs in over the real OAuth flow
and opens the Changes tab of a merge request. The numbers are therefore the
browser's own work — the lazily loaded diff chunk, the worker, the virtualized
stream and the real scroll container — with no network of consequence in them.
`npm run test:site` runs everything else in that directory, so the benchmark
does not slow the ordinary suite down.

Two fixtures:

- **50 files, 5,000 changed lines** — the acceptance case. Measures cold open,
  whether the first paint is already syntax-highlighted, the cost of returning
  to a file whose bundle is cached, and long tasks while scrolling the stream
  at a reading pace.
- **300 files, 36,000 changed lines** (a 0.9 MB diff payload) — a merge request
  far larger than typical. Measures cold open, long tasks while scrolling in
  jumps, how long a jump from the rail to a distant file takes, how many
  sections are in the DOM, and the JS heap.

Acceptance targets:

- cached content appears within 100 ms;
- no long task over 250 ms while scrolling, at either size;
- the first paint of a diff is already highlighted, because the worker returns
  syntax tokens with the bundle rather than upgrading plain lines afterwards;
- only a window of the review is ever in the DOM (fewer than 20 sections); and
- at 300 files, a jump from the rail lands in under 1.5 s and the heap stays
  under 400 MB.

On 2026-10-16, Chromium on Windows recorded, over three runs:

| Measurement | 50 files | 300 files |
| --- | --- | --- |
| Cold open to first diff line | 895–960 ms | 921–954 ms |
| Cached switch | 11–21 ms | — |
| Longest scroll long task | 0–62 ms | 153–203 ms |
| Long tasks while scrolling | 0–7 | 26–55 |
| Jump from the rail (median) | — | 274–386 ms |
| Sections in the DOM | — | 5 |
| JS heap | — | 32–78 MB |

The first paint was highlighted in every run. Reading down the 50 file diff
usually crosses the long-task line not once; a machine busy with something else
manages the odd one, and a single run has been seen just over 100 ms, which is
why the threshold bounds the worst long task rather than demanding none. A run
with several is worth reading. Each test attaches its complete result as
`performance.json` and prints it as a `BENCH` line, so a threshold failure is
diagnosable without a rerun.

These numbers are not comparable with the ones recorded before 2026-10-15. Those
came from the deleted Playwright suite, which drove the removed local-proxy app
at `/#session=benchmark`; this harness drives the site, through sign-in, and
measures from the navigation to the Changes tab rather than from page load.

For a release trace, run:

```console
npm run benchmark:browser --prefix web -- --trace on
```

Open the generated `trace.zip` with `npx playwright show-trace`, inspect the
cold open, cached switch, and scroll interval, then attach the trace to the
release or pull request. Repeat the same observations against a real merge
request with at least 50 files and 5,000 changed lines before changing the
renderer or diff engine.

CI runs the benchmark on every push and pull request in the
`browser-performance` job.

## Parser regression signal

```console
npm run benchmark:diff --prefix web
```

On the same date, Node 24.14.1 processed parsing plus split/unified line
construction for 50 files and 5,000 changed lines in 3.11 ms. This smaller
benchmark intentionally excludes network latency, DOM rendering, and syntax
highlighting.
