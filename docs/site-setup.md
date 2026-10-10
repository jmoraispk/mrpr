# Hosting Delta Review

The site is static files. Each visitor signs in with GitLab and their browser
talks to GitLab directly; the host never sees a token or a merge request.

## 0. Give the site an origin of its own

Sign-in tokens are kept in the browser's `localStorage`, which belongs to the
whole origin (scheme and host), not to a path. A GitHub Pages *project* site
such as `https://jmoraispk.github.io/delta-review/` shares the origin
`https://jmoraispk.github.io` with every other Pages site of that account, so a
script on any of them could read a visitor's GitLab token. The site's Content
Security Policy cannot prevent this: it only governs Delta's own page.

Use one of:

- **A custom domain** for this repository's Pages site (Settings → Pages →
  Custom domain), for example `https://delta.example.com`.
- **A dedicated account or organisation** whose root site
  (`https://<name>.github.io`) serves only Delta.

Then set the repository variable `DELTA_SITE_ORIGIN` to that origin, with no
path (see step 2). The deploy refuses to run without it, and refuses an origin
shared with other Pages sites.

## 1. Register the sign-in application on GitLab

On gitlab-master: avatar → Preferences → Applications → Add new application.

- **Name:** Delta Review
- **Redirect URIs**, one per line:
  - `<DELTA_SITE_ORIGIN>/`, for example `https://delta.example.com/` (the hosted site)
  - `http://localhost:5173/` (local development)
  - `http://127.0.0.1:4174/` is not needed: end-to-end tests fake GitLab.
- **Confidential:** off. The site cannot keep a secret; PKCE replaces one.
- **Scopes:** `api`. Delta posts comments and replies, which needs write access.

Save, and copy the **Application ID**. It is public by design; do not copy the
secret, which Delta never uses.

## 2. Configure the build

In the GitHub repository: Settings → Secrets and variables → Actions →
Variables:

- `DELTA_SITE_ORIGIN`: the dedicated origin from step 0, e.g. `https://delta.example.com`.
- `DELTA_GITLAB_CLIENT_ID`: the Application ID.
- `DELTA_GITLAB_HOST`: `gitlab-master.nvidia.com` (optional; the default).

## 3. Turn on GitHub Pages

Settings → Pages → Source: **GitHub Actions**. The `site` workflow then
deploys on every push to `main` that touches `web/`, or on demand from the
Actions tab.

## Local development

    cd web
    echo "VITE_GITLAB_CLIENT_ID=<application id>" > .env.local
    npm run dev:site

Open http://localhost:5173/ and sign in.

## Security notes

- Tokens are stored in the visitor's browser (`localStorage`), last two hours,
  and refresh automatically. Signing out revokes the current token.
- The page ships a Content Security Policy allowing only its own scripts and
  connections to the configured GitLab host. Never add a third-party script.
- Whoever can push to `main` controls the code that holds visitors' tokens.
  Protect the branch.
- The site is publicly reachable but contains no data. Confirm with your
  security policy that signing in to an internal GitLab from a publicly hosted
  page is acceptable before sharing the link.
