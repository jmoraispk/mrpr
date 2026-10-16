<p align="center">
  <img src="./assets/banner.svg" alt="Mr. PR — GitLab MR reviews, minus the wait." width="1280">
</p>

# Mr. PR

Coding got faster. Reviewing didn't.

Mr. PR is one inbox for every GitLab merge request waiting on you. It ranks
them by who is blocked rather than by what changed last, shows only the commits
pushed since you last looked, and lets you approve, reply, request changes or
nudge without opening a tab per merge request.

It is a static site. Your browser talks to GitLab directly — there is nothing
to install, and no server of ours in between.

> **Status:** Alpha.

## How it works

Signing in is GitLab's own OAuth, with PKCE, straight from the page. The access
and refresh tokens are kept in your browser's `localStorage` and are sent only
to your GitLab server. Every merge request, diff, discussion and approval is
read from and written to the GitLab API by your own browser, under your own
account, so Mr. PR sees exactly what you can see and nothing more.

A few small serverless functions back the site, and none of them touch your
code or your tokens:

| Endpoint | What it holds |
| --- | --- |
| `/api/registry` | Which public OAuth Application ID to use for a given GitLab server. Under PKCE an Application ID is public by design, so this is not a secret. |
| `/api/waitlist` | Email addresses left for the GitHub waitlist. |
| `/api/feedback` | Feedback sent from the in-app form. |
| `/api/users` | The date an account first signed in, for a trial later. Nothing depends on it yet. |

Because the browser is the only thing that reaches GitLab, a self-managed
instance behind your company VPN works as long as your browser can reach it.

## What it does today

**The queue.** Every merge request from every GitLab account you have added,
in one list. Rows carry the labels that explain why they are there — *Blocking
N people*, *Returned to you*, *Changes addressed*, *Quick win*, *Waiting on
others*, *Needs rebase* — and you can reorder those labels to match how you
triage. Sort by last change, age or size; filter to the ones that need you,
hide drafts, fold merged ones away, or widen to every open merge request in
your repositories. Group the sidebar by repository and mute the ones you never
want to see; bot chatter is folded out of the activity feed by default.

**To do, Done, All.** A tick marks a merge request handled. It comes back to
*To do* by itself when someone pushes or replies, so marking something done is
not the same as forgetting it. Snoozing hides one until you unsnooze it,
whatever happens meanwhile.

**Diff since your last look.** Coming back to a merge request shows only the
commits and files that landed since you last reviewed it, plus the threads
still waiting on you, instead of all 47 files again.

**Reviewing.** Create, reply to, resolve and unresolve discussions on single
lines or multi-line selections. Approve and unapprove. Request changes as a
clearly labelled comment; using GitLab's own native state, on instances new
enough to have one, is still on the roadmap. Nudge a reviewer with a friendly
reminder posted in the thread, so you never have to write the awkward message.
Every comment Mr. PR posts is signed `*— via Mr. PR*`, once.

**Keyboard first.** The queue is built to be cleared without a mouse:

| Key | Action | Key | Action |
| --- | --- | --- | --- |
| `j` / `k` | next / previous | `n` | nudge |
| `Enter` / `o` | open | `s` | snooze |
| `a` | approve | `e` | done, or back to To do |
| `r` | reply in thread | `d` | diff since last look |
| `x` | request changes | `/` | search |
| `f` | full screen | `b` / `Ctrl+B` | hide or show the sidebar |
| `?` | all shortcuts | `Esc` | leave full screen, else close |

## Not there yet

GitHub sign-in, projects synced across devices, the daily team digest, shared
triage rules and agent-authored labels are all on the
[roadmap](./docs/roadmap.md) and not built. Oversized and binary files are not
rendered.

## Quick start

Open the site and sign in with GitLab. If nobody at your organization has used
Mr. PR against your server before, it will walk you through registering it as
an OAuth application there — three steps, under a minute.

To host it yourself, see [docs/site-setup.md](./docs/site-setup.md).

## Development

```console
npm ci --prefix web
npm test --prefix web -- --run
npm run lint --prefix web
npm run build:site --prefix web
```

Run it locally with `npm run dev:site --prefix web`, and the browser end-to-end
suite with `npm run test:site --prefix web`.

The site is a Vite + React app under [`web/`](./web); its entry point is
`web/src/site-main.tsx` and it builds into `web/dist-site`. See
[docs/performance.md](./docs/performance.md) for how the diff renderer is kept
fast on large merge requests.

---

Contributions are welcome through
[issues](https://github.com/jmoraispk/mrpr/issues) and pull requests.
Mr. PR is released under the [MIT License](./LICENSE).
Not affiliated with GitLab Inc. or GitHub, Inc.
