import { expect, test, vi } from 'vitest'

import { AuthError } from './auth'
import { finishSignInIfReturning } from './returning'

const CONFIG = { hosts: [], scopes: 'read_api' }
const page = (postingWindow = false) => ({ postingWindow, close: vi.fn(), replaceState: vi.fn() })
const url = (query: string) => new URL(`https://mrpr.test/app/?${query}`)

test('nothing to finish without a code or an error', async () => {
  const p = page()
  const complete = vi.fn()
  expect(await finishSignInIfReturning(url(''), CONFIG, p, complete)).toEqual({ notice: null, closing: false })
  expect(complete).not.toHaveBeenCalled()
})

test('a sign-in comes back to where it started', async () => {
  const p = page()
  const result = await finishSignInIfReturning(url('code=c&state=s'), CONFIG, p, async () => ({ returnTo: '#/mr/x' }))
  expect(result).toEqual({ notice: null, closing: false })
  expect(p.replaceState).toHaveBeenLastCalledWith('/app/#/mr/x')
})

test('a posting window closes once done, and renders nothing', async () => {
  const p = page(true)
  const result = await finishSignInIfReturning(url('code=c&state=s'), CONFIG, p, async () => ({ returnTo: '#/', popup: true as const }))
  expect(result).toEqual({ notice: null, closing: true })
  expect(p.close).toHaveBeenCalledOnce()
})

test('a posting window whose sign-in failed closes too', async () => {
  const p = page(true)
  const result = await finishSignInIfReturning(url('error=access_denied&state=s'), CONFIG, p, async () => {
    throw new AuthError('cancelled', 'Sign-in was cancelled on GitLab.')
  })
  expect(result).toEqual({ notice: null, closing: true })
  expect(p.close).toHaveBeenCalledOnce()
})

test('a failed sign-in in the page itself says why', async () => {
  const result = await finishSignInIfReturning(url('error=x&state=s'), CONFIG, page(), async () => {
    throw new AuthError('cancelled', 'Sign-in was cancelled on GitLab.')
  })
  expect(result).toEqual({ notice: 'Sign-in was cancelled on GitLab.', closing: false })
})

test('a sign-in restarted for full access renders nothing on its way out', async () => {
  const result = await finishSignInIfReturning(url('error=invalid_scope&state=s'), CONFIG, page(), async () => ({
    returnTo: '#/',
    restarted: true as const,
  }))
  expect(result).toEqual({ notice: null, closing: true })
})
