# Diff performance

Mr. PR lazy-loads the diff renderer, parses and builds split/unified line data
in a Web Worker, defers syntax highlighting until after the plain diff is
visible, caches processed files, and virtualizes the changed-file list.

## Automated acceptance benchmark

Install Chromium once, then run the production browser benchmark:

```console
npx --prefix web playwright install chromium
npm run benchmark:browser --prefix web
```

The Playwright fixture contains 50 TypeScript files and 5,000 changed lines.
It records cold-open time, revisits a processed file to measure cached
switching, continuously scrolls a diff while observing browser long tasks,
and verifies that the unhighlighted diff appears before Lowlight starts.

Acceptance targets:

- cached content appears within 100 ms;
- continuous scrolling produces no long task over 100 ms; and
- syntax highlighting never blocks the initial plain diff.

On 2026-07-16, Chromium on Windows recorded a 1,095.9 ms cold open, a 30.0 ms
cached switch, no scrolling long task over 100 ms, plain diff content at
600.2 ms, and highlighting at 656.4 ms. The test attaches the complete result
as `performance.json`.

For a release trace, run:

```console
npm run benchmark:browser --prefix web -- --trace on
```

Open the generated `trace.zip` with `npx playwright show-trace`, inspect the
cold open, cached switch, and scroll interval, then attach the trace to the
release or pull request. Repeat the same observations against a public merge
request with at least 50 files and 5,000 changed lines before changing the
renderer or diff engine.

## Parser regression signal

```console
npm run benchmark:diff --prefix web
```

On the same date, Node 24.14.1 processed parsing plus split/unified line
construction in 10.48 ms. This smaller benchmark intentionally excludes
network latency, DOM rendering, and syntax highlighting.
