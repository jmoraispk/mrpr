import { AuthError, completeSignIn } from './auth'
import type { SiteConfig } from './config'

/** The name of the window opened for posting rights; it closes itself when done. */
export const POSTING_WINDOW = 'mrpr-allow-posting'

export interface ReturningPage {
  /** This window was opened for posting rights by another Mr. PR page. */
  postingWindow: boolean
  close(): void
  replaceState(path: string): void
}

const browserPage = (): ReturningPage => ({
  postingWindow: window.name === POSTING_WINDOW && Boolean(window.opener),
  close: () => window.close(),
  replaceState: (path) => history.replaceState(null, '', path),
})

/**
 * GitLab sends the user back here with `code`/`state`, or `error`. `closing`:
 * this page is going away (a posting window, or a restart toward GitLab), so
 * nothing should render, poll or refresh in it.
 */
export async function finishSignInIfReturning(
  url: URL,
  config: SiteConfig,
  page: ReturningPage = browserPage(),
  complete: typeof completeSignIn = completeSignIn,
): Promise<{ notice: string | null; closing: boolean }> {
  if (!url.searchParams.has('code') && !url.searchParams.has('error')) {
    return { notice: null, closing: false }
  }
  // Drop the one-time code from the address bar whatever happens next.
  page.replaceState(url.pathname)
  try {
    const result = await complete(url, config)
    if ('restarted' in result) return { notice: null, closing: true }
    if ('popup' in result && page.postingWindow) {
      page.close()
      return { notice: null, closing: true }
    }
    page.replaceState(`${url.pathname}${result.returnTo}`)
    return { notice: null, closing: false }
  } catch (error) {
    // A posting window whose sign-in failed: the page that opened it refuses
    // the post and says why.
    if (page.postingWindow) {
      page.close()
      return { notice: null, closing: true }
    }
    return {
      notice:
        error instanceof AuthError ? error.message : 'GitLab did not complete the sign-in. Try again.',
      closing: false,
    }
  }
}
