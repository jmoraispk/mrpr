# Extension release

One-time setup, then the first release. Steps 1–6 happen once, ever. Steps 7
onward repeat every time.

Every command below was run in Git Bash on Windows before this file was
written, against a throwaway key that has since been deleted. It needs
OpenSSL — Git for Windows ships 3.2.4 at `/mingw64/bin/openssl` — and Node
24. Check both first:

```console
openssl version
node --version
```

macOS and Linux need one change, called out at step 3.

## Two decisions this runbook assumes

**Tag `v0.1.0` directly. No release candidate.** The install page and both
update manifests point at `releases/latest/download/`, which GitHub resolves
to the newest release that is not a prerelease. A prerelease marked as such
leaves all of those links unresolvable, so it cannot validate the one thing
it exists to validate. An unmarked one becomes the live update target for
everybody already installed. Smoke-test the unpacked build first instead
(`docs/extension-smoke.md`), then tag once.

**`manifest.base.json` gets a `key` field, added at step 3.** Without it, an
unpacked build takes its extension ID from its folder path and the signed
build takes one from the signing key. The two differ, so the smoke test
exercises an identity production will never have, and anyone who tries both
install routes ends up with two copies of Delta running side by side. The
public key that goes in `key` is safe to commit. Only the `.pem` is secret.

## 1. Generate the signing key

Generate it **outside the working tree**. `.gitignore` does not list `*.pem`,
so a key left in the repo is one `git add -A` away from being published.

```console
mkdir -p ~/delta-keys && cd ~/delta-keys
openssl genrsa -out delta-review.pem 2048
```

OpenSSL 3 writes PKCS#8 — the file starts `-----BEGIN PRIVATE KEY-----`, not
`-----BEGIN RSA PRIVATE KEY-----`. `crx3`, which the workflow uses to pack
the CRX, accepts that form. No conversion needed.

Two rules about this file:

- **Never commit it.** It is the only thing that lets anyone publish an
  update Chrome will accept as Delta.
- **Never rotate it.** The Chrome extension ID is a hash of this key. A new
  key is a new ID, and a new ID is a different extension: every existing
  install keeps the old one, stops updating, and is never told there is a
  replacement. There is no migration path. Back the key up somewhere you will
  still have it in five years.

## 2. Derive the extension ID

Chrome's ID is the first 16 bytes of the SHA-256 of the DER-encoded public
key, hex-encoded, with `0-9a-f` remapped to `a-p`.

```console
openssl rsa -in delta-review.pem -pubout -outform DER 2>/dev/null \
  | openssl dgst -sha256 \
  | cut -d' ' -f2 \
  | cut -c1-32 \
  | tr '0-9a-f' 'a-p'
```

`2>/dev/null` drops `openssl rsa`'s "writing RSA key" line, which otherwise
lands in the middle of the output.

Check the result before using it. `web/scripts/make-update-manifests.mjs` and
`.github/workflows/extension.yml` both enforce `/^[a-p]{32}$/`, so anything
else is unusable:

```console
openssl rsa -in delta-review.pem -pubout -outform DER 2>/dev/null \
  | openssl dgst -sha256 | cut -d' ' -f2 | cut -c1-32 | tr '0-9a-f' 'a-p' \
  | grep -Eq '^[a-p]{32}$' && echo OK || echo 'NOT AN EXTENSION ID'
```

Node alone gives the same answer if openssl is not available:

```console
node -e 'const c=require("node:crypto"),f=require("node:fs");const d=c.createPublicKey(f.readFileSync(process.argv[1])).export({type:"spki",format:"der"});console.log([...c.createHash("sha256").update(d).digest("hex").slice(0,32)].map(h=>String.fromCharCode(97+parseInt(h,16))).join(""))' delta-review.pem
```

**`crx3` does not print the ID.** The claim turns up often enough to be worth
contradicting: against crx3 2.0.0 the only thing it writes is `CRX file
created at "..."`, and both `crx3 --help` and `crx3 --version` crash with a
`TypeError` rather than printing anything. Use the openssl derivation above.
Verified independently: the `crx_id` embedded in a CRX that crx3 packed from
a key was byte-identical to the ID the openssl pipeline derived from the same
key. If you want a second opinion anyway, load the packed `.crx` in Chrome
once and read the ID off `chrome://extensions`.

## 3. Extract the public key for the manifest

```console
openssl rsa -in delta-review.pem -pubout -outform DER 2>/dev/null | base64 -w0
```

The output is a single line of base64 with no wrapping and no trailing
newline — 392 characters for a 2048-bit key. `-w0` is a GNU flag; on macOS
use `| base64 | tr -d '\n'` instead.

Paste it into `web/src/extension/manifest.base.json` as `key`:

