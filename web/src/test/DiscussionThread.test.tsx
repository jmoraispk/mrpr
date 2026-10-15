import {
  QueryClient,
  QueryClientProvider,
  useQuery,
} from '@tanstack/react-query'
import { act, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { http, HttpResponse } from 'msw'
import { beforeEach, expect, test } from 'vitest'

import App from '../App'
import type { Discussion, PostingResult } from '../api/types'
import { CommentComposer } from '../review/CommentComposer'
import { DiscussionThread } from '../review/DiscussionThread'
import {
  discussionsQueryKey,
  pendingDiscussionsQueryKey,
} from '../review/discussionCache'
import type { BackendSelection } from '../review/selection'
import { TransportProvider } from '../transport/context'
import { createHttpTransport } from '../transport/http'
import { TestProviders } from './fixtures'
import { richEditor, typeRich } from './richReply'
import { server } from './server'

const transport = createHttpTransport()

const discussion: Discussion = {
  id: 'discussion-1',
  notes: [
    {
      id: 1,
      body: 'Could this name be clearer?',
      author: { name: 'Ada Lovelace', username: 'ada' },
      resolvable: true,
      resolved: false,
      position: {
        old_path: 'src/parser.py',
        new_path: 'src/parser.py',
        old_line: null,
        new_line: 12,
      },
    },
  ],
}

const selection: BackendSelection = {
  old_path: 'src/parser.py',
  new_path: 'src/parser.py',
  start_old: null,
  start_new: 12,
  end_old: null,
  end_new: 12,
}

beforeEach(() => {
  window.location.hash = '#session=test-session'
})

function DiscussionCacheObserver() {
  useQuery({
    queryKey: discussionsQueryKey('proxy'),
    queryFn: async () => {
      const response = await fetch('/api/discussions')
      return response.json() as Promise<Discussion[]>
    },
    staleTime: Infinity,
  })
  return null
}

test('replies and resolves a discussion', async () => {
  server.use(
    http.post('/api/discussions/discussion-1/notes', async ({ request }) => {
      const body = (await request.json()) as { body: string }
      return HttpResponse.json(
        {
          id: 2,
          body: body.body,
          author: { name: 'You', username: 'you' },
        },
        { status: 201 },
      )
    }),
    http.put('/api/discussions/discussion-1', () =>
      HttpResponse.json({ ...discussion, resolved: true }),
    ),
  )
  const user = userEvent.setup()
  render(<DiscussionThread discussion={discussion} />, {
    wrapper: TestProviders,
  })

  await typeRich(screen.getByRole('textbox', { name: 'Reply' }), 'Fixed now.')
  await user.click(screen.getByRole('button', { name: 'Reply' }))
  expect(await screen.findByText('Fixed now.')).toBeVisible()

  await user.click(screen.getByRole('button', { name: 'Resolve' }))
  expect(await screen.findByText('Resolved')).toBeVisible()
})

test('renders GitLab-flavored Markdown without exposing HTML comments', () => {
  render(
    <DiscussionThread
      discussion={{
        ...discussion,
        notes: [
          {
            ...discussion.notes[0],
            body: [
              '<!-- internal metadata -->',
              '**Important change**',
              '',
              '| File | Change |',
              '| --- | --- |',
              '| parser.py | Handles errors |',
            ].join('\n'),
          },
        ],
      }}
    />,
    { wrapper: TestProviders },
  )

  expect(screen.getByText('Important change').tagName).toBe('STRONG')
  expect(screen.getByRole('table')).toBeVisible()
  expect(screen.queryByText(/internal metadata/)).not.toBeInTheDocument()
})

test('renders a reviewer mark for every automated note', () => {
  render(
    <DiscussionThread
      discussion={{
        ...discussion,
        notes: [
          {
            ...discussion.notes[0],
            author: { name: 'CodeRabbit', username: 'opaque-coderabbit' },
          },
          {
            id: 2,
            body: 'Please also update the test.',
            author: { name: 'Greptile', username: 'opaque-greptile' },
          },
        ],
      }}
    />,
    { wrapper: TestProviders },
  )

  expect(screen.getByAltText('CodeRabbit')).toBeVisible()
  expect(screen.getByAltText('Greptile')).toBeVisible()
  expect(screen.getByText('Greptile')).toBeVisible()
})

test('keeps the POSTed discussion in the cache without refetching', async () => {
  const existing: Discussion = { id: 'existing', notes: [] }
  const posted: Discussion = { id: 'posted', notes: [] }
  let discussionGetCount = 0
  server.use(
    http.get('/api/discussions', () => {
      discussionGetCount += 1
      return HttpResponse.json([])
    }),
    http.post('/api/discussions', () =>
      HttpResponse.json(
        {
          placement: 'inline',
          fallback: 'none',
          discussion: posted,
        },
        { status: 201 },
      ),
    ),
  )
  const user = userEvent.setup()
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  })
  queryClient.setQueryData<Discussion[]>(discussionsQueryKey('proxy'), [
    existing,
  ])
  render(
    <QueryClientProvider client={queryClient}>
      <TransportProvider transport={transport}>
        <DiscussionCacheObserver />
        <CommentComposer selection={selection} />
      </TransportProvider>
    </QueryClientProvider>,
  )

  await user.type(
    screen.getByLabelText('Comment'),
    'Please rename this.',
  )
  await user.click(screen.getByRole('button', { name: 'Comment' }))
  await waitFor(() =>
    expect(
      queryClient.getQueryData<Discussion[]>(discussionsQueryKey('proxy')),
    ).toEqual([existing, posted]),
  )

  expect(discussionGetCount).toBe(0)
})

