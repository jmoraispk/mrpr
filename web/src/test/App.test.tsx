import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { focusManager, onlineManager, QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { delay, http, HttpResponse } from 'msw'
import userEvent from '@testing-library/user-event'
import { beforeEach, expect, test, vi } from 'vitest'

import App from '../App'
import type { ReactNode } from 'react'

import { TransportProvider } from '../transport/context'
import { createHttpTransport } from '../transport/http'
import type { DeltaTransport } from '../transport/types'
import { TestProviders } from './fixtures'
import { server } from './server'

beforeEach(() => {
  window.location.hash = '#session=test-session'
})

test('renders merge request identity and files', async () => {
  render(<App />, { wrapper: TestProviders })

  expect(await screen.findByText('Improve parser errors')).toBeVisible()
  // The diff stream is a lazy chunk, which can take a moment under load.
  expect(
    (await screen.findAllByText('src/parser.py', undefined, {
      timeout: 5_000,
    }))[0],
  ).toBeVisible()
  expect(screen.getByText('gitlab.example.com')).toBeVisible()
  expect(
    screen.getByLabelText('Total changes: 1 addition, 1 deletion'),
  ).toBeVisible()
})

test('does not refetch review data on focus or reconnect', async () => {
  const calls = { mr: 0, diffs: 0, discussions: 0 }
  server.use(
    http.get('/api/mr', () => {
      calls.mr += 1
      return HttpResponse.json({
        iid: 42,
        title: 'Improve parser errors',
        web_url:
          'https://gitlab.example.com/platform/delta-review/-/merge_requests/42',
        state: 'opened',
        source_branch: 'parser-errors',
        target_branch: 'main',
      })
    }),
    http.get('/api/diffs', () => {
      calls.diffs += 1
      return HttpResponse.json([])
    }),
    http.get('/api/discussions', () => {
      calls.discussions += 1
      return HttpResponse.json([])
    }),
  )

  render(<App />, { wrapper: TestProviders })

  await screen.findByText('Improve parser errors')
  expect(calls).toEqual({ mr: 1, diffs: 1, discussions: 1 })

  focusManager.setFocused(false)
  focusManager.setFocused(true)
  onlineManager.setOnline(false)
  onlineManager.setOnline(true)

  await new Promise((resolve) => window.setTimeout(resolve, 25))
  expect(calls).toEqual({ mr: 1, diffs: 1, discussions: 1 })
})

test('links to the merge request in GitLab', async () => {
  render(<App />, { wrapper: TestProviders })

  expect(
    await screen.findByRole('link', { name: 'Open in GitLab' }),
  ).toHaveAttribute(
    'href',
    'https://gitlab.example.com/platform/delta-review/-/merge_requests/42',
  )
  expect(screen.getByRole('link', { name: 'Open in GitLab' })).toHaveAttribute(
    'target',
    '_blank',
  )
})

test('updates all review data and retains the active file after reordering', async () => {
  const calls = { mr: 0, diffs: 0, discussions: 0 }
  const parser = {
    old_path: 'src/parser.py',
    new_path: 'src/parser.py',
    diff: '@@ -1 +1 @@\n-old\n+new',
    new_file: false,
    renamed_file: false,
    deleted_file: false,
    collapsed: false,
    too_large: false,
  }
  const other = {
    old_path: 'src/other.py',
    new_path: 'src/other.py',
    diff: '@@ -1 +1 @@\n-old-other\n+new-other',
    new_file: false,
    renamed_file: false,
    deleted_file: false,
    collapsed: false,
    too_large: false,
  }

  server.use(
    http.get('/api/mr', async () => {
      calls.mr += 1
      if (calls.mr > 1) await delay(10)
      return HttpResponse.json({
        iid: 42,
        title: 'Improve parser errors',
        web_url:
          'https://gitlab.example.com/platform/delta-review/-/merge_requests/42',
        state: 'opened',
        source_branch: 'parser-errors',
        target_branch: 'main',
      })
    }),
    http.get('/api/diffs', () => {
      calls.diffs += 1
      return HttpResponse.json(calls.diffs === 1 ? [parser, other] : [other, parser])
    }),
    http.get('/api/discussions', () => {
      calls.discussions += 1
      return HttpResponse.json([])
    }),
  )

  render(<App />, { wrapper: TestProviders })

  expect(
    await screen.findByRole(
      'region',
      { name: 'src/parser.py' },
      { timeout: 5_000 },
    ),
  ).toBeVisible()
  fireEvent.keyDown(
    screen.getByRole('button', { name: /^parser\.py/ }),
    { key: 'ArrowDown' },
  )
  expect(
    await screen.findByRole(
      'region',
      { name: 'src/other.py' },
      { timeout: 5_000 },
    ),
  ).toBeVisible()
  expect(calls).toEqual({ mr: 1, diffs: 1, discussions: 1 })

  screen.getByRole('button', { name: 'Update' }).click()

  expect(
    await screen.findByRole('button', { name: 'Updating…' }),
  ).toBeDisabled()
  await waitFor(() =>
    expect(screen.getByRole('button', { name: 'Update' })).toBeEnabled(),
  )
  expect(calls).toEqual({ mr: 2, diffs: 2, discussions: 2 })
  await waitFor(
    () =>
      expect(
        screen.getByRole('region', { name: 'src/other.py' }),
      ).toBeVisible(),
    { timeout: 5_000 },
  )
  expect(await screen.findByText('Review updated.')).toBeVisible()
})

test('keeps review data visible when an update is incomplete', async () => {
  let discussionCalls = 0
  server.use(
    http.get('/api/discussions', () => {
      discussionCalls += 1
      if (discussionCalls === 2) {
        return HttpResponse.json(
          { detail: 'Discussion service unavailable' },
          { status: 500 },
        )
      }
      return HttpResponse.json([])
    }),
  )

  render(<App />, { wrapper: TestProviders })

  expect(
    await screen.findByRole('region', { name: 'src/parser.py' }),
  ).toBeVisible()

  screen.getByRole('button', { name: 'Update' }).click()

  expect(
    await screen.findByText('Review could not be fully updated.'),
  ).toBeVisible()
  expect(
    screen.getByRole('region', { name: 'src/parser.py' }),
  ).toBeVisible()
})

test('keeps review data visible when a required-query update fails', async () => {
  let diffCalls = 0
  server.use(
    http.get('/api/diffs', () => {
      diffCalls += 1
      if (diffCalls === 2) {
        return HttpResponse.json(
          { detail: 'Diff service unavailable' },
          { status: 500 },
        )
      }
      return HttpResponse.json([
        {
          old_path: 'src/parser.py',
          new_path: 'src/parser.py',
          diff: '@@ -1 +1 @@\n-old\n+new',
          new_file: false,
          renamed_file: false,
          deleted_file: false,
          collapsed: false,
          too_large: false,
        },
      ])
    }),
  )

  render(<App />, { wrapper: TestProviders })

  expect(
    await screen.findByRole('region', { name: 'src/parser.py' }),
  ).toBeVisible()

  screen.getByRole('button', { name: 'Update' }).click()

  expect(
    await screen.findByText('Review could not be fully updated.'),
  ).toBeVisible()
  expect(
    screen.getByRole('region', { name: 'src/parser.py' }),
  ).toBeVisible()
})

test('clears the Update status when selecting another file', async () => {
  const files = [
    {
      old_path: 'src/parser.py',
      new_path: 'src/parser.py',
      diff: '@@ -1 +1 @@\n-old\n+new',
      new_file: false,
      renamed_file: false,
      deleted_file: false,
      collapsed: false,
      too_large: false,
    },
    {
      old_path: 'src/other.py',
      new_path: 'src/other.py',
      diff: '@@ -1 +1 @@\n-old\n+new',
      new_file: false,
      renamed_file: false,
      deleted_file: false,
      collapsed: false,
      too_large: false,
    },
  ]
  server.use(http.get('/api/diffs', () => HttpResponse.json(files)))

  render(<App />, { wrapper: TestProviders })

  await screen.findByRole('region', { name: 'src/parser.py' })
  await userEvent.click(screen.getByRole('button', { name: 'Update' }))
  expect(await screen.findByText('Review updated.')).toBeVisible()

  fireEvent.keyDown(
    screen.getByRole('button', { name: /^parser\.py/ }),
    { key: 'ArrowDown' },
  )
  await screen.findByRole('region', { name: 'src/other.py' })

  expect(screen.queryByText('Review updated.')).not.toBeInTheDocument()
})

test('renders code without waiting for discussions', async () => {
  server.use(
    http.get('/api/discussions', async () => {
      await delay('infinite')
      return HttpResponse.json([])
    }),
  )

  render(<App />, { wrapper: TestProviders })

  expect(await screen.findByText('Improve parser errors')).toBeVisible()
  expect(
    await screen.findByRole(
      'region',
      { name: 'src/parser.py' },
      { timeout: 5_000 },
    ),
  ).toBeVisible()
})

test('keeps general MR discussions outside file views', async () => {
  server.use(
    http.get('/api/discussions', () =>
      HttpResponse.json([
        {
          id: 'general',
          notes: [{ id: 1, body: '**General review note**' }],
        },
      ]),
    ),
  )

  render(<App />, { wrapper: TestProviders })

  expect(
    await screen.findByRole('region', { name: 'src/parser.py' }),
  ).toBeVisible()
  expect(screen.queryByText('General review note')).not.toBeInTheDocument()

  screen.getByRole('button', { name: 'MR discussions (1)' }).click()

  expect(await screen.findByText('General review note')).toBeVisible()
})

test('keeps code visible when discussions fail and offers retry', async () => {
  server.use(
    http.get('/api/discussions', () =>
      HttpResponse.json(
        { detail: 'Discussion service unavailable' },
        { status: 500 },
      ),
    ),
  )

  render(<App />, { wrapper: TestProviders })

  expect(
    await screen.findByRole('region', { name: 'src/parser.py' }),
  ).toBeVisible()
  expect(
    await screen.findByRole('button', {
      name: 'Retry loading discussions',
    }),
  ).toBeVisible()
})

test('a note in the MR discussions opens the panel and focuses its thread', async () => {
  server.use(
    http.get('/api/discussions', () =>
      HttpResponse.json([
        { id: 'general', notes: [{ id: 5, body: '**General review note**' }] },
      ]),
    ),
  )

  render(<App focusNoteId={5} />, { wrapper: TestProviders })

  expect(await screen.findByText('General review note')).toBeVisible()
  await waitFor(
    () => {
      expect(document.activeElement).toHaveAttribute('data-discussion-id', 'general')
      expect(document.activeElement).toHaveClass('thread-flash')
    },
    { timeout: 5_000 },
  )
})

test('an inline note turns inline comments on and focuses its thread', async () => {
  server.use(
    http.get('/api/discussions', () =>
      HttpResponse.json([
        {
          id: 'inline-1',
          notes: [
            {
              id: 7,
              body: 'Inline review note',
              position: {
                old_path: 'src/parser.py',
                new_path: 'src/parser.py',
                old_line: null,
                new_line: 1,
              },
            },
          ],
        },
      ]),
    ),
  )

  // jsdom has no layout, and the diff library only draws an inline thread
  // once its table has a measured width (`useDomWidth` in @git-diff-view).
  // Give that one element a width; everything else measures as before.
  const realRect = HTMLElement.prototype.getBoundingClientRect
  const rect = vi
    .spyOn(HTMLElement.prototype, 'getBoundingClientRect')
    .mockImplementation(function (this: HTMLElement) {
      return this.classList.contains('unified-diff-table-wrapper')
        ? ({ x: 0, y: 0, top: 0, left: 0, right: 800, bottom: 20, width: 800, height: 20, toJSON() {} } as DOMRect)
        : realRect.call(this)
    })
  try {
    render(<App focusNoteId={7} />, { wrapper: TestProviders })

    expect(
      await screen.findByRole('button', { name: /inline comments/i, pressed: true }),
    ).toBeVisible()
    await waitFor(
      () =>
        expect(document.activeElement).toHaveAttribute(
          'data-discussion-id',
          'inline-1',
        ),
      { timeout: 5_000 },
    )
  } finally {
    rect.mockRestore()
  }
}, 10_000)

test('a note that is no longer on the diff opens the review with a notice', async () => {
  render(<App focusNoteId={999} />, { wrapper: TestProviders })

  expect(
    await screen.findByText(/no longer on this merge request’s current diff/i),
  ).toBeVisible()
  expect(screen.getByText('Improve parser errors')).toBeVisible()
})

function transportWrapper(extra: Partial<DeltaTransport>) {
  return function Wrapper({ children }: { children: ReactNode }) {
    const queryClient = new QueryClient({
      defaultOptions: { queries: { retry: false } },
    })
    return (
      <QueryClientProvider client={queryClient}>
        <TransportProvider transport={{ ...createHttpTransport(), ...extra }}>
          {children}
        </TransportProvider>
      </QueryClientProvider>
    )
  }
}

test('opening a review records the head as looked at', async () => {
  const markLooked = vi.fn(async () => {})
  server.use(
    http.get('/api/mr', () =>
      HttpResponse.json({
        iid: 42,
        title: 'Improve parser errors',
        web_url: 'https://gitlab.example.com/x/-/merge_requests/42',
        state: 'opened',
        source_branch: 'a',
        target_branch: 'main',
        sha: 'head-2',
      }),
    ),
  )
  render(<App />, {
    wrapper: transportWrapper({
      markLooked,
      lastLook: async () => 'head-1',
      getDiffsSince: async () => [],
    }),
  })
  await waitFor(() => expect(markLooked).toHaveBeenCalledWith('head-2'))
})

test('since your last review shows only what changed after the last look', async () => {
  const user = userEvent.setup()
  const getDiffsSince = vi.fn(async () => [
    {
      old_path: 'src/new.py',
      new_path: 'src/new.py',
      diff: '@@ -1 +1 @@\n-a\n+b',
      new_file: false,
      renamed_file: false,
      deleted_file: false,
      collapsed: false,
      too_large: false,
    },
  ])
  render(<App />, {
    wrapper: transportWrapper({
      markLooked: async () => {},
      lastLook: async () => 'head-1',
      getDiffsSince,
    }),
  })

  await user.click(await screen.findByRole('button', { name: 'Since your last review' }))

  expect(getDiffsSince).toHaveBeenCalledWith('head-1', expect.anything())
  expect(
    await screen.findByRole('region', { name: 'src/new.py' }, { timeout: 5_000 }),
  ).toBeVisible()
})

test('without a previous look there is no since toggle', async () => {
  render(<App />, {
    wrapper: transportWrapper({
      markLooked: async () => {},
      lastLook: async () => null,
      getDiffsSince: async () => [],
    }),
  })
  await screen.findByText('Improve parser errors')
  expect(screen.queryByRole('button', { name: 'Since your last review' })).toBeNull()
})

test('the review view can approve', async () => {
  const user = userEvent.setup()
  const approve = vi.fn(async () => {})
  render(<App />, {
    wrapper: transportWrapper({ approve, markLooked: async () => {}, lastLook: async () => null }),
  })
  await user.click(await screen.findByRole('button', { name: 'Approve' }))
  expect(approve).toHaveBeenCalledOnce()
  expect(await screen.findByText('Approved')).toBeInTheDocument()
})

test('a failed approval says so', async () => {
  const user = userEvent.setup()
  render(<App />, {
    wrapper: transportWrapper({
      approve: async () => {
        throw new Error('403')
      },
    }),
  })
  await user.click(await screen.findByRole('button', { name: 'Approve' }))
  expect(await screen.findByRole('alert')).toHaveTextContent("Couldn't approve")
})
