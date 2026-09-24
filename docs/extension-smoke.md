# Extension smoke test

Run in Chrome, Edge, and Firefox before tagging a release.

1. Load the unpacked build (`web/dist-extension/<browser>`).
2. Click the Delta toolbar icon → the hub opens on the setup card.
3. Settings → add your GitLab host and an `api`-scoped token → the browser
   prompts for permission for that host only → the host appears with your
   username.
4. Return to the lists → "Awaiting your review" and "Yours" populate.
5. Open a merge request from a list → the diff renders.
6. Select a single line → post a comment → it appears inline.
7. Drag-select several lines → post a comment → it appears with the full range.
8. Reply to a discussion → the reply appears.
9. Resolve, then unresolve it → the state sticks after a reload.
10. Navigate to a GitLab merge request page in another tab, click the Delta
    icon → the hub jumps straight to that merge request, in the same tab as
    before rather than a new one.
11. Paste a merge request URL into "Open by URL" → it opens.
12. Paste a URL for an unconfigured host → it offers to add the host.
13. Revoke the host permission in the browser's extension settings, reload the
    hub → the list offers "Grant access" rather than an opaque error. Click it,
    accept, and the lists reload.
14. Open devtools on the hub page and confirm no token string appears in any
    message payload logged to the console. (`chrome.storage.local` is reachable
    from an extension page by design; what matters is that no response from the
    service worker carries the token.)
15. Remove the host in settings → the lists return to the setup card.

## Assumptions this build could not settle

Each item below is a decision the implementation made that only a real browser
can confirm. Every one records what to do if it fails, so record the outcome
rather than just passing or failing it.

16. **`activeTab` populates `tab.url`.** Click the Delta icon while the active
    tab is on a GitLab merge request page. Expected: the hub opens on that
    merge request's review view (this is step 10, checked here for its cause).
    If it opens the lists instead, `tab.url` arrived empty, because `activeTab`
    did not expose it. The remedy is adding `"tabs"` to `permissions` in
    `web/src/extension/manifest.base.json`, at the cost of a "read your
    browsing history" warning on every install.
17. **The permission prompt fires from the settings form.** In Settings, add a
    host. Expected: the browser shows its permission prompt for that host.
    `browser.permissions.request` requires a user gesture, and it is called
    from inside a TanStack Query mutation, two microtask ticks after the click.
    If no prompt appears, the gesture was lost in those ticks and the
    `permissions.request` call must move into the click handler itself.
18. **Firefox honours `optional_host_permissions` at the declared minimum.**
    Repeat check 17 on Firefox 128 specifically. The manifest sets
    `strict_min_version: 128.0` because MDN records Firefox 128 as the first
    release supporting that key, and Firefox silently drops manifest keys it
    does not recognise rather than refusing to install. Confirm on 128 that
    adding a host really does prompt and really does grant. If it does not,
    raise `strict_min_version` to the first release where it does.
19. **The hub is legible.** Load the hub with the OS in light mode, then again
    in dark mode. Check merge request titles, error messages, and the "Add
    host", "Remove" and "Grant access" buttons in both. This shipped broken
    once: `web/src/index.css` carries a legacy light-default palette alongside
    the real dark one, and the hub originally drew from the wrong set,
    rendering near-black text on a near-black background.

Checks 20–22 cannot run until the signing key exists and a release has been
published — see `docs/extension-release.md`. Until then they are *blocked*,
not failed.

20. **Chrome's `normal_installed` leaves the extension user-removable.** After
    running the policy install from `docs/install/index.html`, open
    `chrome://extensions` and confirm Delta can still be disabled and removed.
    If it cannot, the install page must say so plainly, or switch to a policy
    mode that permits removal.
21. **HKCU policy survives corporate device management.** Run the policy
    install on a managed work laptop. If device management ignores or
    overrides it, the unpacked-folder route becomes the primary instruction for
    that audience and the install page should lead with it there.
22. **Auto-update actually arrives.** Install from the install page, not from
    an unpacked folder. Then bump `version` in
    `web/src/extension/manifest.base.json`, tag, and let the release publish.
    Expected: within the browser's own update interval — or immediately, via
    "Update" on `chrome://extensions` and "Check for Updates" in Firefox's
    add-ons manager — the installed extension moves to the new version with no
    reinstall and no second visit to the install page.

    This is the one check that exercises the whole self-hosting arrangement,
    and it rests on an assumption: both update URLs point at
    `https://github.com/jmoraispk/delta-review/releases/latest/download/...`,
    which is an HTTP redirect to the current release's asset. Chrome's update
    client and Firefox's must follow that redirect. It is the standard way to
    self-host, but nothing here proves it. If the browser never updates, check
    whether it fetched `updates.xml` / `updates.json` at all; if the redirect is
    the problem, pin the update URLs to a fixed host you control instead of
    `latest/download`.

