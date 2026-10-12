import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { useState } from 'react'
import { beforeEach, expect, test, vi } from 'vitest'

import type { MrOverview, OverviewNote } from '../../gitlab/mrOverview'
import { installPlatform, platform } from '../../platform/platform'
import { createFakePlatform } from '../../test/fakePlatform'
import { TransportProvider } from '../../transport/context'
import type { DeltaTransport } from '../../transport/types'
import { MrOverviewView } from './MrOverview'

const transport = {
  targetKey: 'gitlab.example.com/g/p/1',
  getConfig: vi.fn(),
  getMergeRequest: vi.fn(),
  getDiffs: vi.fn(),
  getDiscussions: vi.fn(async () => []),
  createDiscussion: vi.fn(),
  setResolved: vi.fn(),
  replyToDiscussion: vi.fn(async (_id: string, body: string) => ({
    id: 99,
    body,
    author: { name: 'Joao', username: 'joao' },
  })),
} as unknown as DeltaTransport

const T = { hostId: 'gitlab.example.com', project: 'g/p', iid: 1 }
const person = (username: string, bot = false) => ({
  username,
  name: username.toUpperCase(),
  avatarUrl: null,
  bot,
})
const note = (
  id: number,
  who: string,
  body: string,
  at: string,
  extra: Partial<OverviewNote> = {},
): OverviewNote => ({
  id,
  body,
  system: false,
  icon: null,
  createdAt: at,
  author: person(who),
  position: null,
  ...extra,
})

function overview(over: Partial<MrOverview> = {}): MrOverview {
  return {
    iid: 1,
    title: 'Retry budget',
    description:
      'Adds a **budget**. See [docs](/g/p/-/wikis/retry) and ![shot](/uploads/abc/shot.png)',
    draft: false,
    state: 'opened',
    createdAt: '2026-10-09T10:00:00Z',
    updatedAt: '2026-10-11T11:00:00Z',
    sourceBranch: 'retry-budget',
    targetBranch: 'main',
    webUrl: 'https://gitlab.example.com/g/p/-/merge_requests/1',
    headSha: 'head-2',
    commitCount: 7,
    author: person('ana'),
    reviewers: [
      { username: 'joao', name: 'Joao', avatarUrl: null, state: 'UNREVIEWED' },
      { username: 'li', name: 'Li', avatarUrl: null, state: 'APPROVED' },
    ],
    approvedBy: [{ username: 'li', name: 'Li' }],
    approvalsRequired: 2,
    approvalsLeft: 1,
    pipeline: { status: 'SUCCESS', path: '/g/p/-/pipelines/1' },
    labels: [{ title: 'agents', color: '#6699cc' }],
    additions: 240,
    deletions: 31,
    files: 12,
    shouldBeRebased: false,
    rebaseInProgress: false,
    canPush: true,
    discussions: [
      {
        id: 'open',
        resolvable: true,
        resolved: false,
        notes: [note(1, 'li', 'Should the budget reset?', '2026-10-10T09:00:00Z')],
      },
      {
        id: 'done',
        resolvable: true,
        resolved: true,
        notes: [note(2, 'li', 'Typo', '2026-10-10T09:30:00Z')],
      },
      {
        id: 'c',
        resolvable: false,
        resolved: false,
        notes: [
          note(3, 'ana', 'added 2 commits', '2026-10-11T08:00:00Z', {
            system: true,
            icon: 'commit',
          }),
        ],
      },
      {
        id: 'mine',
        resolvable: true,
        resolved: false,
        notes: [note(4, 'ana', '@joao take another look?', '2026-10-11T10:00:00Z')],
      },
    ],
    ...over,
  }
}

beforeEach(() => {
  installPlatform(createFakePlatform())
  vi.mocked(transport.replyToDiscussion).mockClear()
})

function show(props: Partial<Parameters<typeof MrOverviewView>[0]> = {}) {
  return render(
    <QueryClientProvider client={new QueryClient()}>
      <TransportProvider transport={transport}>
        <MrOverviewView
          overview={overview()}
          target={T}
          me="joao"
          previous={{ headSha: 'head-1', at: '2026-10-11T07:00:00Z' }}
          replyTo={null}
          onReplied={() => {}}
          projectName="Payments"
          projectColor="#1E4FD8"
          {...props}
        />
      </TransportProvider>
    </QueryClientProvider>,
  )
}

