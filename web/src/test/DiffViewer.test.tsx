import {
  fireEvent,
  render,
  screen,
  within,
} from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { http, HttpResponse } from 'msw'
import {
  forwardRef,
  useImperativeHandle,
  useState,
  type ReactNode,
} from 'react'
import { beforeEach, expect, test, vi } from 'vitest'

import type { DiffFile, Discussion } from '../api/types'
import { DiffViewer } from '../review/DiffViewer'
import { TestProviders } from './fixtures'
import { server } from './server'

vi.mock('@git-diff-view/react', async (importOriginal) => {
  const actual =
    await importOriginal<typeof import('@git-diff-view/react')>()
  const MockDiffView = forwardRef(
    (
      {
        onAddWidgetClick,
        diffViewMode,
        extendData,
        renderExtendLine,
        renderWidgetLine,
      }: {
        onAddWidgetClick?: (lineNumber: number, side: number) => void
        diffViewMode?: number
        extendData?: {
          oldFile?: Record<string, { data: Discussion[] }>
          newFile?: Record<string, { data: Discussion[] }>
        }
        renderExtendLine?: (props: {
          data?: Discussion[]
        }) => ReactNode
        renderWidgetLine?: (props: {
          lineNumber: number
          side: number
          onClose: () => void
        }) => ReactNode
      },
      ref,
    ) => {
      const [widget, setWidget] = useState<{
        lineNumber: number
        side: number
      } | null>(null)
      useImperativeHandle(ref, () => ({
        getDiffFileInstance: () => null,
      }))
      return (
        <div>
          <button
            type="button"
            onClick={() => {
              setWidget({ lineNumber: 12, side: 2 })
              onAddWidgetClick?.(12, 2)
            }}
          >
            Comment line 12
          </button>
          <button
            type="button"
            onClick={() => {
              setWidget({ lineNumber: 14, side: 2 })
              onAddWidgetClick?.(14, 2)
            }}
          >
            Comment line 14
          </button>
          {extendData?.newFile?.['14'] ? (
            <div>
              {renderExtendLine?.({ data: extendData.newFile['14'].data })}
            </div>
          ) : null}
          {diffViewMode === 3 ? (
            <div data-testid="empty-split-extension">
              {renderExtendLine?.({ data: undefined })}
            </div>
          ) : null}
          {widget
            ? (
                <div data-testid="widget-line">
                  {renderWidgetLine?.({
                    ...widget,
                    onClose: () => setWidget(null),
                  })}
                </div>
              )
            : null}
        </div>
      )
    },
  )
  return {
    ...actual,
    DiffModeEnum: { Split: 3, Unified: 4 },
    DiffView: MockDiffView,
    SplitSide: { old: 1, new: 2 },
  }
})

const FILE: DiffFile = {
  old_path: 'src/parser.py',
  new_path: 'src/parser.py',
  diff: '@@ -12 +12,3 @@\n-old\n+new',
  new_file: false,
  renamed_file: false,
  deleted_file: false,
  collapsed: false,
  too_large: false,
}

beforeEach(() => {
  localStorage.clear()
})

test('toggles and persists split view', async () => {
  const user = userEvent.setup()
  render(<DiffViewer file={FILE} />, { wrapper: TestProviders })

  await user.click(screen.getByRole('button', { name: 'Split' }))

  expect(screen.getByRole('button', { name: 'Split' })).toHaveAttribute(
    'aria-pressed',
    'true',
  )
  expect(localStorage.getItem('delta-diff-mode')).toBe('split')
})

test('restores the persisted split view', () => {
  localStorage.setItem('delta-diff-mode', 'split')

  render(<DiffViewer file={FILE} />, { wrapper: TestProviders })

  expect(screen.getByRole('button', { name: 'Split' })).toHaveAttribute(
    'aria-pressed',
    'true',
  )
})

test('keeps split view mounted when extension data is absent', async () => {
  const user = userEvent.setup()
  render(<DiffViewer file={FILE} />, { wrapper: TestProviders })

  await user.click(screen.getByRole('button', { name: 'Split' }))

  expect(screen.getByTestId('empty-split-extension')).toBeVisible()
  expect(screen.getByRole('button', { name: 'Split' })).toHaveAttribute(
    'aria-pressed',
    'true',
  )
})

test('opens a line selection and extends it with shift-click', () => {
  render(<DiffViewer file={FILE} />, { wrapper: TestProviders })

  fireEvent.click(screen.getByRole('button', { name: 'Comment line 12' }))
  expect(screen.getByLabelText('Comment')).toBeVisible()
  fireEvent.click(screen.getByRole('button', { name: 'Comment line 14' }), {
    shiftKey: true,
  })

  expect(screen.getByText(/lines 12–14/)).toBeVisible()
})

test('places the comment composer inside the selected diff row', () => {
  render(<DiffViewer file={FILE} />, { wrapper: TestProviders })

  fireEvent.click(screen.getByRole('button', { name: 'Comment line 12' }))

  expect(
    within(screen.getByTestId('widget-line')).getByLabelText('Comment'),
  ).toBeVisible()
})

