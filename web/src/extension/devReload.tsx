import { platform } from '../platform/platform'

/**
 * Reloads an unpacked extension from its own UI, so a rebuild does not require
 * a trip to chrome://extensions. Absent from release builds: __DELTA_DEV__ is
 * defined false there, so this compiles to `if (false)` and drops out.
 *
 * Reloading tears down every page the extension owns, including the one this
 * button lives on. Under Playwright's bundled Chromium the hub tab was closed
 * outright every time, so the title warns about it.
 *
 * That measurement is confounded, though, and the title hedges accordingly: in
 * every one of those runs the extension also never came back, which is a
 * permanent unload rather than a reload. An extension that ceases to exist
 * destroys its pages trivially. Whether the tab dies from the teardown — which
 * a real reload also does — or only from the permanent unload, which it does
 * not, was never measured. Three ways of loading the extension were tried,
 * headless and headed; none produced a restart under automation.
 *
 * The click deliberately does nothing but reload. Three recovery sequences
 * were tried and none adopted:
 *
 * - `tabs.reload()` before `runtime.reload()` — tab still closed.
 * - `runtime.reload()` before `tabs.reload()` — tab still closed; the second
 *   call does not survive long enough to run.
 * - `tabs.create()` before `runtime.reload()` — leaves a hollow tab with no
 *   `chrome` global and an unmounted React root. This one shares the confound
 *   above: a hollow page is also just what a dead extension yields.
 *
 * The reason that stands regardless of the confound is that each candidate is a
 * race against the teardown, and one that happens to work on a given machine is
 * worse than a one-line instruction. `chrome.tabs.reload()` was confirmed to
 * need no added permission, so if the tab turns out to survive, recovery is
 * worth revisiting. Check 23 in docs/extension-smoke.md asks a human to settle
 * it in a normally installed extension.
 */
export function DevReload() {
  const reload = platform().reload
  if (!__DELTA_DEV__ || !reload) return null

  return (
    <button
      className="dev-reload"
      title="Reload the unpacked extension from disk. This tab may not survive it — reopen the hub if it closes or stops responding."
      type="button"
      onClick={() => reload()}
    >
      Reload extension
    </button>
  )
}
