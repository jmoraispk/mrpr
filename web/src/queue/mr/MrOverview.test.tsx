import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { act, render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { useState } from 'react'
import { beforeEach, expect, test, vi } from 'vitest'

import type { MrOverview, OverviewNote } from '../../gitlab/mrOverview'
import { installPlatform, platform } from '../../platform/platform'
import { createFakePlatform } from '../../test/fakePlatform'
import { TransportProvider } from '../../transport/context'
import type { DeltaTransport } from '../../transport/types'
import { liveBox, typeRich } from '../../test/richReply'
import { QUEUE_QUERY_KEY } from '../useQueue'
import { MrOverviewView } from './MrOverview'

const transport = {
  targetKey: 'gitlab.example.com/g/p/1',
  getConfig: vi.fn(),
  getMergeRequest: vi.fn(),
  getDiffs: vi.fn(),
  getDiscussions: vi.fn(async () => []),
  getDiffsBetween: vi.fn(async () => [
    {
      old_path: 'src/retry.py',
      new_path: 'src/retry.py',
      diff: [
        '@@ -10,6 +10,7 @@ def retry():',
        ' a = 1',
        ' b = 2',
        '-c = 3',
        '+c = 4',
        '+d = 5',
        ' e = 6',
      ].join('\n'),
      new_file: false,
      renamed_file: false,
      deleted_file: false,
      collapsed: false,
      too_large: false,
    },
  ]),
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
    within(activity).getByText(/1 hidden by your Filters: 1 resolved thread/),
  ).toBeInTheDocument()
})