test('the description renders as Markdown, with GitLab links made absolute', () => {
  show()
  const description = screen.getByRole('region', { name: 'Description' })
  expect(within(description).getByText('budget').tagName).toBe('STRONG')
  const docs = within(description).getByRole('link', { name: 'docs' })
  expect(docs).toHaveAttribute('href', 'https://gitlab.example.com/g/p/-/wikis/retry')
  expect(docs).toHaveAttribute('target', '_blank')
  expect(within(description).getByRole('img', { name: 'shot' })).toHaveAttribute(
    'src',
    'https://gitlab.example.com/g/p/uploads/abc/shot.png',
  )
})

test('a script in the description never runs or renders', () => {
  show({
    overview: overview({
      description:
        'hi <script>alert(1)</script><img src=x onerror="alert(2)"> [x](javascript:alert(3))',
    }),
  })
  const description = screen.getByRole('region', { name: 'Description' })
  expect(description.querySelector('script')).toBeNull()
  expect(description.querySelector('[onerror]')).toBeNull()
  expect(description.querySelector('a[href^="javascript:"]')).toBeNull()
})

test('activity: default filters, the new divider, your thread outlined, and what is hidden', () => {
  show()
  const activity = screen.getByRole('region', { name: 'Activity' })
  expect(within(activity).getByText('Should the budget reset?')).toBeInTheDocument()
  expect(within(activity).queryByText('Typo')).toBeNull()
  expect(within(activity).getByText('New since last review')).toBeInTheDocument()
  expect(within(activity).getByText(/ANA added 2 commits/)).toBeInTheDocument()
  expect(within(activity).getByText(/mentions you/)).toBeInTheDocument()
  expect(
    within(activity).getByText(/1 hidden by your Show settings: 1 resolved thread/),
  ).toBeInTheDocument()
})

test('Show them reveals hidden items for this view only', async () => {
  const user = userEvent.setup()
  show()
  await user.click(screen.getByRole('button', { name: 'Show them' }))
  expect(screen.getByText(/LI: Typo/)).toBeInTheDocument()
})

test('⚙ Show changes what is shown, for all MRs by default', async () => {
  const user = userEvent.setup()
  show()
  await user.click(screen.getByRole('button', { name: '⚙ Show' }))
  await user.click(screen.getByRole('checkbox', { name: 'New commits' }))
  expect(screen.queryByText(/ANA added 2 commits/)).toBeNull()
  expect(screen.getByRole('radio', { name: 'all MRs' })).toBeChecked()
})

test('choosing this MR keeps a change to this MR only', async () => {
  const user = userEvent.setup()
  show()
  await user.click(screen.getByRole('button', { name: '⚙ Show' }))
  await user.click(screen.getByRole('radio', { name: 'this MR' }))
  await user.click(screen.getByRole('checkbox', { name: 'New commits' }))
  await waitFor(async () =>
    expect(await platform().store.get('activityFilters')).toMatchObject({
      defaults: { commits: true },
      perMr: { 'gitlab.example.com:g/p!1': { commits: false } },
    }),
  )
})

test('the details column: reviewers, approvals, pipeline, labels, project, commits', () => {
  show()
  const rail = screen.getByRole('complementary', { name: 'Details' })
  expect(within(rail).getByText('Li', { selector: '.mr-who span' })).toBeInTheDocument()
  expect(within(rail).getByText('approved')).toBeInTheDocument()
  expect(within(rail).getByText('1 of 2')).toBeInTheDocument()
  expect(within(rail).getByRole('link', { name: 'passed' })).toHaveAttribute(
    'href',
    'https://gitlab.example.com/g/p/-/pipelines/1',
  )
  expect(within(rail).getByText('agents')).toBeInTheDocument()
  expect(within(rail).getByText('Payments')).toBeInTheDocument()
  expect(within(rail).getByText('7')).toBeInTheDocument()
})

test('reply reveals a thread hidden by the Show settings and focuses its reply box', async () => {
  show({ replyTo: 'done' })
  await waitFor(() => {
    const box = document.querySelector<HTMLTextAreaElement>(
      '[data-discussion-id="done"] textarea',
    )
    expect(box).not.toBeNull()
    expect(box).toHaveFocus()
  })
})

