/**
 * Human sentences for the codes the worker attaches to a single host, so the
 * page never shows a user a bare `gitlab_authentication_failed`. Wording
 * tracks `review/ErrorState.tsx`, which explains the same conditions once the
 * user is inside a review.
 */
const HOST_ERRORS: Record<string, string> = {
  host_not_configured:
    'Delta has no token stored for this host. Add it again in settings.',
  permission_missing:
    'Delta no longer has permission to reach this host. Grant access in settings.',
  gitlab_authentication_failed:
    'GitLab rejected the credentials Delta holds for this host. Renew them in settings.',
  gitlab_access_denied:
    'This GitLab account is not allowed to list merge requests on this host.',
  gitlab_not_found:
    'GitLab did not recognise this host’s API address. Check the hostname in settings.',
  gitlab_rate_limited: 'GitLab is rate limiting Delta. Wait briefly, then retry.',
  gitlab_timeout: 'GitLab did not answer in time. Retry when it is responsive.',
  gitlab_unavailable: 'GitLab is unavailable. Retry when it recovers.',
  gitlab_graphql_error:
    'GitLab refused the query Delta uses to find activity. Check that this host runs a recent GitLab.',
}

export function describeHostError(code: string): string {
  return HOST_ERRORS[code] ?? 'Delta could not load activity from this host.'
}