test('replaces an equal-ID discussion with the authoritative POST result', async () => {
  const stale: Discussion = { id: 'discussion-1', notes: [] }
  const posted: Discussion = {
    id: 'discussion-1',
    notes: [{ id: 2, body: 'Fresh result' }],
  }
  server.use(
    http.post('/api/discussions', () =>
      HttpResponse.json(
        {
          placement: 'inline',
          fallback: 'none',
          discussion: posted,
        } satisfies PostingResult,
        { status: 201 },
      ),
    ),
  )
  const user = userEvent.setup()
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  })
  queryClient.setQueryData<Discussion[]>(discussionsQueryKey('proxy'), [
    stale,
  ])
  render(
    <QueryClientProvider client={queryClient}>
      <TransportProvider transport={transport}>
        <CommentComposer selection={selection} />
      </TransportProvider>
    </QueryClientProvider>,
  )

  await user.type(screen.getByLabelText('Comment'), 'Fresh result')
  await user.click(screen.getByRole('button', { name: 'Comment' }))

  await waitFor(() =>
    expect(
      queryClient.getQueryData<Discussion[]>(discussionsQueryKey('proxy')),
    ).toEqual([posted]),
  )
})

test('merges a delayed startup fetch with a successfully POSTed discussion', async () => {
  const existing: Discussion = { id: 'existing', notes: [] }
  const posted: Discussion = { id: 'posted', notes: [] }
  let startGet!: () => void
  let resolveGet!: (value: Discussion[]) => void
  const getStarted = new Promise<void>((resolve) => {
    startGet = resolve
  })
  const delayedGet = new Promise<Discussion[]>((resolve) => {
    resolveGet = resolve
  })
  server.use(
    http.get('/api/discussions', async () => {
      startGet()
      return HttpResponse.json(await delayedGet)
    }),
    http.post('/api/discussions', () =>
      HttpResponse.json(
        {
          placement: 'inline',
          fallback: 'none',
          discussion: posted,
        } satisfies PostingResult,
        { status: 201 },
      ),
    ),
  )
  const user = userEvent.setup()
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  })
  render(
    <QueryClientProvider client={queryClient}>
      <TransportProvider transport={transport}>
        <App />
        <CommentComposer selection={selection} />
      </TransportProvider>
    </QueryClientProvider>,
  )

  await getStarted
  await user.type(screen.getByLabelText('Comment'), 'Keep this comment.')
  await user.click(screen.getByRole('button', { name: 'Comment' }))
  await waitFor(() =>
    expect(
      queryClient.getQueryData<Discussion[]>(discussionsQueryKey('proxy')),
    ).toEqual([posted]),
  )

  resolveGet([existing])
  await waitFor(() =>
    expect(
      queryClient.getQueryData<Discussion[]>(discussionsQueryKey('proxy')),
    ).toEqual([existing, posted]),
  )
})