test('Show them reveals hidden items for this view only', async () => {
  const user = userEvent.setup()
  show()
  await user.click(screen.getByRole('button', { name: 'Show them' }))
  expect(screen.getByText(/LI: Typo/)).toBeInTheDocument()
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

test('reply reveals a thread hidden by the Filters and focuses its reply box', async () => {
  show({ replyTo: 'done' })
  await waitFor(() => {
    const box = document.querySelector<HTMLElement>('[data-discussion-id="done"] .rich-reply-input')
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
              position: { filePath: 'src/retry.py', newLine: 42, oldLine: null, baseSha: null, headSha: null },
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
  await typeRich(within(thread).getByRole('textbox', { name: 'Reply' }), 'On success only')
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
    expect(document.querySelector('[data-discussion-id="done"] .rich-reply-input')).toHaveFocus(),
  )
  // Settle any re-render from clearing the request.
  await new Promise((resolve) => setTimeout(resolve, 20))
  expect(document.querySelector('[data-discussion-id="done"] .rich-reply-input')).toHaveFocus()
  expect(screen.queryByText(/1 hidden by your Filters/)).toBeNull()
})

test('a reply posted in Overview survives the page re-rendering', async () => {
  const user = userEvent.setup()
  const view = show({ overview: OVERVIEW_ONCE })
  const thread = screen
    .getByText('Should the budget reset?')
    .closest('[data-discussion-id]') as HTMLElement
  await typeRich(within(thread).getByRole('textbox', { name: 'Reply' }), 'On success only')
  await user.click(within(thread).getByRole('button', { name: 'Reply' }))
  expect(await within(thread).findByText('On success only')).toBeInTheDocument()
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

test('the MR page has no ⚙ Show: what Activity shows is set under Filters in the sidebar', () => {
  show()
  expect(screen.queryByRole('button', { name: /Show$/ })).toBeNull()
})

test('Activity threads read like a chat: the opener on the left, everyone else on the right', () => {
  show({
    overview: overview({
      discussions: [
        {
          id: 'chat',
          resolvable: true,
          resolved: false,
          notes: [
            note(301, 'li', 'Why does this retry forever?', '2026-10-11T08:00:00Z'),
            note(302, 'joao', 'It stops after the budget.', '2026-10-11T08:30:00Z'),
            note(303, 'li', 'Then say so in the docstring.', '2026-10-11T09:00:00Z'),
          ],
        },
      ],
    }),
  })
  const thread = document.querySelector('[data-discussion-id="chat"]') as HTMLElement
  expect(thread).toHaveClass('is-chat')
  const sides = [...thread.querySelectorAll('.chat-note')].map((el) =>
    el.classList.contains('is-reply') ? 'right' : 'left',
  )
  expect(sides).toEqual(['left', 'right', 'left'])
  const names = [...thread.querySelectorAll('.chat-meta strong')].map((el) => el.textContent)
  expect(names).toEqual(['LI', 'JOAO', 'LI'])
  expect(thread.querySelector('.chat-meta time')).toHaveAttribute('dateTime', '2026-10-11T08:00:00Z')
  // Reply and Resolve stay below the bubbles.
  expect(within(thread).getByRole('textbox', { name: 'Reply' })).toBeInTheDocument()
})

test('the details column and Activity events use short times', () => {
  show()
  const rail = screen.getByRole('complementary', { name: 'Details' })
  expect(rail.textContent).not.toMatch(/ago|just now/)
  expect(within(rail).getByText(/^updated/).querySelector('time')).not.toBeNull()
  const events = [...document.querySelectorAll('.mr-event')]
  expect(events.length).toBeGreaterThan(0)
  for (const event of events) {
    expect(event.textContent).not.toMatch(/ago|just now/)
    expect(event.querySelector('time')?.getAttribute('title')).toBeTruthy()
  }
})

test('a reply reads the list again at once, and does not read the whole MR again', async () => {
  const user = userEvent.setup()
  const client = new QueryClient()
  const invalidate = vi.spyOn(client, 'invalidateQueries')
  render(
    <QueryClientProvider client={client}>
      <TransportProvider transport={transport}>
        <MrOverviewView overview={OVERVIEW_ONCE} target={T} me="joao" previous={null}
          replyTo={null} onReplied={() => {}} projectName={null} projectColor={null} />
      </TransportProvider>
    </QueryClientProvider>,
  )
  const thread = screen.getByText('Should the budget reset?').closest('[data-discussion-id]') as HTMLElement
  await typeRich(within(thread).getByRole('textbox', { name: 'Reply' }), 'Only on success')
  await user.click(within(thread).getByRole('button', { name: 'Reply' }))
  expect(await within(thread).findByText('Only on success')).toBeInTheDocument()
  await waitFor(() => expect(invalidate).toHaveBeenCalledWith({ queryKey: QUEUE_QUERY_KEY }))
  expect(invalidate).not.toHaveBeenCalledWith({ queryKey: ['overview'] })
})

test('an inline thread shows the code it was made on, the commented line marked', async () => {
  show({
    overview: overview({
      discussions: [
        {
          id: 'inline',
          resolvable: true,
          resolved: false,
          notes: [
            note(401, 'li', 'Why 5?', '2026-10-11T08:00:00Z', {
              position: { filePath: 'src/retry.py', newLine: 13, oldLine: null, baseSha: 'b1', headSha: 'h1' },
            }),
          ],
        },
      ],
    }),
  })
  const thread = document.querySelector('[data-discussion-id="inline"]')!.closest('.mr-thread') as HTMLElement
  const code = await within(thread).findByRole('figure', { name: 'src/retry.py, line 13' })
  expect(code).toHaveTextContent('d = 5')
  expect(code.querySelector('.is-target')).toHaveTextContent('d = 5')
  expect(transport.getDiffsBetween).toHaveBeenCalledWith('b1', 'h1')
})

test('an inline thread whose line is gone keeps just its link', async () => {
  show({
    overview: overview({
      discussions: [
        {
          id: 'old',
          resolvable: true,
          resolved: false,
          notes: [
            note(402, 'li', 'Old one', '2026-10-11T08:00:00Z', {
              position: { filePath: 'src/retry.py', newLine: 99, oldLine: null, baseSha: 'b1', headSha: 'h1' },
            }),
          ],
        },
      ],
    }),
  })
  const thread = document.querySelector('[data-discussion-id="old"]')!.closest('.mr-thread') as HTMLElement
  await waitFor(() => expect(transport.getDiffsBetween).toHaveBeenCalled())
  expect(within(thread).queryByRole('figure')).toBeNull()
  expect(within(thread).getByRole('link', { name: /src\/retry\.py · line 99/ })).toBeInTheDocument()
})

test('coming back to Overview re-reads the MR if a reply marked it stale', () => {
  const client = new QueryClient()
  const refetch = vi.spyOn(client, 'refetchQueries')
  render(
    <QueryClientProvider client={client}>
      <TransportProvider transport={transport}>
        <MrOverviewView overview={OVERVIEW_ONCE} target={T} me="joao" previous={null}
          replyTo={null} onReplied={() => {}} projectName={null} projectColor={null} />
      </TransportProvider>
    </QueryClientProvider>,
  )
  expect(refetch).toHaveBeenCalledWith({ queryKey: ['overview', 'gitlab.example.com/g/p/1'], stale: true })
})

test('a resolved inline thread folded to one line shows no code and asks for none', async () => {
  await platform().store.set({ activityFilters: { defaults: { unresolved: true, resolved: true, commits: true, bots: false, other: false }, perMr: {} } })
  ;(transport.getDiffsBetween as ReturnType<typeof vi.fn>).mockClear()
  show({
    overview: overview({
      discussions: [
        {
          id: 'done', resolvable: true, resolved: true,
          notes: [
            note(403, 'li', 'Fixed now', '2026-10-11T08:00:00Z', {
              position: { filePath: 'src/retry.py', newLine: 13, oldLine: null, baseSha: 'b1', headSha: 'h1' },
            }),
          ],
        },
      ],
    }),
  })
  await screen.findByText(/LI: Fixed now/)
  expect(document.querySelector('.mr-snippet')).toBeNull()
  expect(transport.getDiffsBetween).not.toHaveBeenCalled()
})

test('asking to reply again focuses a reply box that is already open', async () => {
  function AskAgain() {
    const [replyTo, setReplyTo] = useState<string | null>('done')
    return (
      <>
        <button type="button" onClick={() => setReplyTo('done')}>
          ask
        </button>
        <MrOverviewView overview={OVERVIEW_ONCE} target={T} me="joao" previous={null}
          replyTo={replyTo} onReplied={() => setReplyTo(null)} projectName={null} projectColor={null} />
      </>
    )
  }
  render(
    <QueryClientProvider client={new QueryClient()}>
      <TransportProvider transport={transport}>
        <AskAgain />
      </TransportProvider>
    </QueryClientProvider>,
  )
  const input = await liveBox('Reply')
  await waitFor(() => expect(input).toHaveFocus())
  act(() => input.blur())
  expect(input).not.toHaveFocus()
  await userEvent.setup().click(screen.getByRole('button', { name: 'ask' }))
  await waitFor(() => expect(input).toHaveFocus())
})