Checks 23 and 24 run only against a development build (`npm run build:extension
--prefix web -- --dev`). Release builds do not render the button at all, so on
those there is nothing to click and the checks are *not applicable*, not failed.

23. **What "Reload extension" does to the hub tab, and whether the reload
    works at all.** These are one check because the automated probe could not
    separate them, and a tester with a real browser can settle both in one go.

    Load the development build, open the hub, change a string in the source and
    rebuild, then click "Reload extension". Record two things: what happened to
    **this tab**, and whether the extension **came back** carrying the new
    string (reopen the hub from the toolbar icon to look).

    What the probe measured, and what it could not: in Playwright's bundled
    Chromium — no version string was ever recorded — across seven runs,
    headless and headed, with the extension loaded three different ways,
    clicking the button closed the hub tab every time. But in every one of
    those runs the extension **also never came back**: `chrome-extension://`
    URLs returned `ERR_BLOCKED_BY_CLIENT` for thirty seconds and no service
    worker returned. That is a permanent unload, not a reload, and it is
    near-certainly an artefact of driving Chrome under automation rather than
    real behaviour.

    So the two outcomes are confounded, and the probe cannot tell them apart.
    An extension that ceases to exist destroys its pages trivially; that says
    nothing about the case this button is meant to create, where the extension
    unloads and immediately returns. **Whether the tab closes because of the
    teardown — which a real reload also does — or because of the permanent
    unload, which a real reload does not, is unmeasured.** Treat "the tab
    closes" as likely but unconfirmed, which is why the button's title hedges.

    Any of these is a legitimate result; write down which you saw:

    - *Tab closes, extension comes back with the new string.* The probe's
      reading was right. Tighten the title to state closure outright — and with
      it the two title assertions in `web/src/extension/devReload.test.tsx`,
      which pin today's hedge (`/may not survive/i`, `/reopen the hub/i`) and
      fail the moment the wording changes.
    - *Tab survives blank or broken, extension comes back.* Also fine, and it
      means the closure was the artefact, not the teardown. Say so in the title,
      drop "closes" from it, and update those same assertions in
      `devReload.test.tsx`.
    - *Tab survives and keeps working.* Better than expected — the title's
      warning can go entirely, and so can the `devReload.test.tsx` assertions
      that hold it in place.
    - *Extension does not come back.* The button is worse than useless and
      should be removed.
    - *No button in a `--dev` build.* The `__DELTA_DEV__` define did not reach
      the bundle.

    The button deliberately does nothing but `runtime.reload()`. Three recovery
    sequences were tried and none was adopted: `tabs.reload()` either side of
    `runtime.reload()` left the tab closed regardless of ordering, and
    `tabs.create()` beforehand left a hollow tab rendering the hub's title with
    no `chrome` global and an unmounted React root. Note that the last of these
    is exactly what a page of a permanently-unloaded extension looks like, so
    it is the same confounded observation rather than independent evidence. The
    standing reason for adding no recovery call is that every candidate is a
    race against the teardown, and a sequence that happens to work on one
    machine is worse than a one-line instruction. If you find the tab survives,
    recovery is worth revisiting — `chrome.tabs.reload()` needs no new
    permission, which the probe did confirm directly.

24. **Firefox is entirely unverified.** The probe covers Chrome only; nothing
    in check 23 has been observed on Firefox even once. Repeat the whole of
    check 23 there. `browser.runtime.reload()` exists in Firefox, but whether
    it closes the tab, blanks it, or leaves it working is unknown. If Firefox
    misbehaves, gate the button to Chrome and say so in its title.

25. **Inbox fills and counts.** With a host added, open the hub. It lands on
    Inbox and says "Checking GitLab for activity…", then shows the last three
    days of replies, mentions and comments on your merge requests, grouped by
    merge request. The toolbar badge and the Inbox link show the same unread
    count, and the tab title starts with it.

26. **A new reply arrives on its own.** Have someone reply in a thread you
    commented in, on a merge request you do not own. Within about two minutes,
    without touching the hub, the badge count rises. With the hub open, the row
    appears without a reload.

27. **Idle means quiet.** Lock the machine for more than five minutes and check
    the worker's network log (`chrome://extensions` → service worker →
    Network): no GraphQL requests while locked. Unlock: one poll runs at once.

28. **Opening an item lands on the thread.** Click an inline reply. The review
    opens with inline comments on, scrolled to the file, and the thread
    outlined briefly. Click a general comment: the MR discussions panel opens
    at it. Back in the inbox, both rows are dimmed and the counts dropped.
