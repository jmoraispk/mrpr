# Hosting Mr. PR

The site is the landing page at `/`, the app at `/app/`, and one small
function, `/api/registry`. Each visitor signs in with GitLab and their browser
talks to GitLab directly; the host never sees a token or a merge request.

## How visitors sign in

A visitor pastes a link to any merge request. Mr. PR reads the GitLab server
from it and looks for that server's Application ID: first the servers built
into this deployment, then the ones this browser has set up, then the shared
directory (`/api/registry`).

- **Known server:** straight to GitLab's Authorize screen.
- **Unknown server:** the visitor is the first from their organisation. A
  three-step, illustrated setup has them register Mr. PR on their own GitLab
  and paste the Application ID. Once a sign-in with that ID works, it goes into
  the directory, so the next person from that server signs in with one click.

The directory stores only `server address → Application ID`, both public by
design. No tokens, users or merge requests.

Trust model:

- **The first ID published for a server is kept.** Nobody can replace it
  through the API; the stored ID is public, so knowing it proves nothing.
- **On a company's own GitLab, that means trusting the first colleague's
  registration.** It lives in their personal account, so if they leave, the app
  goes with them. A group- or instance-level application is sturdier; repair
  the entry in the Upstash console when needed.
- **"Sign-in not working? Set it up again"** fixes things for that one browser
  only, without touching the directory.
- **Shared public servers** (gitlab.com, salsa.debian.org, gitlab.gnome.org and
  similar) can never be claimed through the directory, since anyone can
  register an app there. Their IDs come only from this deployment's build
  configuration.
- The directory only accepts `application/json` posts, so other websites cannot
  write to it through their visitors' browsers.

The tutorial images in `web/site/public/tutorial/` are rendered from the raw
screenshots in `docs/examples/` by `node web/scripts/annotate-tutorial.mjs`,
with personal details blurred. Only the renders are published.

## Why the site needs an origin of its own

Sign-in tokens are kept in the browser's `localStorage`, which belongs to the
whole origin (scheme and host), not to a path. Never serve Mr. PR from an
origin shared with other sites, such as a GitHub Pages project path under
`<user>.github.io`: a script on any of them could read visitors' tokens. A
Vercel project gets its own origin (`<project>.vercel.app`), and so does a
custom domain like `mrpr.dev`. The landing page shares the app's origin, so it
must never run a script; its Content Security Policy forbids them.

## 1. Deploy on Vercel

On vercel.com: Add New → Project → import `jmoraispk/mrpr`.

- Choose **Import single project** next to **web** (Vite). Not the FastAPI
  `app`, and not "Services".
- **Root Directory:** `web`. Build settings come from `web/vercel.json`
  (`npm run build:site`, output `dist-site`).
- Deploy. Until step 3 the app says it is "not set up to sign in"; the landing
  page works already.

Note the address Vercel gives the project, e.g. `https://mrpr.vercel.app`.

## 2. Register the sign-in application on GitLab

On gitlab-master: avatar → Preferences → Applications → Add new application.

- **Name:** Mr. PR
- **Redirect URIs**, one per line:
  - `https://mrpr.vercel.app/app/` (your Vercel address, then `/app/`)
  - `https://mrpr.dev/app/` (once the domain is connected)
  - `http://localhost:5173/app/` (local development)
- **Confidential:** off. The site cannot keep a secret; PKCE replaces one.
- **Scopes:** `api`. Mr. PR posts comments and replies, which needs write access.

Save, and copy the **Application ID**. It is public by design; do not copy the
secret, which Mr. PR never uses.

## 3. Configure the build

In the Vercel project: Settings → Environment Variables:

- `VITE_GITLAB_CLIENT_ID`: the Application ID.
- `VITE_GITLAB_HOST`: `gitlab-master.nvidia.com` (optional; the default).

Then Deployments → Redeploy. Vite reads these at build time, so a redeploy is
needed after changing them.

## 4. Connect the shared directory (Upstash Redis)

Vercel project → Storage → Create Database → **Upstash for Redis** (the free
plan is plenty) → connect it to this project. That sets `KV_REST_API_URL` and
`KV_REST_API_TOKEN`; `web/api/registry.ts` also accepts
`UPSTASH_REDIS_REST_URL` / `UPSTASH_REDIS_REST_TOKEN`. Redeploy.

Without it, everything still works: the directory answers "unknown", so every
newcomer from an unknown server sees the setup.

## 5. Connect mrpr.dev

Vercel project → Settings → Domains → add `mrpr.dev`, and set the DNS records
it shows. Add `https://mrpr.dev/app/` to the GitLab application's redirect URIs.

## Local development

    cd web
    echo "VITE_GITLAB_CLIENT_ID=<application id>" > .env.local
    npm run dev:site

Open http://localhost:5173/app/ and sign in. The landing page is at
http://localhost:5173/.

## Using the queue

After signing in, the app is one review queue. Each merge request is one row;
replies, mentions and comments on it are folded into that row rather than
listed separately.

- **Buckets:** Needs you (your review or a thread waiting on you), Quick wins
  (the same, 30 changed lines or fewer), Returned to you (changes requested or
  new comments on your MR, or new commits on one you reviewed), Waiting on
  others (your MR still needing approvals), and Done. Bot-authored MRs are
  folded into a count.
- **Order:** who is blocked first (the author plus reviewers who already
  approved), then age; drafts sink.
- **Since last review:** opening or approving an MR remembers its head commit
  in this browser. Next time, `d` (or the "Since last review" tab) shows only
  what changed since.
- **Projects:** group MRs by repository, by label, or by moving them by hand
  (`m`, or drag a row onto a project). Projects live in this browser; Settings
  exports and imports them as JSON.
- **Keys:** `j`/`k` move, `Enter` or `o` open, `a` approve, `r` reply, `x`
  request changes, `n` nudge, `s` snooze until the MR changes, `m` move to a
  project, `d` since last review, `f` full screen, `Esc` close (or leave full
  screen), `g n|r|w|q` jump to a bucket, `g p` projects, `?` help.
- **Comments are signed.** Replies, requests for changes (a comment tagging
  the author) and nudges (a comment tagging the reviewers still waiting) end
  with "*— via Mr. PR*". Turning the signature off is on the roadmap.

### Opening an MR

One click on a row opens the MR beside the list; `j`/`k` move to the next one
and the panel follows. `f` makes it full screen and `Esc` steps back.

- **Overview** (first): the description as GitLab would show it, and the
  Activity: threads and events in time order, with a "New since last review"
  divider, threads involving you outlined, and a reply box on each thread.
  **⚙ Show** picks what Activity shows (unresolved and resolved threads, new
  commits, bot comments, other activity), for this MR or for all MRs; anything
  hidden is counted, with "Show them". On the right: reviewers, approvals,
  pipeline, labels, project and commits, and **Rebase** when GitLab says the
  branch needs it and you can push to it.
- **Changes:** the code, with inline comments shown.
- **Since last review:** only what changed since you last looked.

## Security notes

- Tokens are stored in the visitor's browser (`localStorage`), last two hours,
  and refresh automatically. Signing out revokes the current token.
- The app ships a Content Security Policy allowing only its own scripts and
  connections to the configured GitLab host; the landing page allows no script
  at all. `vercel.json` adds `frame-ancestors 'none'` so neither can be framed.
  Never add a third-party script.
- Whoever can push to `main` controls the code that holds visitors' tokens.
  Protect the branch.
- Vercel's Hobby plan is for non-commercial use. Move to a paid plan before
  charging for Mr. PR.
