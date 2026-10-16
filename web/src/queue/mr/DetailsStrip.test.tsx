import { render, screen, within } from '@testing-library/react'
import { expect, test } from 'vitest'

import type { MrOverview } from '../../gitlab/mrOverview'
import { DetailsStrip } from './DetailsStrip'

const OVERVIEW = {
  updatedAt: '2026-10-11T09:00:00Z',
  commitCount: 7,
  reviewers: [
    { username: 'li', name: 'Li', avatarUrl: null, state: 'APPROVED' },
    { username: 'joao', name: 'Joao', avatarUrl: null, state: 'UNREVIEWED' },
  ],
  approvedBy: [{ username: 'li', name: 'Li' }],
  approvalsRequired: 2,
  approvalsLeft: 1,
  pipeline: { status: 'SUCCESS', path: '/g/p/-/pipelines/1' },
  labels: [{ title: 'agents', color: '#336699' }],
} as unknown as MrOverview

test('the strip: reviewers with their state, approvals, a linked pipeline, commits, labels', () => {
  render(<DetailsStrip overview={OVERVIEW} host="gitlab.example.com" me="joao" />)
  const strip = screen.getByRole('list', { name: 'Details' })
  expect(within(strip).getByText('Li')).toBeInTheDocument()
  expect(within(strip).getByText('You')).toBeInTheDocument()
  expect(within(strip).getByText('approved')).toBeInTheDocument()
  expect(strip).toHaveTextContent(/Approvals\s*1 of 2/)
  expect(within(strip).getByRole('link', { name: 'passed' })).toHaveAttribute(
    'href',
    'https://gitlab.example.com/g/p/-/pipelines/1',
  )
  expect(within(strip).getByText('agents')).toBeInTheDocument()
  expect(strip).toHaveTextContent('7 commits')
})

test('the strip uses short times', () => {
  render(<DetailsStrip overview={OVERVIEW} host="gitlab.example.com" me="joao" />)
  const strip = screen.getByRole('list', { name: 'Details' })
  expect(strip.textContent).not.toMatch(/ago|just now/)
  expect(strip.querySelector('time')).not.toBeNull()
})

test('no reviewers says none; no pipeline shows no pipeline item', () => {
  render(
    <DetailsStrip
      overview={{ ...OVERVIEW, reviewers: [], pipeline: null, labels: [] } as MrOverview}
      host="h"
      me="joao"
    />,
  )
  const strip = screen.getByRole('list', { name: 'Details' })
  expect(strip).toHaveTextContent(/Reviewers\s*none/)
  expect(strip).not.toHaveTextContent('Pipeline')
})
