import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { http, HttpResponse } from 'msw'
import { expect, test, vi } from 'vitest'

import { api, ApiError } from '../api/client'
import { ErrorState } from '../review/ErrorState'
import { TransportProvider } from '../transport/context'
import { createHttpTransport } from '../transport/http'
import { server } from './server'

/**
 * `proxy` is the Python deployment; any other key is an extension review of
 * one merge request. Only `targetKey` decides the wording, so overriding it on
 * the HTTP transport is enough to render either product's copy.
 */
function renderErrorState(
  error: Error,
  { onRetry = () => undefined, targetKey = 'proxy' } = {},
) {
  return render(
    <TransportProvider transport={{ ...createHttpTransport(), targetKey }}>
      <ErrorState error={error} onRetry={onRetry} />
    </TransportProvider>,
  )
}

function guidance(): HTMLElement {
  return screen.getByRole('alert').querySelector('p')!
}

test.each([
  [401, undefined, 'Session expired'],
  [401, 'gitlab_authentication_failed', 'GitLab authentication failed'],
  [403, undefined, 'Access denied'],
  [404, undefined, 'Merge request not found'],
  [403, 'permission_missing', 'Mr. PR lost access to this GitLab host'],
  [422, 'diff_truncated', 'Diff is incomplete'],
  [429, undefined, 'GitLab rate limit reached'],
  [503, undefined, 'GitLab is unavailable'],
  [503, 'extension_unavailable', 'Mr. PR background service unavailable'],
])('explains HTTP %s failures', (status, code, heading) => {
  renderErrorState(new ApiError(status, 'request failed', code))

  expect(screen.getByRole('heading', { name: heading })).toBeVisible()
})

test('names both CLI credential sources in precedence order, not Mr. PR', () => {
  renderErrorState(
    new ApiError(401, 'unauthorized', 'gitlab_authentication_failed'),
    { targetKey: 'proxy' },
  )

  // Mr. PR holds no GitLab credentials under `uvx delta-review`. Two other
  // things can, and `resolve_token` returns GITLAB_TOKEN before it asks glab,
  // so a user who launched with the variable set can run `glab auth login`
  // all day and still get the same 401. Both have to be named, in the order
  // the server tries them, or half these users are sent somewhere useless.
  const text = guidance().textContent ?? ''
  expect(text).toMatch(/GITLAB_TOKEN/)
  expect(text).toMatch(/glab auth login/i)
  expect(text.indexOf('GITLAB_TOKEN')).toBeLessThan(text.indexOf('glab auth'))
  expect(guidance()).not.toHaveTextContent(/Mr. PR holds/i)
})

test('tells an extension user to renew the credentials Mr. PR holds', () => {
  renderErrorState(
    new ApiError(401, 'unauthorized', 'gitlab_authentication_failed'),
    { targetKey: 'h/group/project/42' },
  )

  // The extension stores its own token and never requires glab.
  expect(guidance()).toHaveTextContent(/credentials Mr. PR holds/i)
  expect(guidance()).toHaveTextContent(/Mr. PR settings/i)
  expect(guidance()).not.toHaveTextContent(/glab/i)
})

test('only names the CLI credential sources on the deployment that has them', () => {
  const cli = renderErrorState(new ApiError(403, 'forbidden'), {
    targetKey: 'proxy',
  })
  expect(guidance()).toHaveTextContent(/which account the CLI signed in as/i)
  expect(guidance()).toHaveTextContent(/GITLAB_TOKEN/)
  expect(guidance()).toHaveTextContent(/otherwise glab/i)
  cli.unmount()

  renderErrorState(new ApiError(403, 'forbidden'), { targetKey: 'h/g/p/42' })
  expect(guidance()).not.toHaveTextContent(/glab/i)
  expect(guidance()).not.toHaveTextContent(/GITLAB_TOKEN/)
})

test('surfaces the unknown outcome of a write the transport refused to retry', () => {
  renderErrorState(
    new ApiError(
      503,
      'Mr. PR lost contact with its background service. Your comment may ' +
        'or may not have been posted; reload to check before retrying.',
      'extension_unavailable',
    ),
  )

  // In the guidance paragraph, not buried in the collapsed technical detail.
  expect(guidance()).toHaveTextContent(/may or may not have been posted/i)
})

test('offers a working retry action', async () => {
  const retry = vi.fn()
  const user = userEvent.setup()
  renderErrorState(new ApiError(429, 'slow down'), { onRetry: retry })

  await user.click(screen.getByRole('button', { name: 'Retry' }))

  expect(retry).toHaveBeenCalledOnce()
})

test('preserves HTTP status and server guidance in API errors', async () => {
  window.location.hash = '#session=test-session'
  server.use(
    http.get('/api/failure', () =>
      HttpResponse.json(
        { code: 'denied', message: 'GitLab says no' },
        { status: 403 },
      ),
    ),
  )

  await expect(api('/api/failure')).rejects.toMatchObject({
    status: 403,
    code: 'denied',
    message: 'GitLab says no',
  })
})
