# Hosting Mr. PR

The site is static files: the landing page at `/` and the app at `/app/`.
Each visitor signs in with GitLab and their browser talks to GitLab directly;
the host never sees a token or a merge request.

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

## 4. Connect mrpr.dev

Vercel project → Settings → Domains → add `mrpr.dev`, and set the DNS records
it shows. Add `https://mrpr.dev/app/` to the GitLab application's redirect URIs.

## Local development

    cd web
    echo "VITE_GITLAB_CLIENT_ID=<application id>" > .env.local
    npm run dev:site

Open http://localhost:5173/app/ and sign in. The landing page is at
http://localhost:5173/.

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