test('an inline thread links to its line in Changes; a shown resolved thread is one line until opened', async () => {
  const user = userEvent.setup()
  show({
    overview: overview({
      discussions: [
        {
          id: 'inl',
          resolvable: true,
          resolved: false,
          notes: [
            note(7, 'li', 'Off by one?', '2026-10-10T09:00:00Z', {
              position: { filePath: 'src/retry.py', newLine: 42, oldLine: null },
            }),
          ],
        },
        {
          id: 'done',
          resolvable: true,
          resolved: true,
          notes: [note(2, 'li', 'Typo', '2026-10-10T09:30:00Z')],
        },
      ],
    }),
  })
  expect(screen.getByRole('link', { name: 'src/retry.py · line 42' })).toHaveAttribute(
    'href',
    '#/mr/gitlab.example.com/g%2Fp/1/note/7/changes',
  )
  await user.click(screen.getByRole('button', { name: 'Show them' }))
  const summary = screen.getByText(/LI: Typo/)
  expect(summary.closest('details')).not.toHaveAttribute('open')
})

test('replying in a thread posts through the review op', async () => {
  const user = userEvent.setup()
  show()
  const thread = screen
    .getByText('Should the budget reset?')
    .closest('[data-discussion-id]') as HTMLElement
  await user.type(within(thread).getByRole('textbox', { name: 'Reply' }), 'On success only')
  await user.click(within(thread).getByRole('button', { name: 'Reply' }))
  expect(transport.replyToDiscussion).toHaveBeenCalledWith('open', 'On success only')
})

test('opening at a note brings its thread into view and marks it', () => {
  show({ focusNoteId: 1 })
  expect(
    document.querySelector('.mr-thread.is-focused [data-discussion-id="open"]'),
  ).not.toBeNull()
  expect(document.querySelectorAll('.mr-thread.is-focused')).toHaveLength(1)
})

/** Like the queue: the reply request is cleared once the Overview has used it. */
function StatefulReply({ start }: { start: string }) {
  const [replyTo, setReplyTo] = useState<string | null>(start)
  return (
    <MrOverviewView
      overview={OVERVIEW_ONCE}
      target={T}
      me="joao"
      previous={null}
      replyTo={replyTo}
      onReplied={() => setReplyTo(null)}
      projectName={null}
      projectColor={null}
    />
  )
}
const OVERVIEW_ONCE = overview()

test('a thread revealed for a reply stays shown, open and focused after the request is used', async () => {
  render(
    <QueryClientProvider client={new QueryClient()}>
      <TransportProvider transport={transport}>
        <StatefulReply start="done" />
      </TransportProvider>
    </QueryClientProvider>,
  )
  await waitFor(() =>
    expect(
      document.querySelector('[data-discussion-id="done"] textarea'),
    ).toHaveFocus(),
  )
  // Settle any re-render from clearing the request.
  await new Promise((resolve) => setTimeout(resolve, 20))
  expect(document.querySelector('[data-discussion-id="done"] textarea')).toHaveFocus()
  expect(screen.queryByText(/1 hidden by your Show settings/)).toBeNull()
})

test('a reply posted in Overview survives the page re-rendering', async () => {
  const user = userEvent.setup()
  const view = show({ overview: OVERVIEW_ONCE })
  const thread = screen
    .getByText('Should the budget reset?')
    .closest('[data-discussion-id]') as HTMLElement
  await user.type(within(thread).getByRole('textbox', { name: 'Reply' }), 'On success only')
  await user.click(within(thread).getByRole('button', { name: 'Reply' }))
  expect(await within(thread).findByText('On success only')).toBeInTheDocument()
  // Anything that re-renders the page, e.g. opening ⚙ Show.
  await user.click(screen.getByRole('button', { name: '⚙ Show' }))
  view.rerender(
    <QueryClientProvider client={new QueryClient()}>
      <TransportProvider transport={transport}>
        <MrOverviewView overview={OVERVIEW_ONCE} target={T} me="joao" previous={null}
          replyTo={null} onReplied={() => {}} projectName={null} projectColor={null} />
      </TransportProvider>
    </QueryClientProvider>,
  )
  expect(screen.getByText('On success only')).toBeInTheDocument()
})