```json
{
  "manifest_version": 3,
  "name": "Delta Review",
  "description": "Review GitLab merge requests without leaving the browser.",
  "version": "0.1.0",
  "key": "MIIBIjANBgkqhkiG9w0BAQEFAAOCAQ8A…IDAQAB",
  "action": { "default_title": "Delta Review" },
  "permissions": ["storage", "activeTab", "alarms", "idle"],
  "optional_host_permissions": ["https://*/*"]
}
```

`web/scripts/build-extension.mjs` merges the base manifest into both targets,
so the Firefox build gets `key` too. That is harmless: `web-ext lint` on a
Firefox build carrying it reports no error, no warning and no notice about
it — checked, by linting the same manifest with and without the field and
comparing. Firefox takes its identity from
`browser_specific_settings.gecko.id`, which `key` does not touch. If a future
`web-ext` ever does object, move `key` into
`web/src/extension/manifest.chrome.json`; nothing else changes.

## 4. Fill in both ID placeholders

`REPLACE_WITH_ID_FROM_CRX_KEY` appears in two files, and nothing derives one
from the other:

- `web/src/extension/id.json` — becomes the `appid` in `updates.xml`.
- `docs/install/index.html` — the `EXTENSION_ID` constant in the script at
  the bottom, which builds the registry path in the PowerShell policy
  snippet.

Put the same 32 characters in both.

**CI validates the first and not the second.** The workflow reads `id.json`
and fails the job when it is not `[a-p]{32}`; `make-update-manifests.mjs`
throws on the same check. Neither reads `docs/install/index.html`. The two
can therefore drift, and a stale or wrong ID there produces a green release,
a policy registry key naming an extension that does not exist, and a Windows
user who restarts the browser to find nothing installed and no error
anywhere. Compare them by eye whenever either one changes.

## 5. Add the repository secrets

Settings → Secrets and variables → Actions → New repository secret.

| Secret | Value |
| --- | --- |
| `CRX_PRIVATE_KEY` | The whole contents of `delta-review.pem`, including the `-----BEGIN` and `-----END` lines. |
| `AMO_JWT_ISSUER` | JWT issuer from <https://addons.mozilla.org/developers/addon/api/key/> |
| `AMO_JWT_SECRET` | JWT secret from the same page. It is shown once. |

The AMO credentials drive `web-ext sign --channel unlisted`, which is Mozilla
signing a self-hosted add-on rather than listing it on AMO. Delta is
distributed from GitHub releases either way.

### The data collection declaration

Mozilla requires a data-collection declaration on new extensions, so
`web/src/extension/manifest.firefox.json` carries this under `gecko`:

```json
"data_collection_permissions": { "required": ["none"] }
```

`"none"` is the schema's own token for "collects nothing" — it is a validated
enum, not free text, so a wrong value fails the lint as `JSON_INVALID` rather
than passing quietly.

**Why that is true, if AMO asks.** Delta stores a GitLab personal access token
per host in `browser.storage.local` (`web/src/extension/hosts.ts`) and sends it
as a `PRIVATE-TOKEN` header to that host's `/api/v4` only
(`web/src/gitlab/client.ts`), where the host is one the user typed in Settings
and separately granted an optional host permission for. `GitLabClient` is the
only thing in the extension bundle that reaches the network: the hub entry
(`hub.html` → `src/hub-main.tsx`) uses the runtime transport, which forwards
every call through the background worker, so the HTTP transport that talks to
the local CLI server is never bundled into the extension. There is no
Delta-operated backend, no analytics, no telemetry and no remote logging, and
error strings are scrubbed of the token before they leave the worker
(`scrubToken` in `web/src/extension/router.ts`). Recheck this before changing
the declaration — a false statement to Mozilla costs far more than a warning.

The one thing that does phone home is Firefox itself polling `update_url` on
GitHub for updates. That is the browser, not the extension, and it is inherent
to self-hosted distribution.

**Two warnings this produces, both expected.** The key needs Firefox 140 (142
on Android) and `strict_min_version` is `128.0`, so the linter reports
`KEY_FIREFOX_UNSUPPORTED_BY_MIN_VERSION` and
`KEY_FIREFOX_ANDROID_UNSUPPORTED_BY_MIN_VERSION`. Leave the minimum at 128:
`optional_host_permissions` is what pins it there, the declaration is
store-facing metadata that older Firefox simply ignores, and raising the
minimum would drop real users for no runtime gain.

**Lint with `--self-hosted`.** Plain `web-ext lint` reports `MANIFEST_UPDATE_URL`
as an *error*, because `update_url` is banned for add-ons listed on AMO. Delta
is unlisted and self-hosted, where it is required:

```console
npm run build:extension --prefix web
npx --yes web-ext lint --source-dir web/dist-extension/firefox --self-hosted
```

That reports zero errors. The remaining `UNSAFE_VAR_ASSIGNMENT` warnings come
from bundled dependency code, not from Delta's own source.

