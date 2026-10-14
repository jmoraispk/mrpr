import { act, fireEvent, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, expect, test, vi } from 'vitest'

import { installPlatform, platform } from '../platform/platform'
import { createFakePlatform } from '../test/fakePlatform'
import { AUTH_KEY, POPUP_PENDING_KEY } from './auth'
import { pendingWriteAccess, requestWriteAccess, settleWriteAccess } from './writeAccess'
import { WriteAccessGate } from './WriteAccessGate'

const SITE = { host: 'gl.test', clientId: 'client-1' }
const CONFIG = { hosts: [SITE], scopes: 'read_api' }
const readOnly = { accessToken: 'a', refreshToken: 'r', expiresAt: Date.now() + 3_600_000, scopes: ['read_api'] }

beforeEach(async () => {
  for (const host of pendingWriteAccess()) settleWriteAccess(host, false)
  localStorage.clear()
  installPlatform(createFakePlatform())
  await platform().store.set({ [AUTH_KEY]: { [SITE.host]: readOnly } })
})

const fakeWindow = () => ({ closed: false, location: { href: '' } }) as unknown as Window

test('nothing shows until a write asks', () => {
  render(<WriteAccessGate config={CONFIG} openWindow={fakeWindow} />)
  expect(screen.queryByRole('dialog')).toBeNull()
})

test('Allow opens GitLab in a window, and the write goes on once posting is granted', async () => {
  const user = userEvent.setup()
  const popup = fakeWindow()
  const openWindow = vi.fn(() => popup)
  render(<WriteAccessGate config={CONFIG} openWindow={openWindow} />)
  let done = false
  act(() => {
    void requestWriteAccess(SITE.host).then(() => {
      done = true
    })
  })
  const dialog = await screen.findByRole('dialog', { name: 'Allow posting' })
  expect(dialog).toHaveTextContent('GitLab needs your OK before Mr. PR can post as you on gl.test.')
  await user.click(screen.getByRole('button', { name: 'Allow' }))
  expect(openWindow).toHaveBeenCalledOnce()
  await waitFor(() => expect(popup.location.href).toContain('scope=api'))
  expect(localStorage.getItem(POPUP_PENDING_KEY)).not.toBeNull()
  // The window's sign-in finishes and stores a token that may post.
  await act(() => platform().store.set({ [AUTH_KEY]: { [SITE.host]: { ...readOnly, scopes: ['api'] } } }))
  await waitFor(() => expect(done).toBe(true))
  await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull())
})

test('Not now refuses the write', async () => {
  const user = userEvent.setup()
  render(<WriteAccessGate config={CONFIG} openWindow={fakeWindow} />)
  let refused: unknown = null
  act(() => {
    requestWriteAccess(SITE.host).catch((error) => {
      refused = error
    })
  })
  await user.click(await screen.findByRole('button', { name: 'Not now' }))
  await waitFor(() => expect(refused).toMatchObject({ code: 'write_access_denied' }))
})

test('a window closed without posting rights refuses the write', async () => {
  vi.useFakeTimers({ shouldAdvanceTime: true })
  const popup = fakeWindow()
  render(<WriteAccessGate config={CONFIG} openWindow={() => popup} />)
  let refused: unknown = null
  act(() => {
    requestWriteAccess(SITE.host).catch((error) => {
      refused = error
    })
  })
  fireEvent.click(await screen.findByRole('button', { name: 'Allow' }))
  ;(popup as { closed: boolean }).closed = true
  await act(() => vi.advanceTimersByTimeAsync(600))
  await waitFor(() => expect(refused).toMatchObject({ code: 'write_access_denied' }))
  vi.useRealTimers()
})

test('a blocked window explains itself and offers another way', async () => {
  const user = userEvent.setup()
  render(<WriteAccessGate config={CONFIG} openWindow={() => null} />)
  act(() => {
    requestWriteAccess(SITE.host).catch(() => {})
  })
  await user.click(await screen.findByRole('button', { name: 'Allow' }))
  expect(screen.getByRole('dialog')).toHaveTextContent('Your browser blocked the GitLab window.')
  expect(screen.getByRole('button', { name: 'Try again' })).toBeInTheDocument()
  expect(screen.getByRole('button', { name: 'Sign in again' })).toBeInTheDocument()
})

test('Escape counts as Not now', async () => {
  render(<WriteAccessGate config={CONFIG} openWindow={fakeWindow} />)
  let refused: unknown = null
  act(() => {
    requestWriteAccess(SITE.host).catch((error) => {
      refused = error
    })
  })
  const dialog = await screen.findByRole('dialog')
  fireEvent(dialog, new Event('cancel', { cancelable: true }))
  await waitFor(() => expect(refused).toMatchObject({ code: 'write_access_denied' }))
})
