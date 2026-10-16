import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { expect, test, vi } from 'vitest'

import { ApiError } from '../api/client'
import { ErrorState } from '../review/ErrorState'

function renderErrorState(error: Error, { onRetry = () => undefined } = {}) {
  return render(<ErrorState error={error} onRetry={onRetry} />)
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

test('tells the user to renew the credentials Mr. PR holds', () => {
  renderErrorState(
    new ApiError(401, 'unauthorized', 'gitlab_authentication_failed'),
  )

  // Mr. PR holds the GitLab token itself; glab is not in the picture.
  expect(guidance()).toHaveTextContent(/credentials Mr. PR holds/i)
  expect(guidance()).toHaveTextContent(/Mr. PR settings/i)
  expect(guidance()).not.toHaveTextContent(/glab/i)
  expect(guidance()).not.toHaveTextContent(/GITLAB_TOKEN/)
})

test('never sends anyone to a CLI that no longer exists', () => {
  renderErrorState(new ApiError(403, 'forbidden'))

  expect(guidance()).toHaveTextContent(/project access/i)
  expect(guidance()).not.toHaveTextContent(/glab/i)
  expect(guidance()).not.toHaveTextContent(/GITLAB_TOKEN/)
  expect(guidance()).not.toHaveTextContent(/CLI/)
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