test('allows a delayed startup fetch to finish when the POST fails', async () => {
  const existing: Discussion = { id: 'existing', notes: [] }
  let startGet!: () => void
  let resolveGet!: (value: Discussion[]) => void
  const getStarted = new Promise<void>((resolve) => {
    startGet = resolve
  })
  const delayedGet = new Promise<Discussion[]>((resolve) => {
    resolveGet = resolve
  })
  server.use(
    http.get('/api/discussions', async () => {
      startGet()
      return HttpResponse.json(await delayedGet)
    }),
    http.post('/api/discussions', () =>
      HttpResponse.json(
        { detail: 'GitLab rejected the comment' },
        { status: 502 },
      ),
    ),
  )
  const user = userEvent.setup()
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  })
  render(
    <QueryClientProvider client={queryClient}>
      <TransportProvider transport={transport}>
        <App />
        <CommentComposer selection={selection} />
      </TransportProvider>
    </QueryClientProvider>,
  )

  await getStarted
  const editor = screen.getByLabelText('Comment')
  await user.type(editor, 'Keep this draft.')
  await user.click(screen.getByRole('button', { name: 'Comment' }))
  expect(await screen.findByRole('alert')).toBeVisible()

  resolveGet([existing])
  await waitFor(() =>
    expect(
      queryClient.getQueryData<Discussion[]>(discussionsQueryKey('proxy')),
    ).toEqual([existing]),
  )
  expect(editor).toHaveValue('Keep this draft.')
})

test('uses fetched server data and clears a confirmed POST overlay', async () => {
  const posted: Discussion = {
    id: 'posted',
    notes: [{ id: 1, body: 'Local POST result' }],
  }
  const confirmed: Discussion = {
    id: 'posted',
    notes: [{ id: 1, body: 'Confirmed server result' }],
  }
  let startGet!: () => void
  let resolveGet!: (value: Discussion[]) => void
  const getStarted = new Promise<void>((resolve) => {
    startGet = resolve
  })
  const delayedGet = new Promise<Discussion[]>((resolve) => {
    resolveGet = resolve
  })
  server.use(
    http.get('/api/discussions', async () => {
      startGet()
      return HttpResponse.json(await delayedGet)
    }),
    http.post('/api/discussions', () =>
      HttpResponse.json(
        {
          placement: 'inline',
          fallback: 'none',
          discussion: posted,
        } satisfies PostingResult,
        { status: 201 },
      ),
    ),
  )
  const user = userEvent.setup()
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  })
  render(
    <QueryClientProvider client={queryClient}>
      <TransportProvider transport={transport}>
        <App />
        <CommentComposer selection={selection} />
      </TransportProvider>
    </QueryClientProvider>,
  )

  await getStarted
  await user.type(screen.getByLabelText('Comment'), 'Confirm this comment.')
  await user.click(screen.getByRole('button', { name: 'Comment' }))
  await waitFor(() =>
    expect(
      queryClient.getQueryData<Discussion[]>(
        pendingDiscussionsQueryKey('proxy'),
      ),
    ).toEqual([posted]),
  )

  resolveGet([confirmed])
  await waitFor(() =>
    expect(
      queryClient.getQueryData<Discussion[]>(discussionsQueryKey('proxy')),
    ).toEqual([confirmed]),
  )
  expect(
    queryClient.getQueryData<Discussion[]>(
      pendingDiscussionsQueryKey('proxy'),
    ) ?? [],
  ).toEqual([])
})

