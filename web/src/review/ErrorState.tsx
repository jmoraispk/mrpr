import { ApiError } from '../api/client'
import { currentPlatform } from '../platform/platform'

interface ErrorStateProps {
  error: Error
  onRetry: () => void
}

function errorCopy(error: Error): {
  heading: string
  guidance: string
  mark: string
} {
  const status = error instanceof ApiError ? error.status : null
  const code = error instanceof ApiError ? error.code : null
  if (code === 'gitlab_authentication_failed') {
    return {
      heading: 'GitLab authentication failed',
      guidance:
        'GitLab rejected the credentials Mr. PR holds for this host. Renew ' +
        'them in Mr. PR settings, then retry.',
      mark: '401',
    }
  }
  if (code === 'permission_missing') {
    return {
      heading: 'Mr. PR lost access to this GitLab host',
      guidance:
        'The browser permission for this host was withdrawn. Grant it again ' +
        'from Mr. PR settings, then retry.',
      mark: '403',
    }
  }
  if (code === 'extension_unavailable') {
    // The transport words this one per operation: a read that ran out of
    // retries and a write it deliberately refused to retry need different
    // advice, and the write's "may or may not have been posted" is the whole
    // point. Show that message rather than a generic line that hides it.
    return {
      heading: 'Mr. PR background service unavailable',
      guidance: error.message,
      mark: '503',
    }
  }
  if (code === 'diff_truncated') {
    return {
      heading: 'Diff is incomplete',
      guidance: 'GitLab truncated this merge request diff. Open it in GitLab.',
      mark: '422',
    }
  }
  if (code === 'gitlab_timeout') {
    return {
      heading: 'GitLab request timed out',
      guidance: 'Check the GitLab connection, then retry.',
      mark: '504',
    }
  }
  if (status === 401) {
    return {
      heading: 'Session expired',
      guidance: 'Sign in to GitLab again, then retry.',
      mark: '401',
    }
  }
  if (status === 403) {
    return {
      heading: 'Access denied',
      guidance:
        'This GitLab account cannot see this merge request. Check your ' +
        'project access, then retry.',
      mark: '403',
    }
  }
  if (status === 404) {
    return {
      heading: 'Merge request not found',
      guidance: 'Confirm the project and merge request still exist.',
      mark: '404',
    }
  }
  if (status === 429) {
    return {
      heading: 'GitLab rate limit reached',
      guidance: 'Wait briefly, then retry the request.',
      mark: '429',
    }
  }
  if (status !== null && status >= 500) {
    return {
      heading: 'GitLab is unavailable',
      guidance: 'The upstream service failed. Retry when GitLab recovers.',
      mark: String(status),
    }
  }
  return {
    heading: 'Review could not be loaded',
    guidance: 'Check that Mr. PR and GitLab are both reachable, then retry.',
    mark: '!',
  }
}

/** An ended sign-in is fixed by signing in again. */
function siteSignInEnded(error: Error): (() => Promise<void>) | null {
  const reauthenticate = currentPlatform()?.reauthenticate
  const code = error instanceof ApiError ? error.code : null
  return reauthenticate &&
    (code === 'signed_out' || code === 'gitlab_authentication_failed')
    ? reauthenticate
    : null
}

export function ErrorState({ error, onRetry }: ErrorStateProps) {
  const signInAgain = siteSignInEnded(error)
  if (signInAgain) {
    return (
      <main className="state-screen error-state" role="alert">
        <div className="state-mark error-code" aria-hidden="true">
          401
        </div>
        <h1>Your GitLab sign-in has ended</h1>
        <p>Sign in again to carry on. This merge request reopens afterwards.</p>
        <button
          className="primary-action"
          type="button"
          onClick={() => void signInAgain()}
        >
          Sign in again
        </button>
      </main>
    )
  }
  const copy = errorCopy(error)
  return (
    <main className="state-screen error-state" role="alert">
      <div className="state-mark error-code" aria-hidden="true">
        {copy.mark}
      </div>
      <h1>{copy.heading}</h1>
      <p>{copy.guidance}</p>
      <details>
        <summary>Technical detail</summary>
        <code>{error.message}</code>
      </details>
      <button type="button" onClick={onRetry}>
        Retry
      </button>
    </main>
  )
}
