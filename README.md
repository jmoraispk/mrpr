<p align="center">
  <img src="./assets/banner.svg" alt="Delta — GitLab MR reviews, minus the wait." width="1280">
</p>

# DeltaReview

DeltaReview is a fast interface for reviewing GitLab merge requests. It runs
entirely in the browser and keeps GitLab as the source of truth.

> **Status:** Alpha.

## How it works

![Browser SPA to local proxy to GitLab API architecture](./assets/how_works.png)

## Private by design

![Delta privacy model](./assets/private.png)

## Quick start

Open the site, paste a link to any merge request, and sign in with GitLab.
Your browser talks to GitLab directly — there is nothing to install and no
server in between. See [docs/site-setup.md](./docs/site-setup.md) to host it
yourself.

## Current scope

DeltaReview reads text diffs and lets you create, reply to, resolve, and
unresolve GitLab discussions. If GitLab rejects a multiline position,
DeltaReview tries the last selected line and then posts a clearly labeled
general discussion. It does not submit approvals, batch reviews, or render
oversized/binary files.

## Development

```console
npm ci --prefix web
npm test --prefix web -- --run
npm run lint --prefix web
npm run build:site --prefix web
```

Run it locally with `npm run dev:site --prefix web`.

---

Contributions are welcome through
[issues](https://github.com/jmoraispk/delta-review/issues) and pull requests.
DeltaReview is released under the [MIT License](./LICENSE).