test('merges a manual update that overlaps a successful POST', async () => {
  const existing: Discussion = { id: 'existing', notes: [] }
  const refreshed: Discussion = { id: 'refreshed', notes: [] }
  const posted: Discussion = { id: 'posted', notes: [] }
  let discussionGetCount = 0
  let startUpdate!: () => void
  let resolveUpdate!: (value: Discussion[]) => void
  const updateStarted = new Promise<void>((resolve) => {
    startUpdate = resolve
  })
  const delayedUpdate = new Promise<Discussion[]>((resolve) => {
    resolveUpdate = resolve
  })
  server.use(
    http.get('/api/discussions', async () => {
      discussionGetCount += 1
      if (discussionGetCount === 1) return HttpResponse.json([existing])
      startUpdate()
      return HttpResponse.json(await delayedUpdate)
    }),
    http.post('/api/discussions', () =>
      HttpResponse.json(
        {
          placement: 'inline',
          fallback: 'none',
          discussion: posted,
        } satisfies PostingResult,
        { status: 201 },
      ),
    ),
  )
  const user = userEvent.setup()
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  })
  render(
    <QueryClientProvider client={queryClient}>
      <TransportProvider transport={transport}>
        <App />
        <CommentComposer selection={selection} />
      </TransportProvider>
    </QueryClientProvider>,
  )

  await screen.findByRole('button', { name: 'Update' })
  await waitFor(() =>
    expect(
      queryClient.getQueryData<Discussion[]>(discussionsQueryKey('proxy')),
    ).toEqual([existing]),
  )
  await user.click(screen.getByRole('button', { name: 'Update' }))
  await updateStarted

  await user.type(screen.getByLabelText('Comment'), 'Post during update.')
  await user.click(screen.getByRole('button', { name: 'Comment' }))
  await waitFor(() =>
    expect(
      queryClient.getQueryData<Discussion[]>(discussionsQueryKey('proxy')),
    ).toEqual([existing, posted]),
  )

  resolveUpdate([existing, refreshed])
  await waitFor(() =>
    expect(
      queryClient.getQueryData<Discussion[]>(discussionsQueryKey('proxy')),
    ).toEqual([existing, refreshed, posted]),
  )
})

test('keeps the comment draft when posting fails', async () => {
  server.use(
    http.post('/api/discussions', () =>
      HttpResponse.json(
        { detail: 'GitLab rejected the comment' },
        { status: 502 },
      ),
    ),
  )
  const user = userEvent.setup()
  render(<CommentComposer selection={selection} />, {
    wrapper: TestProviders,
  })

  const editor = screen.getByLabelText('Comment')
  await user.type(editor, 'Do not lose this draft.')
  await user.click(screen.getByRole('button', { name: 'Comment' }))

  expect(await screen.findByRole('alert')).toBeVisible()
  expect(editor).toHaveValue('Do not lose this draft.')
})

test('a reply is posted as Markdown from the rich box, and the box empties after', async () => {
  const posted: string[] = []
  server.use(
    http.post('/api/discussions/discussion-1/notes', async ({ request }) => {
      const body = (await request.json()) as { body: string }
      posted.push(body.body)
      return HttpResponse.json({ id: 3, body: body.body, author: { name: 'You', username: 'you' } }, { status: 201 })
    }),
  )
  const user = userEvent.setup()
  render(<DiscussionThread discussion={discussion} />, { wrapper: TestProviders })
  const input = await typeRich(screen.getByRole('textbox', { name: 'Reply' }), 'see ')
  act(() => {
    richEditor(input).chain().focus('end').toggleBold().insertContent('this').run()
  })
  await user.click(screen.getByRole('button', { name: 'Reply' }))
  await waitFor(() => expect(posted.at(-1)).toBe('see **this**'))
  await waitFor(() => expect(richEditor(input).isEmpty).toBe(true))
})