## 6. Enable GitHub Pages

Settings → Pages → Source "Deploy from a branch", branch `main`, folder
`/docs`. That publishes
`https://jmoraispk.github.io/delta-review/install/`, which is the link in the
README and the only thing anyone needs to install Delta.

Pages serves the install page and nothing else. The update manifests are
release assets, not Pages files: the workflow uploads `updates.xml` and
`updates.json` to the release, and both `update_url`s point at
`releases/latest/download/`.

## 7. Set the version and tag it

Bump `version` in `web/src/extension/manifest.base.json` to `0.1.0`, then:

```console
git commit -am "release: v0.1.0"
git push
git tag v0.1.0
git push origin v0.1.0
```

CI compares `v$version` against the tag name before it builds anything and
fails immediately if they disagree. That is deliberate. `web-ext sign` spends
AMO's one submission per version number, so a mismatch caught after signing
costs a version bump and a re-tag, while a mismatch caught before the build
costs twenty seconds.

Do the unpacked smoke test before tagging, not after:

```console
npm run build:extension --prefix web
```

then load `web/dist-extension/chrome` and `web/dist-extension/firefox` and
work through checks 1–19 of `docs/extension-smoke.md`. Checks 20–22 need a
published release and run after step 8.

### Confirm the development-only button did not ship

The hub carries a "Reload extension" button in development builds only
(`web/src/extension/devReload.tsx`). Against the release build just made, grep
the bundle for its label:

```console
grep -rl "Reload extension" --include='*.js' web/dist-extension/chrome
```

Nothing may match — `grep` exits 1 and prints no path.

That check is worth nothing unless it can fail, so prove it can. Build the
development variant and run the same grep; it must name the hub bundle:

```console
npm run build:extension --prefix web -- --dev
grep -rl "Reload extension" --include='*.js' web/dist-extension/chrome
```

Then rebuild without `--dev`, so the folder you smoke-test and the folder you
just proved clean are the same one.

**Do not grep for `__DELTA_DEV__` instead.** Vite's `define` substitutes that
identifier textually, in the development build as much as the release one, so
it is absent from both and the grep reports success even if the entire button
shipped. The button's own label is the only string that tells the two builds
apart.

`workflow_dispatch` runs the whole job except signing and the release, so it
is a usable dry run — as long as `CRX_PRIVATE_KEY` already exists, since the
CRX pack step is not gated on a tag.

## 8. What the release produces, and how to check it

Five assets:

- `delta-review-chrome.zip` — the unpacked fallback
- `delta-review.crx` — signed; what the Windows policy install pulls
- `delta-review.xpi` — Mozilla-signed; what the Firefox link installs
- `updates.xml` — Chrome update manifest
- `updates.json` — Firefox update manifest

`fail_on_unmatched_files: true` means a missing one fails the job rather than
publishing a release that installs fine and then silently never updates.

Confirm every link the install page hands out resolves. `latest/download/` is
a redirect, so follow it and report the final status:

```console
for f in delta-review.xpi delta-review.crx delta-review-chrome.zip \
         updates.xml updates.json; do
  printf '%-26s ' "$f"
  curl -sIL -o /dev/null -w '%{http_code}\n' \
    "https://github.com/jmoraispk/delta-review/releases/latest/download/$f"
done
```

All five must be `200`. A `404` means either the asset name changed or
`latest` resolved to something that is not the release you just made.

Then read the two update manifests:

```console
base=https://github.com/jmoraispk/delta-review/releases/latest/download
curl -sL "$base/updates.xml"
curl -sL "$base/updates.json"
```

`updates.xml` must carry the same `appid` as `web/src/extension/id.json` and
the version you tagged. `updates.json` must key on
`delta-review@jmoraispk.github.io` and advertise the same version.

Last, open <https://jmoraispk.github.io/delta-review/install/> in Chrome,
Edge and Firefox and confirm each one shows its own path and that the ID in
the PowerShell snippet matches `id.json`. Then run smoke checks 20–22, which
are the only checks that exercise the signed, self-updating arrangement
end to end.

## For every subsequent release

Steps 1–6 are one-time. After that:

1. Bump `version` in `web/src/extension/manifest.base.json`.
2. Build, grep the release build for "Reload extension" (step 7), and run
   smoke checks 1–19 on the unpacked build.
3. Commit, push, tag `v<version>`, push the tag.
4. Confirm the five assets resolve and both update manifests advertise the
   new version (step 8).
5. Confirm an already-installed browser picks the update up on its own
   (smoke check 22).

Do not touch the signing key, the `key` field, the extension ID or either
placeholder — they are fixed for the life of the extension. If AMO rejects
the version as a duplicate, a tag went out ahead of the manifest bump: fix
the manifest, move to the next patch version, and tag that.
