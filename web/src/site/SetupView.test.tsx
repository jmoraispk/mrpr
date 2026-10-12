import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, expect, test, vi } from 'vitest'

import { installPlatform } from '../platform/platform'
import { createFakePlatform } from '../test/fakePlatform'
import { validateApplicationId } from './applicationId'
import { SetupView } from './SetupView'

const signIn = vi.hoisted(() => vi.fn(async () => {}))
vi.mock('./auth', async (original) => ({ ...(await original<object>()), signIn }))

const SERVER = { host: 'gitlab.other.org', origin: 'https://gitlab.other.org' }
const ID = 'a'.repeat(64)
let fake: ReturnType<typeof createFakePlatform>

beforeEach(() => {
  signIn.mockClear()
  fake = createFakePlatform()
  installPlatform(fake)
})

test('an application id is 64 hex characters, and the Secret is refused', () => {
  expect(validateApplicationId(`  ${ID.toUpperCase()} `)).toEqual({ ok: true, clientId: ID })
  expect(validateApplicationId(`gloas-${'a'.repeat(58)}`)).toEqual({
    ok: false,
    message: "That's the Secret. Copy the Application ID above it.",
  })
  expect(validateApplicationId('abc')).toMatchObject({ ok: false })
})

test('the setup congratulates the first person and shows three steps', () => {
  render(<SetupView server={SERVER} onBack={() => {}} />)

  expect(screen.getByRole('heading', { level: 1 })).toHaveTextContent(
    "Congratulations, you're the first person in your organization to use Mr. PR!",
  )
  expect(
    screen.getByText(
      'To keep Mr. PR 100% private, add it as an application on your own GitLab server. Three steps, under a minute.',
    ),
  ).toBeInTheDocument()
  expect(screen.getAllByRole('listitem')).toHaveLength(3)
  expect(screen.getAllByRole('img')).toHaveLength(3)
  expect(screen.getByRole('link', { name: /Open gitlab\.other\.org applications/ })).toHaveAttribute(
    'href',
    'https://gitlab.other.org/oauth/applications',
  )
  expect(screen.getByText(`${window.location.origin}/app/`)).toBeInTheDocument()
})

test('values can be copied', async () => {
  const user = userEvent.setup()
  const writeText = vi.fn(async () => {})
  Object.defineProperty(navigator, 'clipboard', { value: { writeText }, configurable: true })
  render(<SetupView server={SERVER} onBack={() => {}} />)

  await user.click(screen.getByRole('button', { name: 'Copy Redirect URI' }))

  expect(writeText).toHaveBeenCalledWith(`${window.location.origin}/app/`)
})

test('the Secret is refused', async () => {
  const user = userEvent.setup()
  render(<SetupView server={SERVER} onBack={() => {}} />)

  await user.type(screen.getByLabelText('Application ID'), `gloas-${'a'.repeat(58)}`)
  await user.click(screen.getByRole('button', { name: 'Sign in' }))

  expect(screen.getByRole('alert')).toHaveTextContent("That's the Secret")
  expect(signIn).not.toHaveBeenCalled()
})

test('a pasted id is remembered, then sign-in starts and will publish', async () => {
  const user = userEvent.setup()
  render(<SetupView server={SERVER} replacing={'b'.repeat(64)} onBack={() => {}} />)

  await user.type(screen.getByLabelText('Application ID'), ID)
  await user.click(screen.getByRole('button', { name: 'Sign in' }))

  await expect(fake.store.get('customHosts')).resolves.toEqual({ 'gitlab.other.org': ID })
  expect(signIn).toHaveBeenCalledWith(
    { host: 'gitlab.other.org', clientId: ID },
    expect.any(String),
    'api',
    undefined,
    { publish: { replaces: 'b'.repeat(64) } },
  )
})
