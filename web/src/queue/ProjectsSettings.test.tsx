import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, expect, test } from 'vitest'

import { installPlatform } from '../platform/platform'
import { createFakePlatform } from '../test/fakePlatform'
import { ProjectDialog } from './ProjectDialog'
import { exportProjects } from './projects'
import { ProjectsSettings } from './ProjectsSettings'

let fake: ReturnType<typeof createFakePlatform>
beforeEach(() => {
  fake = createFakePlatform()
  installPlatform(fake)
})

test('a new project takes a name, repositories and labels', async () => {
  const user = userEvent.setup()
  render(<ProjectDialog onClose={() => {}} />)
  await user.type(screen.getByLabelText('Name'), 'Payments')
  await user.type(screen.getByLabelText(/Repositories/), 'g/payments, g/billing')
  await user.type(screen.getByLabelText(/Labels/), 'payments')
  await user.click(screen.getByRole('button', { name: 'Create project' }))
  await waitFor(async () =>
    expect(await fake.store.get('projects')).toMatchObject([
      {
        name: 'Payments',
        rules: { repositories: ['g/payments', 'g/billing'], labels: ['payments'] },
      },
    ]),
  )
})

test('projects can be exported, deleted and imported back', async () => {
  const user = userEvent.setup()
  const projects = [
    {
      id: 'p',
      name: 'SDK',
      color: '#C2410C',
      rules: { repositories: ['g/sdk'], labels: [] },
      pinned: [],
    },
  ]
  await fake.store.set({ projects })
  render(<ProjectsSettings />)

  expect(await screen.findByText('SDK')).toBeInTheDocument()
  expect(screen.getByRole('textbox', { name: 'Projects file' })).toHaveValue(
    exportProjects(projects),
  )
  await user.click(screen.getByRole('button', { name: 'Delete SDK' }))
  await waitFor(async () => expect(await fake.store.get('projects')).toEqual([]))

  const box = screen.getByRole('textbox', { name: 'Projects file' })
  await user.clear(box)
  await user.click(box)
  await user.paste(exportProjects(projects))
  await user.click(screen.getByRole('button', { name: 'Import' }))
  await waitFor(async () => expect(await fake.store.get('projects')).toEqual(projects))
})

test('an import that is not a projects file is refused', async () => {
  const user = userEvent.setup()
  render(<ProjectsSettings />)
  const box = screen.getByRole('textbox', { name: 'Projects file' })
  await user.clear(box)
  await user.click(box)
  await user.paste('{"nope":1}')
  await user.click(screen.getByRole('button', { name: 'Import' }))
  expect(screen.getByRole('alert')).toHaveTextContent('Not a Mr. PR projects file')
})
