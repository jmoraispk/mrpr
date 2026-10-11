import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { expect, test, vi } from 'vitest'

import { ApiError } from '../api/client'
import { installPlatform } from '../platform/platform'
import { ErrorState } from '../review/ErrorState'
import { TransportProvider } from '../transport/context'
import { createHttpTransport } from '../transport/http'
import { createFakePlatform } from './fakePlatform'

for (const code of ['signed_out', 'gitlab_authentication_failed']) {
  test(`on the site, ${code} in a review offers to sign in again`, async () => {
    const user = userEvent.setup()
    const reauthenticate = vi.fn(async () => {})
    installPlatform(createFakePlatform({ reauthenticate }))
    render(
      <TransportProvider transport={{ ...createHttpTransport(), targetKey: 'h/g/p/1' }}>
        <ErrorState error={new ApiError(401, 'Sign in again.', code)} onRetry={() => {}} />
      </TransportProvider>,
    )

    expect(screen.getByRole('heading')).toHaveTextContent('Your GitLab sign-in has ended')
    expect(screen.queryByText(/Relaunch Mr. PR from the CLI/)).toBeNull()
    await user.click(screen.getByRole('button', { name: 'Sign in again' }))

    expect(reauthenticate).toHaveBeenCalledOnce()
  })
}