test('clears selection when the active file changes', () => {
  const { rerender } = render(<DiffViewer file={FILE} />, {
    wrapper: TestProviders,
  })
  fireEvent.click(screen.getByRole('button', { name: 'Comment line 12' }))
  expect(screen.getByLabelText('Comment')).toBeVisible()

  rerender(
    <DiffViewer
      file={{ ...FILE, old_path: 'b.py', new_path: 'b.py' }}
    />,
  )

  expect(screen.queryByLabelText('Comment')).not.toBeInTheDocument()
})

test('explains files whose diffs cannot be rendered', () => {
  render(<DiffViewer file={{ ...FILE, too_large: true }} />, {
    wrapper: TestProviders,
  })

  expect(screen.getByText(/too large for GitLab to return/i)).toBeVisible()
})

test('shows the active file diff totals', () => {
  render(<DiffViewer file={FILE} />, { wrapper: TestProviders })

  expect(
    screen.getByLabelText('File changes: 1 addition, 1 deletion'),
  ).toBeVisible()
})

test('shows code first and reveals only inline comments on request', async () => {
  const discussions: Discussion[] = [
    {
      id: 'inline',
      notes: [
        {
          id: 1,
          body: 'Range feedback',
          position: {
            old_path: FILE.old_path,
            new_path: FILE.new_path,
            new_line: 12,
            line_range: {
              start: {
                line_code: 'hash_0_12',
                type: 'new',
                old_line: null,
                new_line: 12,
              },
              end: {
                line_code: 'hash_0_14',
                type: 'new',
                old_line: null,
                new_line: 14,
              },
            },
          },
        },
      ],
    },
    {
      id: 'general',
      notes: [{ id: 2, body: 'General feedback' }],
    },
  ]
  render(<DiffViewer file={FILE} discussions={discussions} />, {
    wrapper: TestProviders,
  })

  const user = userEvent.setup()
  const diff = screen.getByRole('region', { name: FILE.new_path })
  expect(
    within(diff).queryByRole('button', { name: 'Split' }),
  ).not.toBeInTheDocument()
  expect(screen.queryByText('Range feedback')).not.toBeInTheDocument()
  expect(screen.queryByText('General feedback')).not.toBeInTheDocument()

  await user.click(
    screen.getByRole('button', { name: 'Show inline comments (1)' }),
  )

  expect(screen.getByText('Lines +12–+14')).toBeVisible()
  expect(screen.getByText('Range feedback')).toBeVisible()
  expect(screen.queryByText('General feedback')).not.toBeInTheDocument()
})

test('preserves a long file path without sharing space with view controls', () => {
  const longPath =
    'src/features/extremely/long/path/that/needs/to/truncate/parser.ts'

  render(
    <DiffViewer
      file={{ ...FILE, old_path: longPath, new_path: longPath }}
    />,
    { wrapper: TestProviders },
  )

  expect(screen.getByTitle(longPath)).toBeVisible()
})

test('shows and dismisses a final-line fallback above the active diff', async () => {
  server.use(
    http.post('/api/discussions', () =>
      HttpResponse.json(
        {
          placement: 'inline',
          fallback: 'final_line',
          discussion: { id: 'final-line', notes: [] },
        },
        { status: 201 },
      ),
    ),
  )
  const user = userEvent.setup()
  render(<DiffViewer file={FILE} />, { wrapper: TestProviders })

  await user.click(screen.getByRole('button', { name: 'Comment line 12' }))
  await user.type(screen.getByLabelText('Comment'), 'Keep this visible.')
  await user.click(screen.getByRole('button', { name: 'Comment' }))

  expect(await screen.findByRole('status')).toHaveTextContent(
    'GitLab stored this range comment on its final line.',
  )
  expect(screen.queryByLabelText('Comment')).not.toBeInTheDocument()

  await user.click(screen.getByRole('button', { name: 'Dismiss status' }))
  expect(screen.queryByRole('status')).not.toBeInTheDocument()
})

test('shows and dismisses a general fallback above the active diff', async () => {
  server.use(
    http.post('/api/discussions', () =>
      HttpResponse.json(
        {
          placement: 'general',
          fallback: 'general',
          discussion: { id: 'general', notes: [] },
        },
        { status: 201 },
      ),
    ),
  )
  const user = userEvent.setup()
  render(<DiffViewer file={FILE} />, { wrapper: TestProviders })

  await user.click(screen.getByRole('button', { name: 'Comment line 12' }))
  await user.type(screen.getByLabelText('Comment'), 'Keep this visible.')
  await user.click(screen.getByRole('button', { name: 'Comment' }))

  expect(await screen.findByRole('status')).toHaveTextContent(
    'GitLab stored this as a general discussion.',
  )
  expect(screen.queryByLabelText('Comment')).not.toBeInTheDocument()

  await user.click(screen.getByRole('button', { name: 'Dismiss status' }))
  expect(screen.queryByRole('status')).not.toBeInTheDocument()
})
